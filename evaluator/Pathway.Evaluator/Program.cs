using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);
var app = builder.Build();
var executions = new SemaphoreSlim(2, 2);
var sandboxReady = await Sandbox.Probe();
app.Logger.LogInformation("Bubblewrap namespace probe completed: {SandboxReady}", sandboxReady);

app.MapGet("/health", () => Results.Ok(new { status = sandboxReady ? "ok" : "degraded", sandbox = sandboxReady }));
app.MapPost("/evaluate", async (EvaluationRequest request, CancellationToken cancellationToken) =>
{
    if (!sandboxReady) return Results.Problem("The OS sandbox is unavailable; refusing to execute learner code.", statusCode: StatusCodes.Status503ServiceUnavailable);
    if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 50_000) return Results.BadRequest(new { message = "Code must be between 1 and 50,000 characters." });
    var test = LessonTests.For(request.LessonSlug, request.Code);
    if (test is null) return Results.Ok(new EvaluationResult(false, 0, 0, "This exercise has no sandbox test fixture yet.", null));
    await executions.WaitAsync(cancellationToken);
    try
    {
        var result = await Sandbox.Run(test, cancellationToken);
        var passed = result.ExitCode == 0 && result.Output.Contains("PATHWAY_TEST_PASS", StringComparison.Ordinal);
        var diagnostics = string.IsNullOrWhiteSpace(result.Output) ? "The sandboxed process did not produce a passing result." : result.Output.Trim();
        return Results.Ok(new EvaluationResult(passed, passed ? test.TestCount : 0, test.TestCount, passed ? "All sandboxed tests passed." : diagnostics[..Math.Min(diagnostics.Length, 4_000)], null));
    }
    finally { executions.Release(); }
});

app.MapPost("/evaluate-hook", async (HookEvaluationRequest request, CancellationToken cancellationToken) =>
{
    if (!sandboxReady) return Results.Problem("The OS sandbox is unavailable; refusing to execute hook code.", statusCode: StatusCodes.Status503ServiceUnavailable);
    if (!string.Equals(request.Event, "PreToolUse", StringComparison.Ordinal))
        return Results.BadRequest(new { message = "The first Hook Playground release supports PreToolUse only." });
    if (string.IsNullOrWhiteSpace(request.Script) || request.Script.Length > 20_000)
        return Results.BadRequest(new { message = "Hook script must be between 1 and 20,000 characters." });
    if (string.IsNullOrWhiteSpace(request.Matcher) || request.Matcher.Length > 120)
        return Results.BadRequest(new { message = "Matcher must be between 1 and 120 characters." });
    if (string.IsNullOrWhiteSpace(request.Command) || request.Command.Length > 1_000)
        return Results.BadRequest(new { message = "Simulated Bash command must be between 1 and 1,000 characters." });

    bool matcherMatched;
    try
    {
        matcherMatched = HookMatcher.Matches(request.Matcher, "Bash");
    }
    catch (ArgumentException)
    {
        return Results.BadRequest(new { message = "Matcher is not a valid regular expression." });
    }

    var hookInput = JsonSerializer.Serialize(new Dictionary<string, object?>
    {
        ["session_id"] = "pathway-hook-lab",
        ["transcript_path"] = "/tmp/pathway-hook-lab/transcript.jsonl",
        ["cwd"] = "/workspace",
        ["permission_mode"] = "default",
        ["hook_event_name"] = "PreToolUse",
        ["tool_name"] = "Bash",
        ["tool_input"] = new Dictionary<string, object?>
        {
            ["command"] = request.Command,
            ["description"] = "Pathway Hook Playground simulated Bash tool call"
        },
        ["tool_use_id"] = "toolu_pathway_lab"
    });

    if (!matcherMatched)
        return Results.Ok(HookEvaluationResult.Skipped(hookInput, request.Matcher));

    await executions.WaitAsync(cancellationToken);
    try
    {
        var run = await Sandbox.RunHook(request.Script, hookInput, cancellationToken);
        return Results.Ok(HookInterpreter.Interpret(hookInput, request.Matcher, run));
    }
    finally { executions.Release(); }
});

app.Run();

record EvaluationRequest(string LessonSlug, string Code);
record EvaluationResult(bool Passed, int PassingTests, int TotalTests, string Feedback, string? NextLessonSlug);
record HookEvaluationRequest(string Event, string Matcher, string Script, string Command);
record HookEvaluationResult(bool MatcherMatched, bool Executed, int? ExitCode, string Outcome, string Summary, string? Reason, string Stdout, string Stderr, string InputJson)
{
    public static HookEvaluationResult Skipped(string inputJson, string matcher) =>
        new(false, false, null, "skipped", "The hook did not run because the matcher did not match the Bash tool.", $"Matcher: {matcher}", string.Empty, string.Empty, inputJson);
}
record SandboxTest(string FileName, string Source, string Command, int TestCount);
record HookRunResult(int ExitCode, string Stdout, string Stderr);

