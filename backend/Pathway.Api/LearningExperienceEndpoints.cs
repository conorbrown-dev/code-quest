using System.Security.Claims;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Pathway.Api;

public static class LearningExperienceEndpoints
{
    public static RouteGroupBuilder MapLearningExperienceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/experience");
        group.RequireRateLimiting("learner");
        group.MapGet("/dashboard", GetDashboard);
        group.MapGet("/reviews", GetDueReviews);
        group.MapPost("/reviews/{lessonSlug}/complete", CompleteReview);
        group.MapGet("/projects/templates", () => Results.Ok(ProjectTemplates.All));
        group.MapGet("/projects", GetProjects);
        group.MapPost("/projects/{templateId}", CreateProject);
        group.MapGet("/projects/{projectId:guid}", GetProject);
        group.MapPut("/projects/{projectId:guid}/files/{*path}", SaveProjectFile);
        group.MapGet("/career/{courseId}/capstones", (string courseId) => Results.Ok(CareerReadinessCatalog.CapstonesFor(courseId)));
        group.MapPost("/career/{courseId}/capstones/{capstoneId}/review", ReviewCapstone);
        group.MapPost("/career/{courseId}/capstones/{capstoneId}/review-request", CreateCapstoneReviewRequest).RequireRateLimiting("community-write");
        group.MapGet("/career/{courseId}/competencies", GetCompetencies);
        group.MapGet("/career/{courseId}/scenarios", (string courseId) => Results.Ok(CareerReadinessCatalog.ScenariosFor(courseId)));
        group.MapPost("/career/{courseId}/scenarios/{scenarioId}/review", ReviewScenario);
        group.MapGet("/career/{courseId}/outcomes", GetOutcomes);
        group.MapPut("/career/{courseId}/outcomes", SaveOutcomes);
        group.MapGet("/assessments/{courseId}/{moduleId}", GetAssessment);
        group.MapPost("/assessments/{courseId}/{moduleId}", SubmitAssessment);
        group.MapPost("/coach", Coach).RequireRateLimiting("coach");
        group.MapGet("/community/{courseId}", GetCommunityPosts);
        group.MapPost("/community/{courseId}", CreateCommunityPost).RequireRateLimiting("community-write");
        group.MapGet("/community/{courseId}/peer-matches", GetPeerMatches);
        group.MapPut("/community/{courseId}/peer-profile", SavePeerProfile).RequireRateLimiting("community-write");
        group.MapPost("/community/posts/{postId:guid}/replies", CreateCommunityReply).RequireRateLimiting("community-write");
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

