namespace Pathway.Api;

public record CompetencyDefinition(string Id, string Title, string Description, string[] Evidence);
public record CapstoneRubricItem(string Id, string Title, string Requirement);
public record CapstoneDefinition(string Id, string CourseId, string Title, string Brief, string[] Outcomes, CapstoneRubricItem[] Rubric);
public record CareerScenario(string Id, string CourseId, string Type, string Title, string Prompt, string[] Deliverables, string[]? Evidence = null);
public record CapstoneReviewRequest(string? DemoUrl, string? ArchitectureUrl, string? RepositoryUrl, Dictionary<string, string>? Evidence);
public record CapstoneReviewResponse(bool ReadyForReview, int SatisfiedCriteria, int TotalCriteria, string[] MissingCriteria, string[] Feedback, string[] RecommendedReviewLessonSlugs);
public record CapstoneReviewRequestPost(string? DemoUrl, string? ArchitectureUrl, string? RepositoryUrl, Dictionary<string, string>? Evidence, string? ReviewFocus);
public record CompetencyEvidenceResponse(string Id, string Title, string Description, int EarnedEvidence, int TargetEvidence, string[] Evidence);
public record ScenarioReviewRequest(Dictionary<string, string>? Responses);
public record ScenarioReviewResponse(bool ReadyForFeedback, int SatisfiedDeliverables, int TotalDeliverables, string[] MissingDeliverables, string[] Feedback, string[] RecommendedReviewLessonSlugs);

public static class CareerReadinessCatalog
{
    public static readonly CompetencyDefinition[] Competencies =
    [
        new("programming", "Programming", "Solve problems with clear, correct, maintainable code.", ["Passes exercises", "Explains a design choice", "Completes a project requirement"]),
        new("testing", "Testing", "Proves behavior at the right boundary.", ["Writes unit tests", "Writes an integration test", "Explains an edge case"]),
        new("delivery", "Delivery", "Builds, deploys, and operates software safely.", ["CI workflow", "Deployment and rollback notes", "Health check or readiness signal"]),
        new("debugging", "Debugging", "Forms hypotheses from evidence and verifies a fix.", ["Reproduces a defect", "Uses logs, traces, or tests", "Writes a prevention step"]),
        new("collaboration", "Collaboration", "Communicates changes and gives useful feedback.", ["Writes a focused PR summary", "Leaves an actionable review", "Responds to review feedback"]),
        new("architecture", "Architecture", "Makes tradeoffs explicit and designs for ownership.", ["States constraints", "Writes an ADR", "Defines rollout and reversal signals"])
    ];

    private static CapstoneRubricItem[] Rubric =>
    [
        new("requirements", "Requirements", "State the user problem, constraints, assumptions, and acceptance criteria."),
        new("api", "API design", "Document success and failure contracts, validation, and compatibility decisions."),
        new("tests", "Tests", "Include focused unit tests and a boundary or integration test."),
        new("ci", "Continuous delivery", "Provide a CI workflow that builds and tests the project."),
        new("auth", "Security boundary", "Describe authentication, authorization, secrets, and abuse controls."),
        new("observability", "Observability", "Define structured logs, metrics/traces, health checks, and an actionable alert."),
        new("deployment", "Deployment", "Describe deploy, migration, rollback, and readiness steps."),
        new("readme", "README and runbook", "Explain local setup, the contract, operations, and recovery."),
        new("tradeoffs", "Tradeoffs", "Write an ADR that compares alternatives and revisit signals.")
    ];

