using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Pathway.Api;

public static class LearningExperienceEndpoints
{
    public static RouteGroupBuilder MapLearningExperienceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/experience");
        group.MapGet("/dashboard", GetDashboard);
        group.MapGet("/reviews", GetDueReviews);
        group.MapPost("/reviews/{lessonSlug}/complete", CompleteReview);
        group.MapGet("/projects/templates", () => Results.Ok(ProjectTemplates.All));
        group.MapGet("/projects", GetProjects);
        group.MapPost("/projects/{templateId}", CreateProject);
        group.MapGet("/projects/{projectId:guid}", GetProject);
        group.MapPut("/projects/{projectId:guid}/files/{*path}", SaveProjectFile);
        group.MapGet("/assessments/{courseId}/{moduleId}", GetAssessment);
        group.MapPost("/assessments/{courseId}/{moduleId}", SubmitAssessment);
        group.MapPost("/coach", Coach);
        group.MapGet("/community/{courseId}", GetCommunityPosts);
        group.MapPost("/community/{courseId}", CreateCommunityPost);
        group.MapPost("/community/posts/{postId:guid}/replies", CreateCommunityReply);
        return group;
    }

    private static async Task<IResult> GetDashboard(HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var learnerId = ResolveLearnerId(context);
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Ok(new DashboardResponse(learnerId, 0, Curriculum.BySlug.Count, 0, 0, [], []));
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var completed = await db.Progress.Where(item => item.LearnerId == learnerId).OrderByDescending(item => item.CompletedAt).ToListAsync(cancellationToken);
        var due = await db.ReviewSchedules.Where(item => item.LearnerId == learnerId && item.DueAt <= DateTimeOffset.UtcNow).OrderBy(item => item.DueAt).Select(item => item.LessonSlug).ToArrayAsync(cancellationToken);
        var projectCount = await db.WorkspaceProjects.CountAsync(item => item.LearnerId == learnerId, cancellationToken);
        var streak = CalculateStreak(completed.Select(item => item.CompletedAt));
        var recent = completed.Take(5).Select(item => new RecentCompletion(item.LessonSlug, item.CompletedAt)).ToArray();
        return Results.Ok(new DashboardResponse(learnerId, completed.Count, Curriculum.BySlug.Count, streak, projectCount, due, recent));
    }

    private static async Task<IResult> GetDueReviews(HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var learnerId = ResolveLearnerId(context);
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Ok(Array.Empty<ReviewItemResponse>());
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var schedules = await db.ReviewSchedules.Where(item => item.LearnerId == learnerId && item.DueAt <= DateTimeOffset.UtcNow).OrderBy(item => item.DueAt).ToListAsync(cancellationToken);
        return Results.Ok(schedules.Where(item => Curriculum.BySlug.TryGetValue(item.LessonSlug, out _)).Select(item => new ReviewItemResponse(item.LessonSlug, Curriculum.BySlug[item.LessonSlug].Title, item.DueAt, item.IntervalDays)));
    }

    private static async Task<IResult> CompleteReview(string lessonSlug, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var learnerId = ResolveLearnerId(context);
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null || !Curriculum.BySlug.ContainsKey(lessonSlug)) return Results.NotFound();
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var review = await db.ReviewSchedules.SingleOrDefaultAsync(item => item.LearnerId == learnerId && item.LessonSlug == lessonSlug, cancellationToken);
        if (review is null) return Results.NotFound();
        review.IntervalDays = Math.Min(review.IntervalDays * 2, 30);
        review.LastReviewedAt = DateTimeOffset.UtcNow;
        review.DueAt = DateTimeOffset.UtcNow.AddDays(review.IntervalDays);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new ReviewItemResponse(review.LessonSlug, Curriculum.BySlug[review.LessonSlug].Title, review.DueAt, review.IntervalDays));
    }

    private static async Task<IResult> GetProjects(HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Ok(Array.Empty<ProjectSummaryResponse>());
        var learnerId = ResolveLearnerId(context);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var projects = await db.WorkspaceProjects.Where(item => item.LearnerId == learnerId).OrderByDescending(item => item.UpdatedAt).ToListAsync(cancellationToken);
        return Results.Ok(projects.Select(item => new ProjectSummaryResponse(item.Id, item.TemplateId, item.Title, item.UpdatedAt)));
    }

    private static async Task<IResult> CreateProject(string templateId, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!ProjectTemplates.ById.TryGetValue(templateId, out var template)) return Results.NotFound();
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Problem("Project persistence requires a database.", statusCode: StatusCodes.Status503ServiceUnavailable);
        var learnerId = ResolveLearnerId(context);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var project = await db.WorkspaceProjects.SingleOrDefaultAsync(item => item.LearnerId == learnerId && item.TemplateId == templateId, cancellationToken);
        if (project is null)
        {
            project = new WorkspaceProject { LearnerId = learnerId, TemplateId = templateId, Title = template.Title };
            db.WorkspaceProjects.Add(project);
            db.WorkspaceFiles.AddRange(template.Files.Select(file => new WorkspaceFile { ProjectId = project.Id, Path = file.Path, Content = file.Content }));
            await db.SaveChangesAsync(cancellationToken);
        }
        return Results.Ok(await ToProjectResponse(db, project, cancellationToken));
    }

    private static async Task<IResult> GetProject(Guid projectId, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.NotFound();
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var project = await db.WorkspaceProjects.SingleOrDefaultAsync(item => item.Id == projectId && item.LearnerId == ResolveLearnerId(context), cancellationToken);
        return project is null ? Results.NotFound() : Results.Ok(await ToProjectResponse(db, project, cancellationToken));
    }

    private static async Task<IResult> SaveProjectFile(Guid projectId, string path, SaveFileRequest request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 260 || path.Contains("..", StringComparison.Ordinal) || request.Content.Length > 100_000) return Results.BadRequest(new { message = "Use a safe relative path and keep files under 100 KB." });
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Problem("Project persistence requires a database.", statusCode: StatusCodes.Status503ServiceUnavailable);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var project = await db.WorkspaceProjects.SingleOrDefaultAsync(item => item.Id == projectId && item.LearnerId == ResolveLearnerId(context), cancellationToken);
        if (project is null) return Results.NotFound();
        var file = await db.WorkspaceFiles.SingleOrDefaultAsync(item => item.ProjectId == projectId && item.Path == path, cancellationToken);
        if (file is null) db.WorkspaceFiles.Add(new WorkspaceFile { ProjectId = projectId, Path = path, Content = request.Content });
        else { file.Content = request.Content; file.UpdatedAt = DateTimeOffset.UtcNow; }
        project.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static IResult GetAssessment(string courseId, string moduleId)
    {
        var assessment = AssessmentCatalog.Get(courseId, moduleId);
        return assessment is null ? Results.NotFound() : Results.Ok(assessment with { Questions = assessment.Questions.Select(question => question with { CorrectAnswer = null }).ToArray() });
    }

    private static IResult SubmitAssessment(string courseId, string moduleId, AssessmentSubmission submission)
    {
        var assessment = AssessmentCatalog.Get(courseId, moduleId);
        if (assessment is null) return Results.NotFound();
        var answers = submission.Answers ?? new Dictionary<string, string>();
        var correct = assessment.Questions.Count(question => answers.TryGetValue(question.Id, out var answer) && answer == question.CorrectAnswer);
        var passed = correct >= Math.Ceiling(assessment.Questions.Length * .7);
        var recommended = assessment.Questions.Where(question => !answers.TryGetValue(question.Id, out var answer) || answer != question.CorrectAnswer).Select(question => question.ReviewLessonSlug).Distinct().ToArray();
        return Results.Ok(new AssessmentResultResponse(passed, correct, assessment.Questions.Length, recommended, passed ? "Module checkpoint passed. Keep the retrieval practice going." : "Review the suggested lessons, then return for another attempt."));
    }

    private static IResult Coach(CoachRequest request)
    {
        var message = request.Message?.Trim();
        if (string.IsNullOrWhiteSpace(message) || message.Length > 2_000) return Results.BadRequest(new { message = "Keep coaching prompts between 1 and 2,000 characters." });
        if (ContainsSecret(message)) return Results.BadRequest(new { message = "Remove credentials, tokens, connection strings, and personal data before asking for coaching." });
        if (!Curriculum.BySlug.TryGetValue(request.LessonSlug, out var lesson)) return Results.NotFound();
        var asksForAnswer = message.Contains("give me the answer", StringComparison.OrdinalIgnoreCase) || message.Contains("solve it", StringComparison.OrdinalIgnoreCase);
        var response = asksForAnswer
            ? $"I won’t provide a copy-paste solution. Start from this idea: {lesson.Concept} Try the smallest change that satisfies one requirement, then tell me what result you observe."
            : $"Let’s reason from the contract: {lesson.Concept} Re-read the requirement, identify the input and expected output, then test the smallest hypothesis. Hint: {lesson.Exercise.Hint}";
        return Results.Ok(new CoachResponse(response, ["No credentials or personal data", "Guidance first; no full solution", "Verify each small change with a test"]));
    }

    private static async Task<IResult> GetCommunityPosts(string courseId, IServiceProvider services, CancellationToken cancellationToken)
    {
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Ok(Array.Empty<CommunityPostResponse>());
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var posts = await db.CommunityPosts.Where(item => item.CourseId == courseId).OrderByDescending(item => item.CreatedAt).Take(50).ToListAsync(cancellationToken);
        var postIds = posts.Select(item => item.Id).ToArray();
        var replies = await db.CommunityReplies.Where(item => postIds.Contains(item.PostId)).OrderBy(item => item.CreatedAt).ToListAsync(cancellationToken);
        return Results.Ok(posts.Select(post => ToCommunityResponse(post, replies.Where(reply => reply.PostId == post.Id))));
    }

    private static async Task<IResult> CreateCommunityPost(string courseId, CommunityPostRequest request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!Curriculum.Courses.ContainsKey(courseId) || !IsCommunityTextValid(request.Title, 180) || !IsCommunityTextValid(request.Body, 10_000)) return Results.BadRequest(new { message = "Provide a clear title and a respectful question or update." });
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Problem("Community persistence requires a database.", statusCode: StatusCodes.Status503ServiceUnavailable);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var post = new CommunityPost { AuthorId = ResolveLearnerId(context), CourseId = courseId, Title = request.Title!.Trim(), Body = request.Body!.Trim(), NeedsMentor = request.NeedsMentor };
        db.CommunityPosts.Add(post);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Created($"/api/experience/community/{courseId}", ToCommunityResponse(post, []));
    }

    private static async Task<IResult> CreateCommunityReply(Guid postId, CommunityReplyRequest request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!IsCommunityTextValid(request.Body, 10_000)) return Results.BadRequest(new { message = "Provide a respectful, specific reply." });
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Problem("Community persistence requires a database.", statusCode: StatusCodes.Status503ServiceUnavailable);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        if (!await db.CommunityPosts.AnyAsync(item => item.Id == postId, cancellationToken)) return Results.NotFound();
        var reply = new CommunityReply { PostId = postId, AuthorId = ResolveLearnerId(context), Body = request.Body!.Trim(), IsMentor = context.User.IsInRole("mentor") };
        db.CommunityReplies.Add(reply);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Created($"/api/experience/community/posts/{postId}/replies", new CommunityReplyResponse(reply.Id, reply.Body, reply.IsMentor, reply.CreatedAt));
    }

    private static async Task<ProjectResponse> ToProjectResponse(ProgressDbContext db, WorkspaceProject project, CancellationToken cancellationToken) => new(project.Id, project.TemplateId, project.Title, project.UpdatedAt, await db.WorkspaceFiles.Where(item => item.ProjectId == project.Id).OrderBy(item => item.Path).Select(item => new ProjectFileResponse(item.Path, item.Content, item.UpdatedAt)).ToArrayAsync(cancellationToken));
    private static CommunityPostResponse ToCommunityResponse(CommunityPost post, IEnumerable<CommunityReply> replies) => new(post.Id, post.Title, post.Body, post.NeedsMentor, post.CreatedAt, replies.Select(reply => new CommunityReplyResponse(reply.Id, reply.Body, reply.IsMentor, reply.CreatedAt)).ToArray());
    private static bool IsCommunityTextValid(string? text, int max) => !string.IsNullOrWhiteSpace(text) && text.Trim().Length <= max && !ContainsSecret(text);
    private static bool ContainsSecret(string text) => text.Contains("BEGIN PRIVATE KEY", StringComparison.OrdinalIgnoreCase) || text.Contains("password=", StringComparison.OrdinalIgnoreCase) || text.Contains("api_key", StringComparison.OrdinalIgnoreCase) || text.Contains("authorization: bearer", StringComparison.OrdinalIgnoreCase);
    private static string ResolveLearnerId(HttpContext context) => context.User.FindFirstValue("sub") is { Length: > 0 } subject ? $"keycloak:{subject}" : context.Request.Headers["X-Learner-Id"].FirstOrDefault() is { Length: > 0 and <= 100 } learnerId ? learnerId : "anonymous";
    private static int CalculateStreak(IEnumerable<DateTimeOffset> dates) { var days = dates.Select(date => DateOnly.FromDateTime(date.UtcDateTime)).Distinct().ToHashSet(); var today = DateOnly.FromDateTime(DateTime.UtcNow); var streak = 0; while (days.Contains(today.AddDays(-streak))) streak++; return streak; }
}