    private static async Task<IResult> GetCompetencies(string courseId, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!Curriculum.Courses.TryGetValue(courseId, out var course)) return Results.NotFound();
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        var completed = 0;
        if (factory is not null)
        {
            await using var db = await factory.CreateDbContextAsync(cancellationToken);
            completed = await db.Progress.CountAsync(item => item.LearnerId == ResolveLearnerId(context) && Curriculum.BySlug.ContainsKey(item.LessonSlug), cancellationToken);
        }
        var total = course.Modules.Sum(module => module.Lessons.Count);
        var baseline = total == 0 ? 0 : (int)Math.Floor(completed / (double)total * 3);
        return Results.Ok(CareerReadinessCatalog.Competencies.Select(item => new CompetencyEvidenceResponse(item.Id, item.Title, item.Description, Math.Min(item.Evidence.Length, baseline), item.Evidence.Length, item.Evidence)));
    }

    private static async Task<IResult> ReviewCapstone(string courseId, string capstoneId, CapstoneReviewRequest request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var capstone = CareerReadinessCatalog.CapstonesFor(courseId).SingleOrDefault(item => item.Id == capstoneId);
        if (capstone is null) return Results.NotFound();
        var evidence = request.Evidence ?? [];
        var missing = new List<string>();
        if (!IsSafeHttpsUrl(request.DemoUrl)) missing.Add("A public HTTPS demo link");
        if (!IsSafeHttpsUrl(request.ArchitectureUrl)) missing.Add("An HTTPS architecture diagram link");
        if (!IsSafeHttpsUrl(request.RepositoryUrl)) missing.Add("An HTTPS repository link");
        foreach (var rubric in capstone.Rubric) if (!evidence.TryGetValue(rubric.Id, out var value) || string.IsNullOrWhiteSpace(value) || value.Trim().Length < 20) missing.Add(rubric.Title);
        var satisfied = capstone.Rubric.Length + 3 - missing.Count;
        var ready = missing.Count == 0;
        var recommendedLessons = CareerReadinessCatalog.RecommendedLessons(courseId, missing);
        await ScheduleRecommendedReviews(recommendedLessons, context, services, cancellationToken);
        return Results.Ok(new CapstoneReviewResponse(ready, satisfied, capstone.Rubric.Length + 3, missing.ToArray(), ready ? ["Your submission satisfies the self-review gate. Request rubric-guided peer or mentor review next."] : ["Complete the missing evidence before requesting review.", "Evidence should explain a concrete decision, not merely claim that it exists."], recommendedLessons));
    }

    private static async Task<IResult> ReviewScenario(string courseId, string scenarioId, ScenarioReviewRequest request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var scenario = CareerReadinessCatalog.ScenariosFor(courseId).SingleOrDefault(item => item.Id == scenarioId);
        if (scenario is null) return Results.NotFound();
        var responses = request.Responses ?? [];
        var missing = scenario.Deliverables.Where(item => !responses.TryGetValue(item, out var response) || string.IsNullOrWhiteSpace(response) || response.Trim().Length < 60).ToArray();
        var ready = missing.Length == 0;
        var recommendedLessons = CareerReadinessCatalog.RecommendedLessons(courseId, missing);
        await ScheduleRecommendedReviews(recommendedLessons, context, services, cancellationToken);
        return Results.Ok(new ScenarioReviewResponse(ready, scenario.Deliverables.Length - missing.Length, scenario.Deliverables.Length, missing, ready
            ? ["This is ready for peer or mentor feedback. Re-read it once for a concrete claim, evidence, and next action in every section.", "Capture the strongest response in your portfolio evidence."]
            : ["Make each response specific: name the evidence, decision, tradeoff, and next action.", "A good engineering response is not a list of buzzwords; it is a defensible decision under constraints."], recommendedLessons));
    }

    private static async Task<IResult> CreateCapstoneReviewRequest(string courseId, string capstoneId, CapstoneReviewRequestPost request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var capstone = CareerReadinessCatalog.CapstonesFor(courseId).SingleOrDefault(item => item.Id == capstoneId);
        if (capstone is null) return Results.NotFound();
        var evidence = request.Evidence ?? [];
        var isGateComplete = IsSafeHttpsUrl(request.DemoUrl) && IsSafeHttpsUrl(request.ArchitectureUrl) && IsSafeHttpsUrl(request.RepositoryUrl)
            && capstone.Rubric.All(item => evidence.TryGetValue(item.Id, out var value) && !string.IsNullOrWhiteSpace(value) && value.Trim().Length >= 20);
        if (!isGateComplete || !IsCommunityTextValid(request.ReviewFocus, 2_000)) return Results.BadRequest(new { message = "Complete the capstone gate and provide a specific review focus before requesting feedback." });
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Problem("Community persistence requires a database.", statusCode: StatusCodes.Status503ServiceUnavailable);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var body = $"Rubric-guided review requested.\n\nDemo: {request.DemoUrl!.Trim()}\nArchitecture: {request.ArchitectureUrl!.Trim()}\nRepository: {request.RepositoryUrl!.Trim()}\n\nReview focus: {request.ReviewFocus!.Trim()}\n\nPlease leave constructive, evidence-based feedback against the requirements, API design, tests, delivery, security, observability, deployment, README, and tradeoffs.";
        var post = new CommunityPost { AuthorId = ResolveLearnerId(context), CourseId = courseId, Title = $"Review request: {capstone.Title}", Body = body, NeedsMentor = true };
        db.CommunityPosts.Add(post);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Created($"/api/experience/community/{courseId}", ToCommunityResponse(post, []));
    }

    private static async Task ScheduleRecommendedReviews(IEnumerable<string> lessonSlugs, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var slugs = lessonSlugs.Where(Curriculum.BySlug.ContainsKey).Distinct(StringComparer.Ordinal).ToArray();
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null || slugs.Length == 0) return;
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var learnerId = ResolveLearnerId(context);
        foreach (var lessonSlug in slugs)
        {
            var review = await db.ReviewSchedules.SingleOrDefaultAsync(item => item.LearnerId == learnerId && item.LessonSlug == lessonSlug, cancellationToken);
            if (review is null) db.ReviewSchedules.Add(new ReviewSchedule { LearnerId = learnerId, LessonSlug = lessonSlug, IntervalDays = 1, LastReviewedAt = DateTimeOffset.UtcNow, DueAt = DateTimeOffset.UtcNow });
            else { review.IntervalDays = 1; review.LastReviewedAt = DateTimeOffset.UtcNow; review.DueAt = DateTimeOffset.UtcNow; }
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task<IResult> GetOutcomes(string courseId, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!Curriculum.Courses.TryGetValue(courseId, out var course)) return Results.NotFound();
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Ok(OutcomeMetricsResponse.Empty(courseId));
        var learnerId = ResolveLearnerId(context);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var lessonSlugs = course.Modules.SelectMany(module => module.Lessons).Select(lesson => lesson.Slug).ToHashSet(StringComparer.Ordinal);
        var submissions = await db.Submissions.Where(item => item.LearnerId == learnerId && lessonSlugs.Contains(item.LessonSlug)).ToListAsync(cancellationToken);
        var completed = await db.Progress.CountAsync(item => item.LearnerId == learnerId && lessonSlugs.Contains(item.LessonSlug), cancellationToken);
        var checkIn = await db.CareerOutcomeCheckIns.SingleOrDefaultAsync(item => item.LearnerId == learnerId && item.CourseId == courseId, cancellationToken);
        var firstAttempt = submissions.OrderBy(item => item.CreatedAt).Select(item => (DateTimeOffset?)item.CreatedAt).FirstOrDefault();
        return Results.Ok(new OutcomeMetricsResponse(courseId, completed, lessonSlugs.Count, submissions.Count, submissions.Count(item => item.Passed), firstAttempt, checkIn?.InterviewReadiness ?? 0, checkIn?.MentorReadiness ?? 0, checkIn?.JobSearchStage, checkIn?.PortfolioUrl, checkIn?.UpdatedAt));
    }

    private static async Task<IResult> SaveOutcomes(string courseId, OutcomeCheckInRequest request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!Curriculum.Courses.ContainsKey(courseId) || request.InterviewReadiness is < 0 or > 5 || request.MentorReadiness is < 0 or > 5 || !IsOptionalSafeHttpsUrl(request.PortfolioUrl) || request.JobSearchStage?.Length > 80) return Results.BadRequest(new { message = "Use readiness scores from 0–5 and an optional safe HTTPS portfolio URL." });
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Problem("Outcome tracking requires a database.", statusCode: StatusCodes.Status503ServiceUnavailable);
        var learnerId = ResolveLearnerId(context);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var checkIn = await db.CareerOutcomeCheckIns.SingleOrDefaultAsync(item => item.LearnerId == learnerId && item.CourseId == courseId, cancellationToken);
        if (checkIn is null) { checkIn = new CareerOutcomeCheckIn { LearnerId = learnerId, CourseId = courseId }; db.CareerOutcomeCheckIns.Add(checkIn); }
        checkIn.InterviewReadiness = request.InterviewReadiness;
        checkIn.MentorReadiness = request.MentorReadiness;
        checkIn.JobSearchStage = request.JobSearchStage?.Trim();
        checkIn.PortfolioUrl = request.PortfolioUrl?.Trim();
        checkIn.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
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
        if (!IsSafeProjectPath(path) || string.IsNullOrWhiteSpace(request.Content) || Encoding.UTF8.GetByteCount(request.Content) > 100_000) return Results.BadRequest(new { message = "Use a safe relative path and keep files under 100 KB." });
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

    private static async Task<IResult> SubmitAssessment(string courseId, string moduleId, AssessmentSubmission submission, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        var assessment = AssessmentCatalog.Get(courseId, moduleId);
        if (assessment is null) return Results.NotFound();
        var answers = submission.Answers ?? new Dictionary<string, string>();
        var correct = assessment.Questions.Count(question => answers.TryGetValue(question.Id, out var answer) && answer == question.CorrectAnswer);
        var passed = correct >= Math.Ceiling(assessment.Questions.Length * .7);
        var recommended = assessment.Questions.Where(question => !answers.TryGetValue(question.Id, out var answer) || answer != question.CorrectAnswer).Select(question => question.ReviewLessonSlug).Distinct().ToArray();
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is not null)
        {
            var learnerId = ResolveLearnerId(context);
            await using var db = await factory.CreateDbContextAsync(cancellationToken);
            foreach (var lessonSlug in recommended)
            {
                var review = await db.ReviewSchedules.SingleOrDefaultAsync(item => item.LearnerId == learnerId && item.LessonSlug == lessonSlug, cancellationToken);
                if (review is null) db.ReviewSchedules.Add(new ReviewSchedule { LearnerId = learnerId, LessonSlug = lessonSlug, IntervalDays = 1, LastReviewedAt = DateTimeOffset.UtcNow, DueAt = DateTimeOffset.UtcNow });
                else { review.IntervalDays = 1; review.LastReviewedAt = DateTimeOffset.UtcNow; review.DueAt = DateTimeOffset.UtcNow; }
            }
            if (recommended.Length > 0) await db.SaveChangesAsync(cancellationToken);
        }
        return Results.Ok(new AssessmentResultResponse(passed, correct, assessment.Questions.Length, recommended, passed ? "Module checkpoint passed. Keep the retrieval practice going." : "Review the suggested lessons, then return for another attempt."));
    }

    private static async Task<IResult> Coach(CoachRequest request, IConfiguration configuration, IHttpClientFactory httpClientFactory, CancellationToken cancellationToken)
    {
        var message = request.Message?.Trim();
        if (string.IsNullOrWhiteSpace(message) || message.Length > 2_000) return Results.BadRequest(new { message = "Keep coaching prompts between 1 and 2,000 characters." });
        if (ContainsSecret(message)) return Results.BadRequest(new { message = "Remove credentials, tokens, connection strings, and personal data before asking for coaching." });
        if (!Curriculum.BySlug.TryGetValue(request.LessonSlug, out var lesson)) return Results.NotFound();
        var asksForAnswer = message.Contains("give me the answer", StringComparison.OrdinalIgnoreCase) || message.Contains("solve it", StringComparison.OrdinalIgnoreCase);
        var fallback = asksForAnswer
            ? $"I won’t provide a copy-paste solution. Start from this idea: {lesson.Concept} Try the smallest change that satisfies one requirement, then tell me what result you observe."
            : $"Let’s reason from the contract: {lesson.Concept} Re-read the requirement, identify the input and expected output, then test the smallest hypothesis. Hint: {lesson.Exercise.Hint}";
        var apiKey = configuration["OPENAI_API_KEY"];
        var model = configuration["COACH_MODEL"];
        if (!asksForAnswer && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(model))
        {
            try
            {
                var client = httpClientFactory.CreateClient("coach");
                using var messageRequest = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/responses")
                {
                    Content = JsonContent.Create(new { model, store = false, input = $"You are a Socratic coding coach. Do not give a complete solution, code block, or copy-paste snippet. Give at most three concise reasoning steps and one question. Lesson concept: {lesson.Concept}\nLesson requirements: {string.Join("; ", lesson.Exercise.Requirements)}\nLearner message: {message}" })
                };
                messageRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                using var response = await client.SendAsync(messageRequest, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken), default);
                    var guidance = ExtractResponseText(document.RootElement);
                    if (IsSafeGuidance(guidance)) return Results.Ok(new CoachResponse(guidance!, ["No credentials or personal data", "Guidance first; no full solution", "AI response screened for copy-paste code", "Verify each small change with a test"]));
                }
            }
            catch (HttpRequestException) { /* fall back to deterministic coaching without exposing provider failure */ }
        }
        return Results.Ok(new CoachResponse(fallback, ["No credentials or personal data", "Guidance first; no full solution", "Verify each small change with a test"]));
    }

    private static string? ExtractResponseText(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("output_text", out var outputText) && outputText.ValueKind == JsonValueKind.String) return outputText.GetString();
            if (element.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String) return text.GetString();
            foreach (var propertyName in new[] { "output", "content" }) if (element.TryGetProperty(propertyName, out var property)) { var value = ExtractResponseText(property); if (!string.IsNullOrWhiteSpace(value)) return value; }
        }
        if (element.ValueKind == JsonValueKind.Array) foreach (var item in element.EnumerateArray()) { var value = ExtractResponseText(item); if (!string.IsNullOrWhiteSpace(value)) return value; }
        return element.ValueKind == JsonValueKind.String ? element.GetString() : null;
    }
    private static bool IsSafeGuidance(string? guidance) => !string.IsNullOrWhiteSpace(guidance) && guidance.Length <= 1_600 && !guidance.Contains("```", StringComparison.Ordinal) && !guidance.Contains("BEGIN PRIVATE KEY", StringComparison.OrdinalIgnoreCase);

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

    private static async Task<IResult> GetPeerMatches(string courseId, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!Curriculum.Courses.ContainsKey(courseId)) return Results.NotFound();
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Ok(Array.Empty<PeerMatchResponse>());
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var learnerId = ResolveLearnerId(context);
        var matches = await db.PeerReviewProfiles.Where(item => item.CourseId == courseId && item.LearnerId != learnerId && item.AvailableForPeerReview).OrderByDescending(item => item.UpdatedAt).Take(10).Select(item => new PeerMatchResponse(item.Id, item.Focus, item.WantsMentorOfficeHours, item.UpdatedAt)).ToArrayAsync(cancellationToken);
        return Results.Ok(matches);
    }

    private static async Task<IResult> SavePeerProfile(string courseId, PeerReviewProfileRequest request, HttpContext context, IServiceProvider services, CancellationToken cancellationToken)
    {
        if (!Curriculum.Courses.ContainsKey(courseId) || !IsCommunityTextValid(request.Focus, 500)) return Results.BadRequest(new { message = "Tell peers what you want to review or learn, without sharing private contact details." });
        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.Problem("Peer matching requires a database.", statusCode: StatusCodes.Status503ServiceUnavailable);
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var learnerId = ResolveLearnerId(context);
        var profile = await db.PeerReviewProfiles.SingleOrDefaultAsync(item => item.LearnerId == learnerId && item.CourseId == courseId, cancellationToken);
        if (profile is null) { profile = new PeerReviewProfile { LearnerId = learnerId, CourseId = courseId, Focus = request.Focus!.Trim() }; db.PeerReviewProfiles.Add(profile); }
        profile.Focus = request.Focus!.Trim(); profile.AvailableForPeerReview = request.AvailableForPeerReview; profile.WantsMentorOfficeHours = request.WantsMentorOfficeHours; profile.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
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
    private static bool IsSafeProjectPath(string? path) => !string.IsNullOrWhiteSpace(path) && path.Length <= 260 && !path.StartsWith("/", StringComparison.Ordinal) && !path.Contains('\\') && path.Split('/').All(segment => segment.Length > 0 && segment is not "." and not ".." && !segment.Contains('\0'));
    private static bool IsSafeHttpsUrl(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && string.IsNullOrEmpty(uri.UserInfo) && uri.Host.Length > 0 && value!.Length <= 2_000;
    private static bool IsOptionalSafeHttpsUrl(string? value) => string.IsNullOrWhiteSpace(value) || IsSafeHttpsUrl(value);
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
public record PeerReviewProfileRequest(string? Focus, bool AvailableForPeerReview, bool WantsMentorOfficeHours);
public record PeerMatchResponse(Guid Id, string Focus, bool WantsMentorOfficeHours, DateTimeOffset UpdatedAt);
public record OutcomeCheckInRequest(int InterviewReadiness, int MentorReadiness, string? JobSearchStage, string? PortfolioUrl);
public record OutcomeMetricsResponse(string CourseId, int CompletedLessons, int TotalLessons, int ExerciseAttempts, int PassedAttempts, DateTimeOffset? FirstAttemptAt, int InterviewReadiness, int MentorReadiness, string? JobSearchStage, string? PortfolioUrl, DateTimeOffset? LastCheckInAt)
{
    public static OutcomeMetricsResponse Empty(string courseId) => new(courseId, 0, 0, 0, 0, null, 0, 0, null, null, null);
}

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
        ,new("rust-learning-service", "Rust learning service", "Build an Axum service with explicit types, a health contract, and integration tests.", "rust", [new("Cargo.toml", "[package]\nname = \"learning-service\"\nversion = \"0.1.0\"\nedition = \"2024\"\n\n[dependencies]\naxum = \"0.8\"\ntokio = { version = \"1\", features = [\"full\"] }\n"), new("src/main.rs", "use axum::{routing::get, Router};\n\nasync fn health() -> &'static str { \"ok\" }\n\n#[tokio::main]\nasync fn main() {\n    let app = Router::new().route(\"/health\", get(health));\n    let listener = tokio::net::TcpListener::bind(\"0.0.0.0:8080\").await.unwrap();\n    axum::serve(listener, app).await.unwrap();\n}\n"), new("README.md", "# Rust learning service\n\nDocument contracts, tests, tracing, and deployment/runbook evidence.\n")]),
        new("rust-event-worker", "Rust event worker", "Design an idempotent Tokio worker with bounded concurrency, retries, telemetry, and recovery notes.", "rust", [new("src/worker.rs", "pub async fn process_event(event_id: &str) -> Result<(), String> {\n    // Make idempotency, timeout, and retry behavior explicit.\n    let _ = event_id;\n    Ok(())\n}\n"), new("README.md", "# Rust event worker\n\nCapture concurrency limits, retry policy, dead-letter handling, alerts, and ownership.\n")])
    ];
    public static readonly IReadOnlyDictionary<string, ProjectTemplate> ById = All.ToDictionary(item => item.Id, StringComparer.Ordinal);
}