    public static readonly CapstoneDefinition[] Capstones =
    [
        new("csharp-foundation-api", "csharp-dotnet", "Foundation API", "Build a small .NET API that solves a learner-facing problem and exposes a deliberate HTTP contract.", ["A deployed API", "Contract and integration tests", "A clear README"], Rubric),
        new("csharp-production-service", "csharp-dotnet", "Production service", "Evolve the API with persistence, authorization, cancellation, telemetry, and safe delivery.", ["Health and readiness signals", "CI workflow", "Deployment/runbook evidence"], Rubric),
        new("csharp-staff-platform", "csharp-dotnet", "Staff platform design", "Design the learning platform under scale, ownership, cost, and reliability constraints.", ["Architecture diagram", "ADR and rollout plan", "SLO and incident plan"], Rubric),
        new("python-foundation-api", "python-web", "Foundation API", "Build a typed Python web API with a focused domain boundary and an observable HTTP contract.", ["A deployed API", "Tests and API documentation", "A clear README"], Rubric),
        new("python-production-service", "python-web", "Production service", "Ship a Python service with persistence, authorization, background work, telemetry, and delivery discipline.", ["Health and readiness signals", "CI workflow", "Deployment/runbook evidence"], Rubric),
        new("python-staff-platform", "python-web", "Staff platform design", "Design a multi-tenant learning platform and make its tradeoffs, ownership, and recovery plan legible.", ["Architecture diagram", "ADR and rollout plan", "SLO and incident plan"], Rubric)
    ];

    public static readonly CareerScenario[] Scenarios =
    [
        new("incident-timeout", "csharp-dotnet", "Incident", "Checkout timeouts after a dependency release", "Investigate a rising p95 latency graph, a trace with a slow downstream call, and incomplete retry logs. Decide what to mitigate now and what to change safely.", ["Hypothesis and evidence", "Mitigation", "Blameless postmortem", "Prevention test or alert"], ["Dashboard: checkout p95 rose from 240 ms to 8.4 s at 10:04 UTC; error rate is 3.2%.", "Trace: POST /checkout spent 7.9 s in PaymentClient.AuthorizeAsync; the trace has no retry child span.", "Log: downstream status 504, attempt=1, correlation=9f7a. No cancellation or timeout value is recorded.", "Failing integration test: checkout returns 500 instead of a bounded 503 when PaymentClient exceeds its timeout."]),
        new("pr-order-validation", "csharp-dotnet", "Code review", "Review an order validation pull request", "Find correctness, authorization, resilience, readability, and test gaps. Write concise, actionable review comments and an approval summary.", ["Line-level findings", "Risk classification", "Approval criteria"], ["Diff note: the endpoint trusts request.CustomerId instead of the authenticated subject.", "Test note: only a happy-path unit test exists; no duplicate order or forbidden-user coverage.", "Performance note: each order line triggers a sequential SKU lookup inside a loop."]),
        new("ticket-slice-csharp", "csharp-dotnet", "Career", "Turn a vague ticket into a safe slice", "A product manager asks: ‘Let learners export their progress.’ Identify ambiguity, ask clarifying questions, estimate the smallest safe slice, and explain what you would defer.", ["Clarifying questions", "Smallest viable slice", "Estimate and assumptions", "Deferred risks"]),
        new("ai-review-csharp", "csharp-dotnet", "AI literacy", "Verify an AI-generated endpoint", "An AI suggests an endpoint that compiles but omits authorization, cancellation, tests, and failure semantics. Treat it as an untrusted draft: review, verify, and improve it.", ["Verification plan", "Missing correctness or security concerns", "Tests to add", "Explanation of the final design"]),
        new("team-migration-csharp", "csharp-dotnet", "Team simulation", "Negotiate a zero-downtime migration", "You are the staff engineer coordinating a schema change across two teams with a release deadline. Define the contract, sequencing, ownership, rollback, and ADR decision.", ["Stakeholder and ownership map", "Expand-contract rollout", "Rollback trigger", "ADR tradeoff"]),
        new("interview-csharp", "csharp-dotnet", "Career", "Explain a project under interview pressure", "Present a capstone to an interviewer who asks why you chose the architecture, what failed, how you tested it, and what you would improve with more time.", ["Two-minute project narrative", "Tradeoff explanation", "Failure and learning", "Next improvement"]),
        new("feedback-csharp", "csharp-dotnet", "Career", "Handle a difficult review conversation", "A teammate rejects your proposed caching approach after an incident. Acknowledge the feedback, distinguish facts from assumptions, propose a next experiment, and preserve a constructive working relationship.", ["Response that acknowledges feedback", "Evidence and assumptions", "Next experiment", "Follow-up communication"]),
        new("incident-worker-duplicates", "python-web", "Incident", "Duplicate notification delivery", "Use queue logs, duplicate delivery records, and a retry graph to identify why a background task produced duplicate effects.", ["Hypothesis and evidence", "Mitigation", "Blameless postmortem", "Idempotency change"], ["Queue dashboard: delivery attempts doubled after the worker deployment; queue depth remains flat.", "Log: event=notification.sent event_id=e-184 attempt=1 followed by the same event_id attempt=2 after an acknowledgement timeout.", "Trace: send_notification completes in 120 ms, but the worker acknowledges the message only after a 35 s database write.", "Failing test: processing the same event ID twice produces two outbound messages instead of one recorded effect."]),
        new("pr-enrollment-boundary", "python-web", "Code review", "Review an enrollment endpoint pull request", "Identify contract, authorization, transaction, test, and readability concerns before approving a change.", ["Line-level findings", "Risk classification", "Approval criteria"], ["Diff note: client-supplied learner_id is used without comparing it to the authenticated principal.", "Transaction note: enrollment creation and seat decrement are separate commits.", "Test note: no forbidden-user, full-class, or duplicate-enrollment coverage exists."]),
        new("ticket-slice-python", "python-web", "Career", "Turn a vague ticket into a safe slice", "A product manager asks: ‘Let learners export their progress.’ Identify ambiguity, ask clarifying questions, estimate the smallest safe slice, and explain what you would defer.", ["Clarifying questions", "Smallest viable slice", "Estimate and assumptions", "Deferred risks"]),
        new("ai-review-python", "python-web", "AI literacy", "Verify an AI-generated endpoint", "An AI suggests an endpoint that compiles but omits authorization, timeout policy, tests, and failure semantics. Treat it as an untrusted draft: review, verify, and improve it.", ["Verification plan", "Missing correctness or security concerns", "Tests to add", "Explanation of the final design"]),
        new("team-migration-python", "python-web", "Team simulation", "Negotiate a zero-downtime migration", "You are the staff engineer coordinating a schema change across two teams with a release deadline. Define the contract, sequencing, ownership, rollback, and ADR decision.", ["Stakeholder and ownership map", "Expand-contract rollout", "Rollback trigger", "ADR tradeoff"]),
        new("interview-python", "python-web", "Career", "Explain a project under interview pressure", "Present a capstone to an interviewer who asks why you chose the architecture, what failed, how you tested it, and what you would improve with more time.", ["Two-minute project narrative", "Tradeoff explanation", "Failure and learning", "Next improvement"]),
        new("feedback-python", "python-web", "Career", "Handle a difficult review conversation", "A teammate rejects your proposed caching approach after an incident. Acknowledge the feedback, distinguish facts from assumptions, propose a next experiment, and preserve a constructive working relationship.", ["Response that acknowledges feedback", "Evidence and assumptions", "Next experiment", "Follow-up communication"])
    ];

