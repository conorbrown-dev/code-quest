using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;

namespace Pathway.Api;

public static class AnalyticsEndpoints
{
    private static readonly HashSet<string> AllowedEvents =
    [
        "session_start",
        "course_view",
        "lesson_view",
        "workspace_view",
        "exercise_submit",
        "hook_run"
    ];

    public static void MapAnalyticsEndpoints(this WebApplication app)
    {
        app.MapPost("/api/activity", RecordActivity)
            .RequireRateLimiting("learner");

        app.MapGet("/api/admin/analytics", GetAnalyticsSummary)
            .RequireRateLimiting("public-read");
    }

    private static async Task<IResult> RecordActivity(
        ActivityRequest request,
        HttpContext context,
        IServiceProvider services,
        CancellationToken cancellationToken)
    {
        if (!AllowedEvents.Contains(request.EventType))
            return Results.BadRequest(new { message = "Unsupported activity event." });
        if (string.IsNullOrWhiteSpace(request.SessionId) || request.SessionId.Length > 100)
            return Results.BadRequest(new { message = "Session id is required." });
        if ((request.CourseId?.Length ?? 0) > 100 ||
            (request.LessonSlug?.Length ?? 0) > 200 ||
            (request.Workspace?.Length ?? 0) > 50 ||
            (request.Detail?.Length ?? 0) > 100)
            return Results.BadRequest(new { message = "Activity metadata is too long." });

        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null) return Results.NoContent();

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        db.ActivityEvents.Add(new ActivityEvent
        {
            LearnerId = ResolveLearnerId(context),
            SessionId = request.SessionId,
            EventType = request.EventType,
            CourseId = NullIfBlank(request.CourseId),
            LessonSlug = NullIfBlank(request.LessonSlug),
            Workspace = NullIfBlank(request.Workspace),
            Detail = NullIfBlank(request.Detail),
            CreatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> GetAnalyticsSummary(
        int? days,
        string? excludeLearnerId,
        HttpContext context,
        IConfiguration configuration,
        IServiceProvider services,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized(context, configuration))
            return Results.Unauthorized();

        var factory = services.GetService<IDbContextFactory<ProgressDbContext>>();
        if (factory is null)
            return Results.Problem("Analytics persistence is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);

        var windowDays = Math.Clamp(days ?? 30, 1, 365);
        var now = DateTimeOffset.UtcNow;
        var since = now.AddDays(-windowDays);
        var excluded = string.IsNullOrWhiteSpace(excludeLearnerId) || excludeLearnerId.Length > 100
            ? null
            : excludeLearnerId;

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var query = db.ActivityEvents.AsNoTracking().Where(item => item.CreatedAt >= since);
        if (excluded is not null)
            query = query.Where(item => item.LearnerId != excluded);

        var events = await query
            .OrderBy(item => item.CreatedAt)
            .Select(item => new ActivityRow(
                item.LearnerId,
                item.SessionId,
                item.EventType,
                item.CourseId,
                item.LessonSlug,
                item.Workspace,
                item.Detail,
                item.CreatedAt))
            .ToListAsync(cancellationToken);

        var uniqueVisitors = events.Select(item => item.LearnerId).Distinct().Count();
        var sessions = events.Select(item => item.SessionId).Distinct().Count();
        var returningVisitors = events
            .GroupBy(item => item.LearnerId)
            .Count(group => group.Select(item => item.SessionId).Distinct().Count() >= 2);
        var activeNow = events
            .Where(item => item.CreatedAt >= now.AddMinutes(-15))
            .Select(item => item.LearnerId)
            .Distinct()
            .Count();
        var activeToday = events
            .Where(item => item.CreatedAt >= now.AddHours(-24))
            .Select(item => item.LearnerId)
            .Distinct()
            .Count();
        var activeSevenDays = events
            .Where(item => item.CreatedAt >= now.AddDays(-7))
            .Select(item => item.LearnerId)
            .Distinct()
            .Count();

        var daily = Enumerable.Range(0, windowDays)
            .Select(offset =>
            {
                var date = DateOnly.FromDateTime(since.UtcDateTime.Date.AddDays(offset));
                var dayEvents = events.Where(item => DateOnly.FromDateTime(item.CreatedAt.UtcDateTime) == date).ToList();
                return new DailyActivity(
                    date.ToString("yyyy-MM-dd"),
                    dayEvents.Select(item => item.LearnerId).Distinct().Count(),
                    dayEvents.Select(item => item.SessionId).Distinct().Count(),
                    dayEvents.Count);
            })
            .ToArray();

        static AnalyticsCount[] CountBy(IEnumerable<string?> values, int take) =>
            values
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .GroupBy(value => value!, StringComparer.Ordinal)
                .Select(group => new AnalyticsCount(group.Key, group.Count()))
                .OrderByDescending(item => item.Count)
                .ThenBy(item => item.Name, StringComparer.Ordinal)
                .Take(take)
                .ToArray();

        var knownLearners = await db.Progress.AsNoTracking().Select(item => item.LearnerId)
            .Concat(db.Submissions.AsNoTracking().Select(item => item.LearnerId))
            .Distinct()
            .CountAsync(cancellationToken);

        return Results.Ok(new AnalyticsSummary(
            windowDays,
            uniqueVisitors,
            sessions,
            returningVisitors,
            activeNow,
            activeToday,
            activeSevenDays,
            events.Count,
            events.Count(item => item.EventType == "exercise_submit"),
            events.Count(item => item.EventType == "hook_run"),
            knownLearners,
            events.Count == 0 ? null : events[0].CreatedAt,
            events.Count == 0 ? null : events[^1].CreatedAt,
            CountBy(events.Select(item => item.CourseId), 8),
            CountBy(events.Select(item => item.LessonSlug), 12),
            CountBy(events.Select(item => item.EventType), 12),
            daily));
    }

    private static bool IsAuthorized(HttpContext context, IConfiguration configuration)
    {
        var expected = configuration["ANALYTICS_ADMIN_KEY"];
        var supplied = context.Request.Headers["X-Pathway-Analytics-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(expected) || string.IsNullOrWhiteSpace(supplied))
            return false;

        var left = Encoding.UTF8.GetBytes(expected);
        var right = Encoding.UTF8.GetBytes(supplied);
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }

    private static string ResolveLearnerId(HttpContext context)
    {
        var subject = context.User.FindFirstValue("sub");
        if (!string.IsNullOrWhiteSpace(subject)) return $"keycloak:{subject}";
        var guest = context.Request.Headers["X-Learner-Id"].FirstOrDefault();
        return guest is { Length: > 0 and <= 100 } ? guest : "anonymous";
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed record ActivityRow(
        string LearnerId,
        string SessionId,
        string EventType,
        string? CourseId,
        string? LessonSlug,
        string? Workspace,
        string? Detail,
        DateTimeOffset CreatedAt);
}

public sealed record ActivityRequest(
    string EventType,
    string SessionId,
    string? CourseId,
    string? LessonSlug,
    string? Workspace,
    string? Detail);

public sealed record AnalyticsCount(string Name, int Count);
public sealed record DailyActivity(string Date, int Visitors, int Sessions, int Events);
public sealed record AnalyticsSummary(
    int WindowDays,
    int UniqueVisitors,
    int Sessions,
    int ReturningVisitors,
    int ActiveNow,
    int ActiveToday,
    int ActiveSevenDays,
    int TotalEvents,
    int ExerciseRuns,
    int HookRuns,
    int KnownLearnersBeforeTracking,
    DateTimeOffset? FirstSeenAt,
    DateTimeOffset? LastSeenAt,
    AnalyticsCount[] TopCourses,
    AnalyticsCount[] TopLessons,
    AnalyticsCount[] EventsByType,
    DailyActivity[] Daily);
