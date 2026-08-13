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
app.MapGet("/api/courses/{courseId}", (string courseId) => Curriculum.Courses.TryGetValue(courseId, out var course) ? Results.Ok(course) : Results.NotFound());
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
    if (lesson.Slug.StartsWith("python-", StringComparison.Ordinal))
    {
        var pythonPassed = lesson.Slug switch
        {
            "python-functions" => code.Contains("def greet", StringComparison.Ordinal) && code.Contains("return", StringComparison.Ordinal),
            "python-fastapi-endpoint" => code.Contains("@app.get", StringComparison.Ordinal) && code.Contains("def", StringComparison.Ordinal),
            _ => false
        };
        return new ValidationResult(pythonPassed, pythonPassed ? 2 : 0, 2, pythonPassed ? "All tests passed. Your Python solution meets this lesson’s checks." : lesson.Exercise.Hint, pythonPassed ? lesson.NextSlug : null);
    }
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
    private static readonly VersionStamp PythonCurrent = new("Python 3.14", "FastAPI / Flask / Django", "2026-08-13", "https://docs.python.org/3.14/whatsnew/");
    public static readonly Lesson[] PythonLessons =
    [
        new("python-values", "Python foundations", 1, "Values and variables", "Give values names that reveal their purpose.", "Python variables refer to objects; clear names beat clever abbreviations.", "Start with small, readable expressions. Use f-strings when formatting user-facing text.", "learner = \"Ada\"\ncompleted_lessons = 4\nprint(f\"{learner} has completed {completed_lessons} lessons.\")", new(ExerciseKind.MultipleChoice, "Read the value", "What is `completed_lessons` in this example?", ["Choose one answer"], null, "integer", [new("integer", "An integer value"), new("function", "A function declaration"), new("module", "An imported module")], "It is assigned the whole number 4.", ["Recognizes a basic value"]), "python-functions", PythonCurrent),
        new("python-functions", "Python foundations", 2, "Functions with clear contracts", "Turn repeated behavior into a named, testable unit.", "A function should have a focused purpose, explicit inputs, and a useful return value.", "Use type hints to communicate intent; validate input at boundaries rather than scattering checks throughout your code.", "def greet(name: str) -> str:\n    return f\"Hello, {name}!\"", new(ExerciseKind.Code, "Write a greeting", "Create `greet(name)` that returns a greeting string.", ["Define `greet`", "Accept `name`", "Return a value"], "def greet(name: str) -> str:\n    # return a greeting\n    pass\n", null, [], "Define `greet` and return an f-string instead of printing from the function.", ["Defines function", "Returns greeting"]), "python-data-models", PythonCurrent),
        new("python-data-models", "Python foundations", 3, "Model data deliberately", "Choose the simplest shape that preserves meaning.", "Dataclasses and typed models make domain data easier to understand and validate.", "Use `@dataclass(frozen=True)` for small immutable domain values; use Pydantic models at API boundaries where parsing and validation matter.", "from dataclasses import dataclass\n\n@dataclass(frozen=True)\nclass Lesson:\n    title: str\n    minutes: int", new(ExerciseKind.MultipleChoice, "Choose the boundary", "Where is a Pydantic model most valuable?", ["Choose one answer"], null, "boundary", [new("boundary", "Parsing and validating external API input"), new("loop", "Replacing every loop"), new("inheritance", "Making every class extensible")], "Think about data that enters from outside your trusted code.", ["Recognizes boundary validation"]), "python-tests-errors", PythonCurrent),
        new("python-tests-errors", "Python foundations", 4, "Test behavior and handle errors", "Make failure modes explicit and observable.", "Tests describe the behavior a caller can rely on.", "Use pytest for focused behavior tests. Raise domain-specific exceptions only when callers can recover; translate them to HTTP responses at the API boundary.", "def test_greet_returns_name():\n    assert greet(\"Ada\") == \"Hello, Ada!\"", new(ExerciseKind.MultipleChoice, "Test the contract", "What should a unit test assert first?", ["Choose one answer"], null, "behavior", [new("behavior", "An observable result of the function"), new("private", "The exact private helper call order"), new("style", "Whitespace formatting")], "Test what consumers observe.", ["Tests observable behavior"]), "python-http", PythonCurrent),
        new("python-http", "Web foundations", 5, "Understand HTTP before frameworks", "HTTP semantics are part of your public contract.", "Methods, status codes, headers, and idempotency shape how clients safely interact with your service.", "Use GET for safe reads, POST for creating work, and meaningful 4xx/5xx responses. Validate request data and return stable response shapes.", "GET /lessons/42 HTTP/1.1\nAccept: application/json\n\nHTTP/1.1 200 OK\nContent-Type: application/json", new(ExerciseKind.MultipleChoice, "Choose the status", "Which status fits a successfully created resource?", ["Choose one answer"], null, "created", [new("created", "201 Created"), new("missing", "404 Not Found"), new("server", "500 Internal Server Error")], "Creation has its own success status.", ["Uses HTTP creation semantics"]), "python-framework-choice", PythonCurrent),
        new("python-framework-choice", "Web foundations", 6, "Choose a Python web framework", "Pick the smallest framework that fits your product and team.", "FastAPI, Flask, and Django optimize for different constraints.", "FastAPI is a strong default for typed async APIs, validation, and generated OpenAPI. Flask is minimal and flexible when you want to compose your own stack. Django is batteries-included: ORM, migrations, auth, admin, and templates—excellent when those conventions accelerate a data-heavy product. Avoid selecting by popularity alone; consider team experience, operational ownership, and the surrounding ecosystem.", "# FastAPI: typed API + validation\n# Flask: minimal WSGI composition\n# Django: integrated product framework", new(ExerciseKind.MultipleChoice, "Pick the tradeoff", "Which is the best reason to choose Django?", ["Choose one answer"], null, "django", [new("django", "You benefit from its ORM, migrations, auth, and admin conventions"), new("fast", "It makes every API request faster"), new("async", "It removes every async design decision")], "Choose based on the product capabilities its conventions provide.", ["Evaluates framework tradeoffs"]), "python-fastapi-endpoint", PythonCurrent),
        new("python-fastapi-endpoint", "API delivery", 7, "Build a typed FastAPI endpoint", "Use types and models to make an API contract executable.", "FastAPI turns annotations and Pydantic models into validation and OpenAPI documentation.", "Keep route handlers thin: parse input, call an application service, map expected failures to HTTP. Inject dependencies explicitly so tests can replace them.", "from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get(\"/health\")\ndef health() -> dict[str, str]:\n    return {\"status\": \"ok\"}", new(ExerciseKind.Code, "Add a health endpoint", "Create a FastAPI GET endpoint using `@app.get`.", ["Use `@app.get`", "Define a function", "Return a value"], "from fastapi import FastAPI\n\napp = FastAPI()\n\n# add GET /health below\n", null, [], "Decorate a function with `@app.get(\"/health\")` and return a dictionary.", ["Declares route", "Returns response"]), "python-flask-composition", PythonCurrent),
        new("python-flask-composition", "API delivery", 8, "Compose a Flask service", "Flask gives you primitives; your architecture supplies the discipline.", "Application factories and blueprints keep a Flask codebase testable as it grows.", "Use an application factory to create configuration-specific apps. Group routes in blueprints, keep business rules outside views, and add extensions deliberately rather than globally by accident.", "def create_app() -> Flask:\n    app = Flask(__name__)\n    app.register_blueprint(health_bp)\n    return app", new(ExerciseKind.MultipleChoice, "Choose the Flask shape", "Why use an application factory?", ["Choose one answer"], null, "factory", [new("factory", "Create isolated app configurations for tests and environments"), new("global", "Avoid all configuration"), new("async", "Make every handler asynchronous")], "Think about test isolation and environment-specific configuration.", ["Uses application factory"]), "python-django-product", PythonCurrent),
        new("python-django-product", "API delivery", 9, "Use Django as a product framework", "Leverage conventions when the product needs them.", "Django’s ORM, migrations, admin, auth, and security defaults can shorten the path to a maintainable product.", "Keep models focused on persistence and invariants; place cross-aggregate workflows in services. Treat migrations as reviewed, deployable artifacts—not generated noise.", "class Lesson(models.Model):\n    title = models.CharField(max_length=200)\n    published_at = models.DateTimeField(null=True)", new(ExerciseKind.MultipleChoice, "Protect schema changes", "What belongs in code review with a model change?", ["Choose one answer"], null, "migration", [new("migration", "The generated migration and its rollout impact"), new("admin", "Only the admin page colors"), new("cache", "A cache added without measurement")], "Database changes are production changes.", ["Reviews migrations"]), "python-persistence", PythonCurrent),
        new("python-persistence", "Production systems", 10, "Design persistence and migrations", "A database is a shared, evolving contract.", "Schema changes must be backwards-compatible during rolling deployments.", "Use transactions around a single business operation, add indexes based on measured queries, and expand-then-contract destructive schema changes. Never run an irreversible data migration without a rollback or recovery plan.", "# expand: add nullable column\n# deploy code that writes both forms\n# backfill safely\n# contract: remove old column later", new(ExerciseKind.MultipleChoice, "Plan the rollout", "What is the safest first step for a breaking schema change?", ["Choose one answer"], null, "expand", [new("expand", "Add a backwards-compatible shape before removing the old one"), new("drop", "Drop the old column first"), new("freeze", "Stop all deploys permanently")], "Rolling deploys need old and new code to coexist.", ["Uses expand-contract"]), "python-concurrency", PythonCurrent),
        new("python-concurrency", "Production systems", 11, "Use concurrency intentionally", "Async I/O, workers, and processes solve different problems.", "Concurrency is a capacity and correctness decision, not a style preference.", "Use async for many waiting I/O operations when your dependencies support it. Move durable, retryable background work to a queue. Use processes or purpose-built compute infrastructure for CPU-bound work; measure saturation, queue delay, and failure behavior.", "async def fetch_profile(client: httpx.AsyncClient, user_id: str) -> Profile:\n    response = await client.get(f\"/profiles/{user_id}\")\n    response.raise_for_status()\n    return Profile.model_validate(response.json())", new(ExerciseKind.MultipleChoice, "Choose the tool", "Where should a retryable email send usually run?", ["Choose one answer"], null, "queue", [new("queue", "A durable background queue with retries and observability"), new("request", "Inside the user-facing request forever"), new("thread", "An untracked thread")], "Durable work needs durable ownership.", ["Uses durable background work"]), "python-security-observability", PythonCurrent),
        new("python-security-observability", "Production systems", 12, "Secure and observe the service", "Production quality is evidence, not hope.", "Security, structured logs, metrics, traces, and health signals are design constraints.", "Validate untrusted input, use parameterized queries, keep secrets out of source and logs, set timeouts on network calls, and emit structured events with correlation IDs. Define SLOs around user-visible behavior before choosing alerts.", "logger.info(\"order_created\", extra={\"order_id\": order.id, \"request_id\": request_id})", new(ExerciseKind.MultipleChoice, "Choose the signal", "What makes a useful operational alert?", ["Choose one answer"], null, "slo", [new("slo", "It indicates sustained user-impacting SLO risk"), new("noise", "It fires for every debug log"), new("secret", "It includes credentials for convenience")], "Alerts should prompt action, not create background noise.", ["Designs actionable alerts"]), "python-staff-architecture", PythonCurrent),
        new("python-staff-architecture", "Staff practice", 13, "Lead Python systems at staff level", "Turn technical ambiguity into an operable decision.", "Staff engineers clarify constraints, make tradeoffs legible, and create leverage for teams.", "For a Python platform, make runtime versions, dependency policy, delivery standards, observability, and ownership explicit. Choose monolith, modular monolith, services, queues, or workflows based on measured constraints. Write decisions with context, alternatives, consequences, rollout, and reversal signals.", "# ADR: Extract notifications behind a queue\n# Context: checkout latency and retry ownership\n# Decision: asynchronous delivery with idempotency keys\n# Revisit when: queue delay exceeds SLO", new(ExerciseKind.MultipleChoice, "Make the staff move", "What should come before splitting a Python service?", ["Choose one answer"], null, "evidence", [new("evidence", "Measure the bottleneck, ownership boundaries, and operational tradeoffs"), new("rewrite", "Rewrite everything as microservices"), new("trend", "Copy the newest architecture trend")], "Staff decisions start with evidence and a reversible plan.", ["Frames an architecture decision"]), null, PythonCurrent)
    ];
    public static readonly Dictionary<string, Lesson> BySlug = Lessons.Concat(PythonLessons).ToDictionary(lesson => lesson.Slug, StringComparer.Ordinal);
    public static readonly Course Course = BuildCourse("csharp-dotnet", "C# / .NET: zero to staff", "csharp", "C# 14", ".NET 10", "2026-08-12", Lessons);
    public static readonly Course PythonCourse = BuildCourse("python-web", "Python Web: zero to staff", "python", "Python 3.14", "FastAPI · Flask · Django", "2026-08-13", PythonLessons);
    public static readonly IReadOnlyDictionary<string, Course> Courses = new Dictionary<string, Course>(StringComparer.Ordinal)
    {
        [Course.Id] = Course,
        [PythonCourse.Id] = PythonCourse
    };
    public static readonly IReadOnlyList<CourseCatalogItem> Catalog =
    [
        new(Course.Id, Course.Title, Course.LanguageId, Course.LanguageVersion, Course.FrameworkVersion, true),
        new(PythonCourse.Id, PythonCourse.Title, PythonCourse.LanguageId, PythonCourse.LanguageVersion, PythonCourse.FrameworkVersion, true)
    ];

    private static Course BuildCourse(string id, string title, string languageId, string languageVersion, string frameworkVersion, string reviewed, Lesson[] lessons) => new(id, title, languageId, languageVersion, frameworkVersion, reviewed,
        lessons.GroupBy(lesson => lesson.Module).Select(group => new Module(group.Key.ToLowerInvariant().Replace(' ', '-'), group.Key, group.Key.Contains("foundations", StringComparison.OrdinalIgnoreCase) ? "Beginner" : group.Key.Contains("staff", StringComparison.OrdinalIgnoreCase) ? "Staff" : "Professional", group.Select(l => new LessonSummary(l.Slug, l.Title, l.Order)).ToArray())).ToArray());
}
