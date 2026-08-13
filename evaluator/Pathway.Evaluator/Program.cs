using System.Diagnostics;

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

app.Run();

record EvaluationRequest(string LessonSlug, string Code);
record EvaluationResult(bool Passed, int PassingTests, int TotalTests, string Feedback, string? NextLessonSlug);
record SandboxTest(string FileName, string Source, string Command, int TestCount);

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