public record DashboardResponse(string LearnerId, int CompletedLessons, int TotalLessons, int CurrentStreakDays, int ProjectCount, string[] DueReviewLessonSlugs, RecentCompletion[] RecentCompletions);
public record RecentCompletion(string LessonSlug, DateTimeOffset CompletedAt);
public record ReviewItemResponse(string LessonSlug, string Title, DateTimeOffset DueAt, int IntervalDays);
public record ProjectTemplate(string Id, string Title, string Description, string Language, ProjectSeedFile[] Files);
public record ProjectSeedFile(string Path, string Content);
public record ProjectSummaryResponse(Guid Id, string TemplateId, string Title, DateTimeOffset UpdatedAt);
public record ProjectResponse(Guid Id, string TemplateId, string Title, DateTimeOffset UpdatedAt, ProjectFileResponse[] Files);
public record ProjectFileResponse(string Path, string Content, DateTimeOffset UpdatedAt);
public record SaveFileRequest(string Content);
public record AssessmentQuestion(string Id, string Prompt, string[] Choices, string? CorrectAnswer, string ReviewLessonSlug);
public record ModuleAssessment(string CourseId, string ModuleId, string Title, AssessmentQuestion[] Questions);
public record AssessmentSubmission(Dictionary<string, string>? Answers);
public record AssessmentResultResponse(bool Passed, int CorrectAnswers, int TotalQuestions, string[] RecommendedReviewLessonSlugs, string Feedback);
public record CoachRequest(string LessonSlug, string? Message);
public record CoachResponse(string Guidance, string[] Guardrails);
public record CommunityPostRequest(string? Title, string? Body, bool NeedsMentor);
public record CommunityReplyRequest(string? Body);
public record CommunityPostResponse(Guid Id, string Title, string Body, bool NeedsMentor, DateTimeOffset CreatedAt, CommunityReplyResponse[] Replies);
public record CommunityReplyResponse(Guid Id, string Body, bool IsMentor, DateTimeOffset CreatedAt);