    public static IEnumerable<CapstoneDefinition> CapstonesFor(string courseId) => Capstones.Where(item => item.CourseId == courseId);
    public static IEnumerable<CareerScenario> ScenariosFor(string courseId) => Scenarios.Where(item => item.CourseId == courseId);

    public static string[] RecommendedLessons(string courseId, IEnumerable<string> gaps)
    {
        var isPython = courseId == "python-web";
        var matches = new List<string>();
        foreach (var gap in gaps)
        {
            var lesson = gap.ToLowerInvariant() switch
            {
                var value when value.Contains("auth") => isPython ? "python-auth-security" : "web-api-validation-auth",
                var value when value.Contains("test") => isPython ? "python-testing-pytest" : "quality-tests",
                var value when value.Contains("observ") || value.Contains("alert") || value.Contains("incident") => isPython ? "python-reliability-design" : "operations-observability",
                var value when value.Contains("deploy") || value.Contains("rollback") || value.Contains("migration") => isPython ? "python-delivery-containers" : "operations-delivery",
                var value when value.Contains("tradeoff") || value.Contains("adr") || value.Contains("approval") => isPython ? "python-system-design" : "staff-architecture-decisions",
                var value when value.Contains("api") || value.Contains("contract") => isPython ? "python-api-contracts" : "web-api-contracts",
                _ => isPython ? "python-project-foundations" : "foundations-methods"
            };
            matches.Add(lesson);
        }
        return matches.Distinct(StringComparer.Ordinal).Take(3).ToArray();
    }
}
