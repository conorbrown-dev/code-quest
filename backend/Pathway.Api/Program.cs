using System.Text.Json.Serialization;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Pathway.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddHttpClient();
var databaseUrl = builder.Configuration["DATABASE_URL"] ?? builder.Configuration.GetConnectionString("Pathway");
if (!string.IsNullOrWhiteSpace(databaseUrl))
    builder.Services.AddDbContextFactory<ProgressDbContext>(options => options.UseNpgsql(ToNpgsqlConnectionString(databaseUrl)));
var allowedOrigins = (builder.Configuration["CORS_ORIGINS"] ?? "http://localhost:5173,http://127.0.0.1:5173")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddAuthorization();
var keycloakAuthority = builder.Configuration["KEYCLOAK_AUTHORITY"]?.TrimEnd('/');
var keycloakAudience = builder.Configuration["KEYCLOAK_AUDIENCE"];
if (!string.IsNullOrWhiteSpace(keycloakAuthority) && !string.IsNullOrWhiteSpace(keycloakAudience))
{
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
    {
        options.Authority = keycloakAuthority;
        options.Audience = keycloakAudience;
        options.MapInboundClaims = false;
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
    });
}

var app = builder.Build();
app.UseCors();
if (!string.IsNullOrWhiteSpace(keycloakAuthority) && !string.IsNullOrWhiteSpace(keycloakAudience))
{
    app.UseAuthentication();
    app.UseAuthorization();
}
if (!string.IsNullOrWhiteSpace(databaseUrl))
{
    await using var scope = app.Services.CreateAsyncScope();
    var database = scope.ServiceProvider.GetRequiredService<IDbContextFactory<ProgressDbContext>>();
    await using var context = await database.CreateDbContextAsync();
    await context.Database.EnsureCreatedAsync();
}
app.MapGet("/health", () => Results.Ok(new { status = "ok", courseVersion = Curriculum.Version }));
app.MapGet("/openapi/v1.json", () => Results.Ok(new { openapi = "3.0.3", info = new { title = "Pathway API", version = "v1" } }));
app.MapGet("/api/courses", () => Results.Ok(Curriculum.Catalog));
app.MapGet("/api/courses/{courseId}", (string courseId) => string.Equals(courseId, Curriculum.Course.Id, StringComparison.Ordinal) ? Results.Ok(Curriculum.Course) : Results.NotFound());
app.MapGet("/api/lessons/{slug}", (string slug) => Curriculum.BySlug.TryGetValue(slug, out var lesson) ? Results.Ok(lesson) : Results.NotFound());
var progressEndpoint = app.MapGet("/api/progress", async (HttpContext httpContext, IServiceProvider services, CancellationToken cancellationToken) =>
{
    var learnerId = await ResolveLearnerId(httpContext, services, cancellationToken);
    var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
    if (factory is null) return Results.Ok(new LearnerProgressResponse(learnerId, []));
    await using var database = await factory.CreateDbContextAsync(cancellationToken);
    var completed = await database.Progress.Where(item => item.LearnerId == learnerId).OrderBy(item => item.CompletedAt).Select(item => item.LessonSlug).ToArrayAsync(cancellationToken);
    return Results.Ok(new LearnerProgressResponse(learnerId, completed));
});
var submissionEndpoint = app.MapPost("/api/submissions/validate", async (Submission submission, HttpContext httpContext, IServiceProvider services, IHttpClientFactory httpClientFactory, IConfiguration configuration, IHostEnvironment environment, CancellationToken cancellationToken) =>
{
    if (!Curriculum.BySlug.TryGetValue(submission.LessonSlug, out var lesson)) return Results.NotFound();
    if (lesson.Exercise.Kind == ExerciseKind.Code && !string.IsNullOrWhiteSpace(configuration["EVALUATOR_URL"]))
    {
        var client = httpClientFactory.CreateClient();
        try
        {
            var runnerResponse = await client.PostAsJsonAsync($"{configuration["EVALUATOR_URL"]!.TrimEnd('/')}/evaluate", new EvaluatorRequest(submission.LessonSlug, submission.Code ?? string.Empty), cancellationToken);
            if (runnerResponse.IsSuccessStatusCode)
            {
                var evaluated = await runnerResponse.Content.ReadFromJsonAsync<ValidationResult>(cancellationToken: cancellationToken);
                if (evaluated is not null) { await PersistSubmission(services, await ResolveLearnerId(httpContext, services, cancellationToken), submission, evaluated.Passed, cancellationToken); return Results.Ok(evaluated); }
            }
            return Results.Problem("The code evaluator did not return a usable result.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (HttpRequestException)
        {
            return Results.Problem("The code evaluator is temporarily unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
    // Development-only deterministic checks make local lesson authoring fast. In production,
    // set EVALUATOR_URL to a private sandbox worker; never execute learner code in this API.
    if (lesson.Exercise.Kind == ExerciseKind.Code && environment.IsProduction())
        return Results.Problem("A code evaluator has not been configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
    var validation = lesson.Exercise.Kind switch
    {
        ExerciseKind.MultipleChoice => ValidateChoice(lesson, submission.Answer),
        ExerciseKind.Code => ValidateCode(lesson, submission.Code ?? string.Empty),
        _ => new ValidationResult(false, 0, 1, "This exercise type is not supported yet.", null)
    };
    await PersistSubmission(services, await ResolveLearnerId(httpContext, services, cancellationToken), submission, validation.Passed, cancellationToken);
    return Results.Ok(validation);
});
if (!string.IsNullOrWhiteSpace(keycloakAuthority) && !string.IsNullOrWhiteSpace(keycloakAudience)) { progressEndpoint.RequireAuthorization(); submissionEndpoint.RequireAuthorization(); }
app.Run();

static Task<string> ResolveLearnerId(HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
{
    var subject = context.User.FindFirstValue("sub");
    return Task.FromResult(!string.IsNullOrWhiteSpace(subject) ? $"keycloak:{subject}" : context.Request.Headers["X-Learner-Id"].FirstOrDefault() is { Length: > 0 and <= 100 } learnerId ? learnerId : "anonymous");
}

static async Task PersistSubmission(IServiceProvider services, string learnerId, Submission submission, bool passed, CancellationToken cancellationToken)
{
    var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
    if (factory is null) return;
    await using var database = await factory.CreateDbContextAsync(cancellationToken);
    database.Submissions.Add(new LearnerSubmission { LearnerId = learnerId, LessonSlug = submission.LessonSlug, Answer = submission.Answer, Code = submission.Code, Passed = passed });
    if (passed && !await database.Progress.AnyAsync(item => item.LearnerId == learnerId && item.LessonSlug == submission.LessonSlug, cancellationToken))
        database.Progress.Add(new LearnerProgress { LearnerId = learnerId, LessonSlug = submission.LessonSlug, CompletedAt = DateTimeOffset.UtcNow });
    await database.SaveChangesAsync(cancellationToken);
}

static string ToNpgsqlConnectionString(string value)
{
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "postgres" && uri.Scheme != "postgresql")) return value;
    var userInfo = uri.UserInfo.Split(':', 2);
    var builder = new Npgsql.NpgsqlConnectionStringBuilder { Host = uri.Host, Port = uri.Port, Database = uri.AbsolutePath.Trim('/'), Username = Uri.UnescapeDataString(userInfo[0]), Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : string.Empty, SslMode = Npgsql.SslMode.Require };
    return builder.ConnectionString;
}

static ValidationResult ValidateChoice(Lesson lesson, string? answer)
{
    var passed = string.Equals(answer, lesson.Exercise.CorrectAnswer, StringComparison.Ordinal);
    return new ValidationResult(passed, passed ? 1 : 0, 1, passed ? "That’s right. You’ve got the idea." : "Not quite—re-read the example and try again.", passed ? lesson.NextSlug : null);
}
static ValidationResult ValidateCode(Lesson lesson, string code)
{
    var syntaxError = CSharpSyntaxTree.ParseText(code, new CSharpParseOptions(LanguageVersion.Preview))
        .GetDiagnostics()
        .FirstOrDefault(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error);
    if (syntaxError is not null)
        return new ValidationResult(false, 0, 2, $"C# syntax error: {syntaxError.GetMessage()}", null);
    var passed = lesson.Slug switch
    {
        "foundations-making-decisions" => code.Contains("if", StringComparison.Ordinal) && code.Contains("age >= 13", StringComparison.Ordinal) && code.Contains("You can watch!", StringComparison.Ordinal),
        "modern-csharp-records" => code.Contains("record", StringComparison.Ordinal) && code.Contains("Order", StringComparison.Ordinal),
        "web-api-sealed-services" => code.Contains("sealed class", StringComparison.Ordinal) && code.Contains("IOrderService", StringComparison.Ordinal) && code.Contains("CancellationToken", StringComparison.Ordinal),
        _ => false
    };
    var message = passed ? "All tests passed. Your solution meets this lesson’s checks." : lesson.Exercise.Hint;
    return new ValidationResult(passed, passed ? 2 : 0, 2, message, passed ? lesson.NextSlug : null);
}

record CourseCatalogItem(string Id, string Title, string LanguageId, string LanguageVersion, string FrameworkVersion, bool Available);
record Course(string Id, string Title, string LanguageId, string LanguageVersion, string FrameworkVersion, string LastReviewed, IReadOnlyList<Module> Modules);
record Module(string Id, string Title, string Level, IReadOnlyList<LessonSummary> Lessons);
record LessonSummary(string Slug, string Title, int Order);
record Lesson(string Slug, string Module, int Order, string Title, string Subtitle, string Concept, string Body, string Example, Exercise Exercise, string? NextSlug, VersionStamp Version);
record VersionStamp(string Language, string Framework, string LastReviewed, string SourceUrl);
record Exercise(ExerciseKind Kind, string Title, string Prompt, string[] Requirements, string? StarterCode, string? CorrectAnswer, Choice[] Choices, string Hint, string[] Tests);
record Choice(string Id, string Text);
record Submission(string LessonSlug, string? Answer, string? Code);
record LearnerProgressResponse(string LearnerId, string[] CompletedLessonSlugs);
record EvaluatorRequest(string LessonSlug, string Code);
record ValidationResult(bool Passed, int PassingTests, int TotalTests, string Feedback, string? NextLessonSlug);
enum ExerciseKind { MultipleChoice, Code }

static class Curriculum
{
    public const string Version = "C# 14 / .NET 10";
    private static readonly VersionStamp Current = new("C# 14", ".NET 10", "2026-08-12", "https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14");
    public static readonly Lesson[] Lessons =
    [
        new("foundations-how-code-works", "Foundations", 1, "How code works", "Give the computer one clear instruction at a time.", "A program is a precise sequence of instructions.", "C# programs run from top to bottom. `Console.WriteLine` asks the program to show a message.", "Console.WriteLine(\"Hello, Pathway!\");", new(ExerciseKind.MultipleChoice, "Read the program", "What does this line do?", ["Choose one answer"], null, "print", [new("store", "Stores a message for later"), new("print", "Prints a message to the console"), new("loop", "Repeats the message forever")], "Look at the word after the dot: `WriteLine`.", ["Identifies console output"]), "foundations-values", Current),
        new("foundations-values", "Foundations", 2, "Values & variables", "Name information so your program can use it.", "Variables give a value a meaningful name.", "Choose a type that describes the value. Use `string` for text and `int` for whole numbers.", "string learner = \"Alex\";\nint completedLessons = 4;", new(ExerciseKind.MultipleChoice, "Choose a type", "Which type is best for a whole-number lesson count?", ["Choose one answer"], null, "int", [new("string", "string"), new("int", "int"), new("bool", "bool")], "A lesson count has no decimal places.", ["Uses a whole-number type"]), "foundations-making-decisions", Current),
        new("foundations-making-decisions", "Foundations", 3, "Making decisions", "Use conditions to choose a path.", "A boolean expression evaluates to `true` or `false`.", "An `if` statement runs its body only when its condition is true. Read it like a sentence.", "if (age >= 13)\n{\n    Console.WriteLine(\"Welcome in!\");\n}", new(ExerciseKind.Code, "Movie night", "Print `You can watch!` only when `age` is 13 or above.", ["Use an `if` statement", "Use `age >= 13`", "Print the exact message"], "int age = 16;\n\n// Write your if statement below\n", null, [], "Check the condition uses `age >= 13`, then call `Console.WriteLine` inside the braces.", ["Prints message at 13", "Does not print under 13"]), "modern-csharp-records", Current),
        new("modern-csharp-records", "Modern C#", 4, "Model data with records", "Use value-based data types for immutable messages and responses.", "Records express data-focused types with value equality.", "A positional record is a concise choice for immutable request, response, and message DTOs. Use `with` to create a changed copy rather than mutating the original.", "public sealed record OrderResponse(Guid Id, string Status);\n\nvar shipped = order with { Status = \"Shipped\" };", new(ExerciseKind.Code, "Order response", "Declare an `Order` record with an `Id` and a `Status`.", ["Use the `record` keyword", "Name the type `Order`", "Include `Id` and `Status`"], "// Create a data-focused Order type\n", null, [], "Start with: `public sealed record Order(...)`. Choose suitable types for the two values.", ["Declares a record", "Uses the expected type name"]), "web-api-sealed-services", Current),
        new("web-api-sealed-services", "Web APIs", 5, "Design closed Web API types", "Default to closed concrete types; open types deliberately.", "`sealed` prevents unintended inheritance. Prefer composition and interfaces for variation.", "For a concrete application service or controller that is not designed as an extension point, `sealed` makes that decision explicit. It is not a universal rule: don’t seal framework extension points, deliberately extensible libraries, or types that must be proxied. Use constructor injection and accept `CancellationToken` at I/O boundaries.", "public sealed class OrdersController(IOrderService orders) : ControllerBase\n{\n    public async Task<OrderResponse> Get(Guid id, CancellationToken cancellationToken)\n        => await orders.GetAsync(id, cancellationToken);\n}", new(ExerciseKind.Code, "Close the service", "Create a sealed `OrderService` that implements `IOrderService` and accepts a `CancellationToken` in an async operation.", ["Declare a `sealed class`", "Implement `IOrderService`", "Accept `CancellationToken`"], "// Prefer composition over inheritance.\n", null, [], "Use `public sealed class OrderService : IOrderService`. Add an async method with a `CancellationToken` parameter.", ["Prevents inheritance", "Supports cancellation"]), "modern-csharp-switch-expressions", Current),
        new("modern-csharp-switch-expressions", "Modern C#", 6, "Express branches as values", "Use switch expressions when every case produces a value.", "A switch expression is compact and encourages exhaustive handling.", "When a decision maps an input to one result, a switch expression is often clearer than a multi-branch `if` chain. Add a discard arm when unknown values have a safe fallback.", "var label = status switch\n{\n    OrderStatus.Paid => \"Ready to ship\",\n    OrderStatus.Cancelled => \"Cancelled\",\n    _ => \"Pending\"\n};", new(ExerciseKind.MultipleChoice, "Pick the pattern", "When is a switch expression a strong fit?", ["Choose the best answer"], null, "maps", [new("maps", "When several input cases each produce one value"), new("sideeffects", "When each branch performs unrelated side effects"), new("inheritance", "When a class needs a base type")], "Look for a decision that returns a value for each input case.", ["Recognizes value mapping"]), "modern-csharp-primary-constructors", Current),
        new("modern-csharp-primary-constructors", "Modern C#", 7, "Use primary constructors deliberately", "Keep dependency declarations close to the type they support.", "Primary constructors reduce ceremony for types whose constructor parameters are used by instance members.", "In application services, primary constructors make injected dependencies visible at the type declaration. Avoid retaining inputs you do not need; use normal constructors when validation or construction logic is substantial.", "public sealed class PriceService(IExchangeRateClient rates)\n{\n    public Task<decimal> ConvertAsync(decimal amount, CancellationToken ct)\n        => rates.ConvertAsync(amount, ct);\n}", new(ExerciseKind.MultipleChoice, "Choose the fit", "When is a primary constructor most useful?", ["Choose the best answer"], null, "dependency", [new("dependency", "A small service stores and uses an injected dependency"), new("complex", "A type needs complex validation before any fields are assigned"), new("static", "A static helper has no instance state")], "Look for a compact type with straightforward dependencies.", ["Identifies a primary constructor use case"]), "modern-csharp-ranges", Current),
        new("modern-csharp-ranges", "Modern C#", 8, "Slice safely with ranges", "Use ranges to express positions and slices clearly.", "The range operator `..` describes a start and end; the index-from-end operator `^` counts backward.", "Ranges make intent clear for strings, arrays, and spans. For performance-sensitive work, understand whether an API allocates or returns a view; `Span<T>` and `ReadOnlySpan<T>` are central tools for efficient parsing.", "var lastFour = cardNumber[^4..];\nvar prefix = cardNumber[..4];", new(ExerciseKind.MultipleChoice, "Read the range", "What does `values[^2..]` select?", ["Choose one answer"], null, "last", [new("first", "The first two values"), new("last", "The final two values"), new("all", "Every value except the final two")], "`^2` means two positions from the end.", ["Reads from-end indexes"]), "web-api-minimal-or-controller", Current),
        new("web-api-minimal-or-controller", "Web APIs", 9, "Choose an HTTP endpoint style", "Use the simplest API style that preserves clarity.", "ASP.NET Core supports Minimal APIs and controller-based APIs.", "Minimal APIs are excellent for small, focused endpoints. Controllers can organize larger endpoint groups and cross-cutting conventions. Both should validate input, return appropriate HTTP semantics, honor cancellation, and keep business rules out of the endpoint.", "app.MapGet(\"/orders/{id:guid}\", async (Guid id, IOrderService orders, CancellationToken ct)\n    => await orders.GetAsync(id, ct) is { } order ? Results.Ok(order) : Results.NotFound());", new(ExerciseKind.MultipleChoice, "Choose the shape", "Which is a good reason to choose a controller?", ["Choose one answer"], null, "organization", [new("organization", "A large API benefits from grouped actions and shared conventions"), new("speed", "Controllers make all requests faster"), new("inheritance", "Every endpoint must inherit from a base controller")], "Think about organization and conventions, not a universal performance claim.", ["Selects an API style intentionally"]), "quality-tests", Current),
        new("quality-tests", "Engineering Practice", 10, "Prove behavior with tests", "Tests protect behavior, not implementation trivia.", "A useful test names a behavior and gives clear failure feedback.", "Write focused unit tests for domain logic and integration tests for behavior at boundaries—HTTP, databases, queues, and authentication. Test the observable contract; avoid coupling tests to private implementation details.", "[Fact]\npublic async Task Get_returns_404_when_order_is_missing()\n{\n    var response = await _client.GetAsync(\"/orders/not-found\");\n    response.StatusCode.Should().Be(HttpStatusCode.NotFound);\n}", new(ExerciseKind.MultipleChoice, "Test the contract", "What should an endpoint integration test assert first?", ["Choose one answer"], null, "observable", [new("observable", "The status code and response contract a client can observe"), new("private", "The endpoint’s private helper method order"), new("logging", "An exact timestamp in every log message")], "A client cannot rely on private implementation details.", ["Focuses on observable behavior"]), "reliability-cancellation", Current),
        new("reliability-cancellation", "Reliability", 11, "Propagate cancellation", "Stop work when the caller no longer needs it.", "`CancellationToken` is a cooperative signal, not an exception to ignore.", "Accept a token at request and job boundaries, then pass it to database, HTTP, and async APIs that support it. Don’t create a new token deep in the call chain. Treat cancellation as expected control flow, not an application error.", "public Task<Order?> GetAsync(Guid id, CancellationToken ct)\n    => _db.Orders.SingleOrDefaultAsync(x => x.Id == id, ct);", new(ExerciseKind.MultipleChoice, "Follow the token", "What should a request handler do with its cancellation token?", ["Choose one answer"], null, "propagate", [new("propagate", "Pass it to downstream async and I/O calls"), new("ignore", "Ignore it because the server can finish later"), new("replace", "Create a new token for every method")], "Cancellation only helps if work that can stop receives the token.", ["Propagates cancellation"]), "staff-architecture-decisions", Current),
        new("staff-architecture-decisions", "Staff Practice", 12, "Make architecture decisions legible", "A staff engineer turns ambiguity into reversible, evidence-backed decisions.", "An architecture decision record captures context, decision, consequences, and alternatives.", "At staff level, the job is not to choose the fanciest system. State the constraints, quantify trade-offs, design for operational ownership, and choose the smallest approach that can meet the real need. Make the decision easy to revisit when assumptions change.", "# ADR 012: process order events asynchronously\nContext: checkout p95 latency is rising.\nDecision: queue non-critical notifications.\nConsequences: eventual consistency; add retry and observability.", new(ExerciseKind.MultipleChoice, "Choose the staff move", "What is the strongest first step when a system needs to scale?", ["Choose one answer"], null, "constraints", [new("constraints", "Measure the bottleneck and state the product and operational constraints"), new("rewrite", "Rewrite every service into microservices"), new("cache", "Add a cache before observing the workload")], "Staff-level decisions begin with evidence and constraints.", ["Frames a decision with evidence"]), null, Current)
    ];
    public static readonly Dictionary<string, Lesson> BySlug = Lessons.ToDictionary(lesson => lesson.Slug, StringComparer.Ordinal);
    public static readonly Course Course = new("csharp-dotnet", "C# / .NET: zero to staff", "csharp", "C# 14", ".NET 10", "2026-08-12",
        Lessons.GroupBy(lesson => lesson.Module).Select(group => new Module(group.Key, group.Key, group.Key == "Foundations" ? "Beginner" : "Professional", group.Select(l => new LessonSummary(l.Slug, l.Title, l.Order)).ToArray())).ToArray());
    public static readonly IReadOnlyList<CourseCatalogItem> Catalog =
    [
        new(Course.Id, Course.Title, Course.LanguageId, Course.LanguageVersion, Course.FrameworkVersion, true)
    ];
}