static class LessonTests
{
    public static SandboxTest? For(string lessonSlug, string code) => lessonSlug switch
    {
        "python-functions" => new("main.py", $"{code}\n\nresult = greet('Ada')\nassert isinstance(result, str) and result.strip()\nprint('PATHWAY_TEST_PASS')\n", "python3 main.py", 2),
        "foundations-making-decisions" => new("Program.cs", $"using System;\n\npublic static class Program {{ public static void Main() {{\n{code}\n}} }}\n", "dotnet build --nologo --verbosity quiet && dotnet run --no-build --nologo", 2),
        "modern-csharp-records" => new("Program.cs", $"using System;\n{code}\npublic static class Program {{ public static void Main() => Console.WriteLine(\"PATHWAY_TEST_PASS\"); }}\n", "dotnet build --nologo --verbosity quiet && dotnet run --no-build --nologo", 2),
        _ => null
    };
}

static class HookMatcher
{
    public static bool Matches(string matcher, string toolName)
    {
        if (matcher == "*" || string.IsNullOrWhiteSpace(matcher)) return true;
        return Regex.IsMatch(toolName, $"^(?:{matcher})$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));
    }
}

static class HookInterpreter
{
    public static HookEvaluationResult Interpret(string inputJson, string matcher, HookRunResult run)
    {
        var stdout = run.Stdout.Trim();
        var stderr = run.Stderr.Trim();

        if (run.ExitCode == 2)
        {
            var structuredReason = TryReadDecision(stdout)?.Reason;
            var reason = structuredReason ?? (!string.IsNullOrWhiteSpace(stderr) ? stderr : "The hook exited with blocking status code 2.");
            return new(true, true, run.ExitCode, "blocked", "Claude Code would block this PreToolUse tool call.", reason, stdout, stderr, inputJson);
        }

        var decision = TryReadDecision(stdout);
        if (decision is not null)
        {
            if (decision.ValidationError is not null)
                return new(true, true, run.ExitCode, "error", "Claude Code would treat this as a non-blocking hook error and continue normal permission flow.", decision.ValidationError, stdout, stderr, inputJson);

            var outcome = decision.PermissionDecision switch
            {
                "deny" => "denied",
                "allow" => "allowed",
                "ask" => "ask",
                "defer" => "deferred",
                _ => "no_decision"
            };
            var summary = decision.PermissionDecision switch
            {
                "deny" => "Claude Code would deny the Bash tool call and show Claude the hook reason.",
                "allow" => "Claude Code would allow the Bash tool call without prompting for permission.",
                "ask" => "Claude Code would require the normal user permission prompt.",
                "defer" => "Claude Code would defer the tool call for later handling.",
                _ => "The JSON did not contain a recognized PreToolUse permission decision."
            };
            return new(true, true, run.ExitCode, outcome, summary, decision.Reason, stdout, stderr, inputJson);
        }

        if (run.ExitCode == 0 && string.IsNullOrWhiteSpace(stdout))
            return new(true, true, run.ExitCode, "no_decision", "The hook succeeded silently. Claude Code would continue through its normal permission flow.", null, stdout, stderr, inputJson);

        if (run.ExitCode == 0)
            return new(true, true, run.ExitCode, "error", "Claude Code would treat this output as a non-blocking hook error and continue normal permission flow.", "PreToolUse structured decisions must be a valid JSON object on stdout.", stdout, stderr, inputJson);

        return new(true, true, run.ExitCode, "error", "The hook failed with a non-blocking status. Claude Code would continue normal permission flow.", !string.IsNullOrWhiteSpace(stderr) ? stderr : $"Hook exited with status {run.ExitCode}.", stdout, stderr, inputJson);
    }