public static class ProjectTemplates
{
    public static readonly ProjectTemplate[] All =
    [
        new("python-learning-api", "Learning API", "Build a typed API with tests, persistence boundaries, and a health endpoint.", "python", [new("src/learning_service/main.py", "from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get(\"/health\")\ndef health() -> dict[str, str]:\n    return {\"status\": \"ok\"}\n"), new("tests/test_health.py", "from fastapi.testclient import TestClient\nfrom learning_service.main import app\n\ndef test_health() -> None:\n    response = TestClient(app).get(\"/health\")\n    assert response.status_code == 200\n")]),
        new("python-production-api", "Production-ready FastAPI", "Ship a typed, tested API with configuration boundaries, health checks, and deployment notes.", "python", [new("src/app/main.py", "from fastapi import FastAPI\n\napp = FastAPI(title=\"Portfolio API\")\n\n@app.get(\"/health\")\ndef health() -> dict[str, str]:\n    return {\"status\": \"ok\"}\n"), new("tests/test_health.py", "def test_health_contract() -> None:\n    # Start by defining the observable HTTP contract.\n    assert True\n"), new("README.md", "# Production-ready FastAPI\n\nDocument the API contract, test strategy, observability signals, and deployment runbook.\n")]),
        new("python-event-pipeline", "Event pipeline", "Design an idempotent background-processing pipeline with retries, metrics, and failure handling.", "python", [new("src/pipeline/consumer.py", "def process_event(event_id: str, payload: dict[str, object]) -> None:\n    # Make idempotency and retry behavior explicit.\n    raise NotImplementedError\n"), new("README.md", "# Event pipeline\n\nCapture delivery semantics, idempotency keys, retry policy, alerts, and recovery procedures.\n")]),
        new("csharp-learning-api", "Learning API", "Build a modern .NET API with clear contracts and cancellation-aware boundaries.", "csharp", [new("Program.cs", "var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\n\napp.MapGet(\"/health\", () => Results.Ok(new { status = \"ok\" }));\n\napp.Run();\n"), new("README.md", "# Learning API\n\nDescribe the contract, tests, and delivery plan here.\n")]),
        new("csharp-order-api", "Order API", "Deliver a sealed, testable .NET API with contracts, validation, cancellation, and operational health checks.", "csharp", [new("Program.cs", "var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\n\napp.MapGet(\"/health\", () => Results.Ok(new { status = \"ok\" }));\napp.MapPost(\"/orders\", (CreateOrder request, CancellationToken cancellationToken) => Results.Accepted());\napp.Run();\n\npublic sealed record CreateOrder(string CustomerId, IReadOnlyList<string> SkuIds);\n"), new("README.md", "# Order API\n\nDefine boundaries, validation, test cases, observability, and deployment rollback criteria.\n")]),
        new("csharp-worker", "Background worker", "Build a resilient .NET worker with idempotency, bounded retries, and observable failure paths.", "csharp", [new("Worker.cs", "public sealed class EventProcessor\n{\n    public Task ProcessAsync(string eventId, CancellationToken cancellationToken)\n        => throw new NotImplementedException();\n}\n"), new("README.md", "# Background worker\n\nDocument queue semantics, retry budget, dead-letter policy, alerts, and runbook.\n")])
    ];
    public static readonly IReadOnlyDictionary<string, ProjectTemplate> ById = All.ToDictionary(item => item.Id, StringComparer.Ordinal);
}

public static class AssessmentCatalog
{
    private static readonly ModuleAssessment[] All =
    [
        new("python-web", "python-foundations", "Python foundations checkpoint", [new("values", "Which collection models unique permission names?", ["list", "set", "tuple"], "set", "python-control-flow-collections"), new("contract", "What should a focused function return?", ["A useful value or explicit None", "Printed output only", "Global mutable state"], "A useful value or explicit None", "python-functions"), new("boundary", "Where should external input be validated?", ["At an application boundary", "Only in templates", "Never"], "At an application boundary", "python-data-models")]),
        new("csharp-dotnet", "foundations", "C# foundations checkpoint", [new("value", "Which type fits a whole-number count?", ["int", "string", "bool"], "int", "foundations-values"), new("condition", "What does an if statement require?", ["A boolean condition", "A database", "A loop"], "A boolean condition", "foundations-making-decisions"), new("record", "What do records express well?", ["Value-based data", "Hidden global state", "Unbounded inheritance"], "Value-based data", "modern-csharp-records")])
    ];
    public static ModuleAssessment? Get(string courseId, string moduleId) => All.SingleOrDefault(item => item.CourseId == courseId && item.ModuleId == moduleId);
}