public static class AssessmentCatalog
{
    private static readonly ModuleAssessment[] All =
    [
        new("python-web", "python-foundations", "Python foundations checkpoint", [new("values", "Which collection models unique permission names?", ["list", "set", "tuple"], "set", "python-control-flow-collections"), new("contract", "What should a focused function return?", ["A useful value or explicit None", "Printed output only", "Global mutable state"], "A useful value or explicit None", "python-functions"), new("boundary", "Where should external input be validated?", ["At an application boundary", "Only in templates", "Never"], "At an application boundary", "python-data-models")]),
        new("rust-systems", "rust-foundations", "Rust foundations checkpoint", [new("absence", "Which type models a value that may be absent?", ["Option", "null", "String"], "Option", "rust-option-result"), new("ownership", "What does moving a String transfer?", ["Ownership", "A hidden copy", "A network request"], "Ownership", "rust-ownership"), new("boundary", "Where should external input be validated?", ["At an application boundary", "Only in templates", "Never"], "At an application boundary", "rust-extractors-errors")]),
        new("csharp-dotnet", "foundations", "C# foundations checkpoint", [new("value", "Which type fits a whole-number count?", ["int", "string", "bool"], "int", "foundations-values"), new("condition", "What does an if statement require?", ["A boolean condition", "A database", "A loop"], "A boolean condition", "foundations-making-decisions"), new("record", "What do records express well?", ["Value-based data", "Hidden global state", "Unbounded inheritance"], "Value-based data", "modern-csharp-records")]),
        new("git-cli", "git-foundations-1", "Git CLI checkpoint", [
            new("status", "Which command is the safest first check when you are unsure what Git state you are in?", ["git status", "git push --force", "git clean -fd"], "git status", "git-init-status"),
            new("stage", "What does git add do?", ["Copies selected working-tree content into the staging area", "Publishes commits to a remote", "Deletes untracked files"], "Copies selected working-tree content into the staging area", "git-stage-files"),
            new("branch", "What is a Git branch?", ["A movable name pointing at a commit", "A duplicate copy of every repository file", "A remote server"], "A movable name pointing at a commit", "git-switch-branch"),
            new("fetch", "What does git fetch origin do to your checked-out main branch by itself?", ["Nothing; it updates remote-tracking refs without merging", "It always fast-forwards main", "It deletes local commits"], "Nothing; it updates remote-tracking refs without merging", "git-fetch-remote"),
            new("rebase", "When is rebasing usually safest?", ["On private or coordinated unpublished work", "On shared commits without telling collaborators", "Whenever a merge conflict exists"], "On private or coordinated unpublished work", "git-rebase-feature"),
            new("revert", "What is the usual safe way to undo a bad commit that has already been shared?", ["Create a new revert commit", "Reset --hard and force-push immediately", "Delete the .git directory"], "Create a new revert commit", "git-revert-push")
        ]),
        new("web-development-basics", "web-basics-checkpoint", "Web development basics checkpoint", [
            new("browser", "Where does client-side JavaScript normally execute?", ["In the browser", "Inside the database", "Inside a switch"], "In the browser", "web-basics-browser-server"),
            new("html", "Which element represents an in-page action?", ["button", "div", "span"], "button", "web-basics-html"),
            new("css", "Which CSS system is well suited to rows and columns?", ["Grid", "font-weight", "box-shadow"], "Grid", "web-basics-css-box-layout"),
            new("js", "Which array method keeps only matching entries?", ["filter", "push", "await"], "filter", "web-basics-javascript"),
            new("ts", "What type best constrains a status to known string values?", ["A string-literal union", "string", "any"], "A string-literal union", "web-basics-typescript"),
            new("http", "Which status family represents server errors?", ["5xx", "2xx", "3xx"], "5xx", "web-basics-http-json"),
            new("fetch", "What should you inspect before treating fetch JSON as successful data?", ["response.ok or status", "Nothing", "Only content length"], "response.ok or status", "web-basics-fetch-async"),
            new("debug", "Which DevTools panel shows HTTP requests and responses?", ["Network", "Elements", "Fonts"], "Network", "web-basics-devtools")
        ]),
        new("sqlite", "sqlite-foundations", "SQLite foundations checkpoint", [
            new("embedded", "What makes SQLite different from a typical client/server database?", ["It runs embedded in the application process", "It requires a separate database server", "It can only run in memory"], "It runs embedded in the application process", "sqlite-what-it-is"),
            new("types", "What do declared types provide in a normal SQLite table?", ["Type affinity", "No behavior at all", "A universal hard type system identical to every SQL engine"], "Type affinity", "sqlite-storage-types-affinity"),
            new("null", "How do you test for a missing SQL value?", ["IS NULL", "= NULL", "= ''"], "IS NULL", "sqlite-null-expressions-functions"),
            new("tx", "Why put related writes in one transaction?", ["So they commit or roll back as one unit", "To make SELECT syntax shorter", "To disable constraints"], "So they commit or roll back as one unit", "sqlite-transactions"),
            new("fk", "What must be true for SQLite foreign-key constraints to protect relationships?", ["Foreign-key enforcement must be enabled on the connection", "Every key must use AUTOINCREMENT", "The database must run on a server"], "Foreign-key enforcement must be enabled on the connection", "sqlite-foreign-keys"),
            new("index", "What is the strongest reason to add an index?", ["A real query pattern benefits from it", "Every column should always have one", "The table has more than ten rows"], "A real query pattern benefits from it", "sqlite-indexes"),
            new("wal", "What remains true in WAL mode?", ["Database writes are still serialized", "Only one reader can exist", "A TCP server is required"], "Database writes are still serialized", "sqlite-wal-locking"),
            new("params", "How should application values be placed into SQL statements?", ["Bound parameters", "String concatenation", "HTML encoding"], "Bound parameters", "sqlite-parameters")
        ]),
        new("linux-cli-bash-vim", "linux-cli-foundations", "Linux CLI / Bash / Vim checkpoint", [
            new("shell", "What does Bash do before launching most commands?", ["Parses expansions, quoting, pipes, and redirects", "Draws terminal pixels", "Schedules kernel threads"], "Parses expansions, quoting, pipes, and redirects", "linux-shell-terminal"),
            new("paths", "What does .. mean in a relative path?", ["The parent directory", "The home directory", "The filesystem root"], "The parent directory", "linux-paths-navigation"),
            new("redirect", "What does >> do?", ["Append stdout to a file", "Replace stdin", "Send SIGKILL"], "Append stdout to a file", "linux-pipes-redirection"),
            new("quote", "How should a variable containing a filename usually be expanded?", ["\"$file\"", "$file unquoted", "eval $file"], "\"$file\"", "linux-expansion-quoting"),
            new("perm", "What does chmod 750 grant to others?", ["No permissions", "Read-only", "Read and execute"], "No permissions", "linux-permissions"),
            new("args", "Which Bash expansion forwards all original arguments while preserving their boundaries?", ["\"$@\"", "$*", "$(args)"], "\"$@\"", "bash-variables-arguments"),
            new("vim", "Which key returns Vim from Insert mode to Normal mode?", ["Esc", "Tab", "Ctrl-Z"], "Esc", "vim-modes-save-quit"),
            new("vim-edit", "What does ciw mean in Vim Normal mode?", ["Change inner word", "Copy inside window", "Close current window"], "Change inner word", "vim-motions-operators")
        ]),
        new("react-lite", "react-lite-foundations", "React Lite foundations checkpoint", [
            new("jsx", "What does JSX let a component describe?", ["The UI tree it wants React to render", "A database schema", "A DNS zone"], "The UI tree it wants React to render", "react-lite-jsx-rendering"),
            new("props", "What are props?", ["Inputs passed to a component", "Global mutable variables", "Database rows only"], "Inputs passed to a component", "react-lite-components-props"),
            new("state", "What is useState for?", ["Interactive values that should trigger rendering", "Every calculated value", "Server authorization"], "Interactive values that should trigger rendering", "react-lite-state"),
            new("derived", "If activeCount can be calculated from users, what should you usually do?", ["Derive it from users", "Duplicate it in state", "Store it in localStorage"], "Derive it from users", "react-lite-conditionals-derived-data"),
            new("key", "What is the best key for changing user rows?", ["user.id", "array index", "Math.random()"], "user.id", "react-lite-lists-keys"),
            new("route", "What does React Router connect to page components?", ["URLs", "CSS variables", "Database indexes"], "URLs", "react-lite-router-pages"),
            new("api", "Why use a dummy API wrapper?", ["So components depend on an API-shaped boundary that can later use real HTTP", "To avoid async code entirely", "To store CSS"], "So components depend on an API-shaped boundary that can later use real HTTP", "react-lite-dummy-api-read"),
            new("write", "Where should generated IDs for fake created users live?", ["Inside the dummy service layer", "Inside every button", "Inside Tailwind config"], "Inside the dummy service layer", "react-lite-dummy-api-write")
        ]),
        new("react-enterprise", "react-rendering-model", "React rendering and hooks checkpoint", [
            new("purity", "Why must a React component remain pure during render?", ["React may render, restart, or discard work before commit", "JSX cannot call functions", "The DOM cannot contain state"], "React may render, restart, or discard work before commit", "react-jsx-purity"),
            new("state", "When the next state depends on the previous state, which update is safest?", ["A functional state updater", "Mutating the current state variable", "Reading the DOM directly"], "A functional state updater", "react-state-snapshots-batching"),
            new("effect", "What is useEffect primarily for?", ["Synchronizing React with an external system", "Deriving every computed value", "Replacing event handlers"], "Synchronizing React with an external system", "react-effects-synchronization"),
            new("context", "What is a good use for Context?", ["A focused ambient dependency such as current tenant", "Every server response in the application", "Every local input value"], "A focused ambient dependency such as current tenant", "react-context-provider-boundaries"),
            new("transition", "What should remain urgent when filtering a large result grid?", ["The controlled input value", "Every expensive derived result render", "A background report refresh"], "The controlled input value", "react-transitions-deferred"),
            new("external", "Which hook is designed for subscribing to an external store?", ["useSyncExternalStore", "useRef", "useInsertionEffect"], "useSyncExternalStore", "react-external-store-custom-hooks"),
            new("router", "Which React Router primitive owns page-entry reads in Data Mode?", ["A route loader", "A component mount Effect by default", "A CSS module"], "A route loader", "react-router-loaders-params-search"),
            new("state-owner", "Where should a shareable filter that must survive refresh normally live?", ["URL search params", "Only local component state", "A global store by default"], "URL search params", "react-state-ownership-server-client")
        ])
    ];
    public static ModuleAssessment? Get(string courseId, string moduleId) => All.SingleOrDefault(item => item.CourseId == courseId && item.ModuleId == moduleId);
}