    private static HookDecision? TryReadDecision(string stdout)
    {
        if (string.IsNullOrWhiteSpace(stdout) || !stdout.StartsWith('{') || !stdout.EndsWith('}')) return null;
        try
        {
            using var document = JsonDocument.Parse(stdout);
            var root = document.RootElement;

            if (root.TryGetProperty("decision", out var topDecision) && string.Equals(topDecision.GetString(), "block", StringComparison.Ordinal))
            {
                var reason = root.TryGetProperty("reason", out var topReason) ? topReason.GetString() : null;
                return new HookDecision("deny", reason, null);
            }

            if (!root.TryGetProperty("hookSpecificOutput", out var output) || output.ValueKind != JsonValueKind.Object)
                return new HookDecision(null, null, "JSON parsed, but hookSpecificOutput is missing.");

            if (!output.TryGetProperty("hookEventName", out var eventName) || !string.Equals(eventName.GetString(), "PreToolUse", StringComparison.Ordinal))
                return new HookDecision(null, null, "hookSpecificOutput.hookEventName must be PreToolUse.");

            if (!output.TryGetProperty("permissionDecision", out var permissionDecision))
                return new HookDecision(null, null, "hookSpecificOutput.permissionDecision is missing.");

            var value = permissionDecision.GetString();
            if (value is not ("allow" or "deny" or "ask" or "defer"))
                return new HookDecision(null, null, "permissionDecision must be allow, deny, ask, or defer.");

            var reason = output.TryGetProperty("permissionDecisionReason", out var reasonNode) ? reasonNode.GetString() : null;
            return new HookDecision(value, reason, null);
        }
        catch (JsonException error)
        {
            return new HookDecision(null, null, $"Hook stdout looked like JSON but could not be parsed: {error.Message}");
        }
    }

    private sealed record HookDecision(string? PermissionDecision, string? Reason, string? ValidationError);
}

static class Sandbox
{
    // The Docker image installs bubblewrap. The service deliberately refuses execution if the
    // kernel/user-namespace capability is absent instead of falling back to host execution.
    public static async Task<bool> Probe()
    {
        var bwrap = File.Exists("/usr/bin/bwrap") ? "/usr/bin/bwrap" : File.Exists("/bin/bwrap") ? "/bin/bwrap" : null;
        if (bwrap is null) return false;
        try
        {
            var process = new Process { StartInfo = new ProcessStartInfo { FileName = bwrap, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true } };
            foreach (var argument in new[] { "--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--", "/bin/true" }) process.StartInfo.ArgumentList.Add(argument);
            process.Start();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await process.WaitForExitAsync(timeout.Token);
            return process.ExitCode == 0;
        }
        catch { return false; }
    }

    public static async Task<HookRunResult> RunHook(string script, string inputJson, CancellationToken cancellationToken)
    {
        var root = Path.Combine(Path.GetTempPath(), "pathway-hook-evaluator", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var scriptPath = Path.Combine(root, "hook.sh");
        await File.WriteAllTextAsync(scriptPath, script, cancellationToken);

        var bwrap = File.Exists("/usr/bin/bwrap") ? "/usr/bin/bwrap" : "/bin/bwrap";
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = bwrap,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };
        foreach (var argument in new[]
        {
            "--unshare-all", "--die-with-parent", "--new-session",
            "--ro-bind", "/", "/", "--bind", root, "/workspace", "--chdir", "/workspace",
            "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--clearenv",
            "--setenv", "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "--setenv", "HOME", "/tmp",
            "--", "/bin/sh", "-c",
            "ulimit -t 3 -v 262144 -u 32 -f 64; timeout -k 1s 4s /bin/bash /workspace/hook.sh"
        }) process.StartInfo.ArgumentList.Add(argument);

        try
        {
            process.Start();
            await process.StandardInput.WriteAsync(inputJson);
            process.StandardInput.Close();

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(6));
            var stdoutTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderrTask = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            return new HookRunResult(process.ExitCode, Limit(stdout, 8_000), Limit(stderr, 8_000));
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            return new HookRunResult(124, string.Empty, "Hook execution exceeded the sandbox time limit.");
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    private static string Limit(string value, int max) => value.Length > max ? value[..max] : value;

    public static async Task<RunResult> Run(SandboxTest test, CancellationToken cancellationToken)
    {
        var root = Path.Combine(Path.GetTempPath(), "pathway-evaluator", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        await File.WriteAllTextAsync(Path.Combine(root, test.FileName), test.Source, cancellationToken);
        if (test.FileName == "Program.cs") await File.WriteAllTextAsync(Path.Combine(root, "Sandbox.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>", cancellationToken);
        var bwrap = File.Exists("/usr/bin/bwrap") ? "/usr/bin/bwrap" : "/bin/bwrap";
        var process = new Process { StartInfo = new ProcessStartInfo { FileName = bwrap, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true } };
        foreach (var argument in new[] { "--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--bind", root, "/workspace", "--chdir", "/workspace", "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--clearenv", "--setenv", "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "--setenv", "HOME", "/tmp", "--", "/bin/sh", "-c", $"ulimit -t 6 -v 524288 -u 64 -f 1024; timeout -k 1s 8s {test.Command}" }) process.StartInfo.ArgumentList.Add(argument);
        try
        {
            process.Start();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var output = (await stdout) + (await stderr);
            return new RunResult(process.ExitCode, output.Length > 8_000 ? output[..8_000] : output);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            return new RunResult(124, "Execution exceeded the sandbox time limit.");
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { /* disposable workspace cleanup is best-effort */ } }
    }
}

record RunResult(int ExitCode, string Output);
