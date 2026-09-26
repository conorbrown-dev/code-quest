const MAX_CODE_BYTES = 50_000

export function validateRequest(value) {
  if (!value || typeof value.lessonSlug !== 'string' || typeof value.code !== 'string') return 'lessonSlug and code are required.'
  if (value.lessonSlug.length > 200 || value.code.length === 0 || Buffer.byteLength(value.code, 'utf8') > MAX_CODE_BYTES) return 'Code must be between 1 and 50,000 bytes.'
  return null
}

function gitFixture(code, setup, checks, tests = 3) {
  const script = [
    '#!/bin/bash',
    'set -u',
    'export HOME=/workspace',
    'export GIT_PAGER=cat',
    'export PAGER=cat',
    'export GIT_TERMINAL_PROMPT=0',
    'git config --global init.defaultBranch main',
    'git config --global user.name "Pathway Learner"',
    'git config --global user.email "learner@pathway.invalid"',
    'mkdir -p /workspace/repo',
    'cd /workspace/repo',
    setup,
    'set +e',
    '(',
    code,
    ') > /workspace/learner.out 2>&1',
    'set -e',
    'cat /workspace/learner.out',
    checks,
    'echo PATHWAY_TEST_PASS',
    '',
  ].join('\n')
  return {
    files: { 'exercise.sh': script },
    command: ['/bin/bash', '/workspace/exercise.sh'],
    tests,
    runtime: 'git',
  }
}
export function fixtureFor(lessonSlug, code) {
  switch (lessonSlug) {
    case 'python-functions':
      return {
        files: { 'main.py': `${code}\n\nresult = greet('Ada')\nassert isinstance(result, str) and result.strip()\nprint('PATHWAY_TEST_PASS')\n` },
        command: ['python3', '/workspace/main.py'],
        tests: 2,
      }
    case 'rust-hello-functions':
      return {
        files: { 'main.rs': `${code}\n\nfn main() {\n    let result = greet(\"Ada\");\n    assert!(!result.trim().is_empty());\n    assert!(result.contains(\"Ada\"));\n    println!(\"PATHWAY_TEST_PASS\");\n}\n` },
        command: ['/bin/sh', '-c', 'rustc --edition=2024 /workspace/main.rs -o /workspace/main && /workspace/main'],
        tests: 2,
        runtime: 'rust',
      }
    case 'rust-ownership':
      return {
        files: { 'main.rs': `${code}\n\nfn main() {\n    assert_eq!(take_name(String::from(\"Ada\")), 3);\n    println!(\"PATHWAY_TEST_PASS\");\n}\n` },
        command: ['/bin/sh', '-c', 'rustc --edition=2024 /workspace/main.rs -o /workspace/main && /workspace/main'],
        tests: 2,
        runtime: 'rust',
      }
    case 'foundations-making-decisions':
      return {
        files: {
          'Program.cs': `using System;\n\npublic static class Program\n{\n    public static void Main()\n    {\n${code}\n    }\n}\n`,
          'Sandbox.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>',
        },
        command: ['/bin/sh', '-c', 'dotnet restore /workspace/Sandbox.csproj --ignore-failed-sources --nologo && dotnet run --project /workspace/Sandbox.csproj --no-restore --nologo'],
        tests: 2,
        requiredOutput: 'You can watch!',
      }
    case 'modern-csharp-records':
      return {
        files: {
          'Program.cs': `using System;\nusing System.Linq;\nusing System.Reflection;\n${code}\n\npublic static class Program\n{\n    public static void Main()\n    {\n        var type = typeof(Order);\n        var names = type.GetProperties().Select(property => property.Name).ToHashSet();\n        var printMembers = type.GetMethod("PrintMembers", BindingFlags.Instance | BindingFlags.NonPublic);\n        if (!names.IsSupersetOf(new[] { "Id", "Status" }) || printMembers is null)\n            throw new InvalidOperationException("Order must be a record with Id and Status properties.");\n        Console.WriteLine("PATHWAY_TEST_PASS");\n    }\n}\n`,
          'Sandbox.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>',
        },
        command: ['/bin/sh', '-c', 'dotnet restore /workspace/Sandbox.csproj --ignore-failed-sources --nologo && dotnet run --project /workspace/Sandbox.csproj --no-restore --nologo'],
        tests: 2,
      }
    case 'web-api-sealed-services':
      return {
        files: {
          'Program.cs': `using System;\nusing System.Linq;\nusing System.Threading;\nusing System.Threading.Tasks;\n\npublic interface IOrderService { }\n\n${code}\n\npublic static class Program\n{\n    public static void Main()\n    {\n        var type = typeof(OrderService);\n        var hasCancellationAwareAsyncMethod = type.GetMethods().Any(method =>\n            typeof(Task).IsAssignableFrom(method.ReturnType) &&\n            method.GetParameters().Any(parameter => parameter.ParameterType == typeof(CancellationToken)));\n        if (!type.IsSealed || !typeof(IOrderService).IsAssignableFrom(type) || !hasCancellationAwareAsyncMethod)\n            throw new InvalidOperationException("OrderService must be sealed, implement IOrderService, and expose an async operation with CancellationToken.");\n        Console.WriteLine("PATHWAY_TEST_PASS");\n    }\n}\n`,
          'Sandbox.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>',
        },
        command: ['/bin/sh', '-c', 'dotnet restore /workspace/Sandbox.csproj --ignore-failed-sources --nologo && dotnet run --project /workspace/Sandbox.csproj --no-restore --nologo'],
        tests: 3,
      }
    case 'python-fastapi-endpoint':
      return {
        files: {
          'submission.py': code,
          'test_submission.py': `import ast\n\nsource = open('/workspace/submission.py', encoding='utf-8').read()\ntree = ast.parse(source)\nfor node in ast.walk(tree):\n    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):\n        continue\n    has_health_decorator = any(\n        isinstance(decorator, ast.Call)\n        and isinstance(decorator.func, ast.Attribute)\n        and decorator.func.attr == 'get'\n        and decorator.args\n        and isinstance(decorator.args[0], ast.Constant)\n        and decorator.args[0].value == '/health'\n        for decorator in node.decorator_list\n    )\n    if has_health_decorator and any(isinstance(item, ast.Return) for item in ast.walk(node)):\n        print('PATHWAY_TEST_PASS')\n        break\nelse:\n    raise AssertionError('Add a @app.get(\"/health\") function that returns a value.')\n`,
        },
        command: ['python3', '/workspace/test_submission.py'],
        tests: 2,
      }
    case "git-init-status":
      return gitFixture(code, "printf '# Pathway Git Lab\\n' > README.md", "test -d .git || { echo 'Repository was not initialized.'; exit 1; }\ngit status --porcelain | grep -q '^?? README.md
  }
}

export function boundedOutput(stdout = '', stderr = '') {
  const output = `${stdout}${stderr}`.trim()
  return output.length > 4_000 ? `${output.slice(0, 4_000)}\n[output truncated]` : output
}

export function evaluationResult(fixture, exitCode, output) {
  const passed = exitCode === 0 && output.includes('PATHWAY_TEST_PASS') && (!fixture.requiredOutput || output.includes(fixture.requiredOutput))
  return { passed, passingTests: passed ? fixture.tests : 0, totalTests: fixture.tests, feedback: passed ? 'All isolated Modal sandbox tests passed.' : (output || 'The sandboxed test did not produce a passing result.'), nextLessonSlug: null }
}


const MAX_HOOK_SCRIPT_BYTES = 20_000
const MAX_HOOK_COMMAND_BYTES = 1_000

export function validateHookRequest(value) {
  if (!value || value.event !== 'PreToolUse') return 'Only PreToolUse hooks are supported.'
  if (typeof value.matcher !== 'string' || value.matcher.length === 0 || value.matcher.length > 120) return 'Matcher must be between 1 and 120 characters.'
  if (typeof value.script !== 'string' || value.script.length === 0 || Buffer.byteLength(value.script, 'utf8') > MAX_HOOK_SCRIPT_BYTES) return 'Hook script must be between 1 and 20,000 bytes.'
  if (typeof value.command !== 'string' || value.command.length === 0 || Buffer.byteLength(value.command, 'utf8') > MAX_HOOK_COMMAND_BYTES) return 'Simulated command must be between 1 and 1,000 bytes.'
  try { new RegExp(`^(?:${value.matcher})$`) } catch { return 'Matcher is not a valid regular expression.' }
  return null
}

export function hookMatcherMatches(matcher, toolName = 'Bash') {
  if (matcher === '*') return true
  return new RegExp(`^(?:${matcher})$`).test(toolName)
}

export function hookInputFor(command) {
  return {
    session_id: 'pathway-hook-lab',
    transcript_path: '/tmp/pathway-hook-lab/transcript.jsonl',
    cwd: '/workspace',
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command,
      description: 'Pathway Hook Playground simulated Bash tool call',
    },
    tool_use_id: 'toolu_pathway_lab',
  }
}

export function interpretHookResult(inputJson, matcherMatched, exitCode, stdout = '', stderr = '') {
  const cleanStdout = stdout.trim()
  const cleanStderr = stderr.trim()
  if (!matcherMatched) {
    return {
      matcherMatched: false,
      executed: false,
      exitCode: null,
      outcome: 'skipped',
      summary: 'The hook did not run because the matcher did not match the Bash tool.',
      reason: null,
      stdout: '',
      stderr: '',
      inputJson,
    }
  }

  if (exitCode === 2) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'blocked',
      summary: 'Claude Code would block this PreToolUse tool call.',
      reason: cleanStderr || 'The hook exited with blocking status code 2.',
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  let parsed = null
  if (cleanStdout.startsWith('{') && cleanStdout.endsWith('}')) {
    try { parsed = JSON.parse(cleanStdout) } catch { parsed = null }
  }

  const hookOutput = parsed?.hookSpecificOutput
  if (hookOutput?.hookEventName === 'PreToolUse') {
    const decision = hookOutput.permissionDecision
    const reason = hookOutput.permissionDecisionReason ?? null
    const known = new Set(['allow', 'deny', 'ask', 'defer'])
    if (!known.has(decision)) {
      return {
        matcherMatched: true,
        executed: true,
        exitCode,
        outcome: 'error',
        summary: 'Claude Code would treat this as a non-blocking hook error and continue normal permission flow.',
        reason: 'permissionDecision must be allow, deny, ask, or defer.',
        stdout: cleanStdout,
        stderr: cleanStderr,
        inputJson,
      }
    }
    const summaries = {
      deny: 'Claude Code would deny the Bash tool call and show Claude the hook reason.',
      allow: 'Claude Code would allow the Bash tool call without prompting for permission.',
      ask: 'Claude Code would require the normal user permission prompt.',
      defer: 'Claude Code would defer the tool call for later handling.',
    }
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: decision === 'deny' ? 'denied' : decision === 'allow' ? 'allowed' : decision,
      summary: summaries[decision],
      reason,
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  if (exitCode === 0 && !cleanStdout) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'no_decision',
      summary: 'The hook succeeded silently. Claude Code would continue through its normal permission flow.',
      reason: null,
      stdout: '',
      stderr: cleanStderr,
      inputJson,
    }
  }

  return {
    matcherMatched: true,
    executed: true,
    exitCode,
    outcome: 'error',
    summary: exitCode === 0
      ? 'Claude Code would treat this output as a non-blocking hook error and continue normal permission flow.'
      : 'The hook failed with a non-blocking status. Claude Code would continue normal permission flow.',
    reason: exitCode === 0
      ? 'PreToolUse structured decisions must be a valid JSON object on stdout.'
      : (cleanStderr || `Hook exited with status ${exitCode}.`),
    stdout: cleanStdout,
    stderr: cleanStderr,
    inputJson,
  }
}
 || { echo 'README.md should remain untracked.'; exit 1; }")
    case "git-stage-files":
      return gitFixture(code, "git init -q\nprintf '# Pathway Git Lab\\n' > README.md\nprintf 'scratch\\n' > notes.txt", "git diff --cached --name-only | grep -qx 'README.md' || { echo 'README.md is not staged.'; exit 1; }\n! git diff --cached --name-only | grep -qx 'notes.txt' || { echo 'notes.txt should not be staged.'; exit 1; }\ngit status --porcelain | grep -q '^?? notes.txt
  }
}

export function boundedOutput(stdout = '', stderr = '') {
  const output = `${stdout}${stderr}`.trim()
  return output.length > 4_000 ? `${output.slice(0, 4_000)}\n[output truncated]` : output
}

export function evaluationResult(fixture, exitCode, output) {
  const passed = exitCode === 0 && output.includes('PATHWAY_TEST_PASS') && (!fixture.requiredOutput || output.includes(fixture.requiredOutput))
  return { passed, passingTests: passed ? fixture.tests : 0, totalTests: fixture.tests, feedback: passed ? 'All isolated Modal sandbox tests passed.' : (output || 'The sandboxed test did not produce a passing result.'), nextLessonSlug: null }
}


const MAX_HOOK_SCRIPT_BYTES = 20_000
const MAX_HOOK_COMMAND_BYTES = 1_000

export function validateHookRequest(value) {
  if (!value || value.event !== 'PreToolUse') return 'Only PreToolUse hooks are supported.'
  if (typeof value.matcher !== 'string' || value.matcher.length === 0 || value.matcher.length > 120) return 'Matcher must be between 1 and 120 characters.'
  if (typeof value.script !== 'string' || value.script.length === 0 || Buffer.byteLength(value.script, 'utf8') > MAX_HOOK_SCRIPT_BYTES) return 'Hook script must be between 1 and 20,000 bytes.'
  if (typeof value.command !== 'string' || value.command.length === 0 || Buffer.byteLength(value.command, 'utf8') > MAX_HOOK_COMMAND_BYTES) return 'Simulated command must be between 1 and 1,000 bytes.'
  try { new RegExp(`^(?:${value.matcher})$`) } catch { return 'Matcher is not a valid regular expression.' }
  return null
}

export function hookMatcherMatches(matcher, toolName = 'Bash') {
  if (matcher === '*') return true
  return new RegExp(`^(?:${matcher})$`).test(toolName)
}

export function hookInputFor(command) {
  return {
    session_id: 'pathway-hook-lab',
    transcript_path: '/tmp/pathway-hook-lab/transcript.jsonl',
    cwd: '/workspace',
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command,
      description: 'Pathway Hook Playground simulated Bash tool call',
    },
    tool_use_id: 'toolu_pathway_lab',
  }
}

export function interpretHookResult(inputJson, matcherMatched, exitCode, stdout = '', stderr = '') {
  const cleanStdout = stdout.trim()
  const cleanStderr = stderr.trim()
  if (!matcherMatched) {
    return {
      matcherMatched: false,
      executed: false,
      exitCode: null,
      outcome: 'skipped',
      summary: 'The hook did not run because the matcher did not match the Bash tool.',
      reason: null,
      stdout: '',
      stderr: '',
      inputJson,
    }
  }

  if (exitCode === 2) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'blocked',
      summary: 'Claude Code would block this PreToolUse tool call.',
      reason: cleanStderr || 'The hook exited with blocking status code 2.',
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  let parsed = null
  if (cleanStdout.startsWith('{') && cleanStdout.endsWith('}')) {
    try { parsed = JSON.parse(cleanStdout) } catch { parsed = null }
  }

  const hookOutput = parsed?.hookSpecificOutput
  if (hookOutput?.hookEventName === 'PreToolUse') {
    const decision = hookOutput.permissionDecision
    const reason = hookOutput.permissionDecisionReason ?? null
    const known = new Set(['allow', 'deny', 'ask', 'defer'])
    if (!known.has(decision)) {
      return {
        matcherMatched: true,
        executed: true,
        exitCode,
        outcome: 'error',
        summary: 'Claude Code would treat this as a non-blocking hook error and continue normal permission flow.',
        reason: 'permissionDecision must be allow, deny, ask, or defer.',
        stdout: cleanStdout,
        stderr: cleanStderr,
        inputJson,
      }
    }
    const summaries = {
      deny: 'Claude Code would deny the Bash tool call and show Claude the hook reason.',
      allow: 'Claude Code would allow the Bash tool call without prompting for permission.',
      ask: 'Claude Code would require the normal user permission prompt.',
      defer: 'Claude Code would defer the tool call for later handling.',
    }
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: decision === 'deny' ? 'denied' : decision === 'allow' ? 'allowed' : decision,
      summary: summaries[decision],
      reason,
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  if (exitCode === 0 && !cleanStdout) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'no_decision',
      summary: 'The hook succeeded silently. Claude Code would continue through its normal permission flow.',
      reason: null,
      stdout: '',
      stderr: cleanStderr,
      inputJson,
    }
  }

  return {
    matcherMatched: true,
    executed: true,
    exitCode,
    outcome: 'error',
    summary: exitCode === 0
      ? 'Claude Code would treat this output as a non-blocking hook error and continue normal permission flow.'
      : 'The hook failed with a non-blocking status. Claude Code would continue normal permission flow.',
    reason: exitCode === 0
      ? 'PreToolUse structured decisions must be a valid JSON object on stdout.'
      : (cleanStderr || `Hook exited with status ${exitCode}.`),
    stdout: cleanStdout,
    stderr: cleanStderr,
    inputJson,
  }
}
 || { echo 'notes.txt should remain untracked.'; exit 1; }")
    case "git-first-commit":
      return gitFixture(code, "git init -q\nprintf '# Pathway Git Lab\\n' > README.md\ngit add README.md", "git rev-parse --verify HEAD >/dev/null 2>&1 || { echo 'No commit exists yet.'; exit 1; }\ngit ls-tree --name-only HEAD | grep -qx 'README.md' || { echo 'README.md is not in the commit.'; exit 1; }\ntest -z \"$(git status --porcelain)\" || { echo 'The working tree should be clean after the commit.'; exit 1; }")
    case "git-history-diff":
      return gitFixture(code, "git init -q\nprintf '# Pathway Git Lab\\n' > README.md\ngit add README.md\ngit commit -qm 'Initial README'\nprintf 'notes v1\\n' > notes.txt\ngit add notes.txt\ngit commit -qm 'Add notes'\nprintf 'draft change\\n' >> notes.txt", "grep -q 'Add notes' /workspace/learner.out || { echo 'Output should include the Add notes commit.'; exit 1; }\ngrep -q 'Initial README' /workspace/learner.out || { echo 'Output should include the Initial README commit.'; exit 1; }\ngrep -q 'notes.txt' /workspace/learner.out || { echo 'Output should identify notes.txt as modified.'; exit 1; }")
    case "git-switch-branch":
      return gitFixture(code, "git init -q\nprintf 'baseline\\n' > app.txt\ngit add app.txt\ngit commit -qm 'Initial app'", "test \"$(git branch --show-current)\" = 'feature/navigation' || { echo 'Current branch should be feature/navigation.'; exit 1; }\ngit merge-base --is-ancestor main feature/navigation || { echo 'feature/navigation should start from main.'; exit 1; }")
    case "git-feature-commit":
      return gitFixture(code, "git init -q\nprintf 'Pathway app\\n' > app.txt\ngit add app.txt\ngit commit -qm 'Initial app'\ngit switch -q -c feature/greeting\ngit rev-parse main > /workspace/base_main", "test \"$(git branch --show-current)\" = 'feature/greeting' || { echo 'Stay on feature/greeting.'; exit 1; }\ntest \"$(git rev-list --count main..HEAD)\" -ge 1 || { echo 'The feature branch needs a commit.'; exit 1; }\ngrep -qx 'Hello from the feature branch' app.txt || { echo 'app.txt is missing the requested greeting.'; exit 1; }\ntest \"$(git rev-parse main)\" = \"$(cat /workspace/base_main)\" || { echo 'main should remain unchanged.'; exit 1; }")
    case "git-merge-feature":
      return gitFixture(code, "git init -q\nprintf '# Project\\n' > README.md\ngit add README.md\ngit commit -qm 'Initial README'\ngit switch -q -c feature/readme\nprintf '\\nFeature documentation\\n' >> README.md\ngit add README.md\ngit commit -qm 'Document feature'\ngit switch -q main", "git merge-base --is-ancestor feature/readme main || { echo 'feature/readme is not integrated into main.'; exit 1; }\ngrep -q 'Feature documentation' README.md || { echo 'README.md does not contain the feature content.'; exit 1; }\ntest -z \"$(git status --porcelain)\" || { echo 'The working tree should be clean.'; exit 1; }")
    case "git-resolve-conflict":
      return gitFixture(code, "git init -q\nprintf 'theme=light\\nfont=sans\\n' > settings.txt\ngit add settings.txt\ngit commit -qm 'Add settings'\ngit switch -q -c feature/theme\nprintf 'theme=purple\\nfont=sans\\n' > settings.txt\ngit add settings.txt\ngit commit -qm 'Use purple theme'\ngit switch -q main\nprintf 'theme=light\\nfont=mono\\n' > settings.txt\ngit add settings.txt\ngit commit -qm 'Use mono font'", "test -z \"$(git ls-files -u)\" || { echo 'Unmerged paths remain.'; exit 1; }\nprintf 'theme=purple\\nfont=mono\\n' > /workspace/expected_settings\ncmp -s settings.txt /workspace/expected_settings || { echo 'settings.txt does not contain the required combined result.'; exit 1; }\ntest \"$(git rev-list --parents -n 1 HEAD | awk '{print NF}')\" -eq 3 || { echo 'HEAD should be the completed merge commit.'; exit 1; }")
    case "git-restore-reset":
      return gitFixture(code, "git init -q\nprintf 'stable app\\n' > app.txt\nprintf 'stable notes\\n' > notes.txt\ngit add app.txt notes.txt\ngit commit -qm 'Baseline'\nprintf 'temporary app edit\\n' >> app.txt\nprintf 'keep this notes edit\\n' >> notes.txt\ngit add notes.txt", "git diff --quiet -- app.txt || { echo 'The unstaged app.txt change should be discarded.'; exit 1; }\ngit diff --cached --quiet -- notes.txt || { echo 'notes.txt should be unstaged.'; exit 1; }\n! git diff --quiet -- notes.txt || { echo 'The notes.txt working-tree edit should be preserved.'; exit 1; }")
    case "git-ignore-generated-files":
      return gitFixture(code, "git init -q\nprintf 'SECRET=not-real\\n' > .env\nprintf 'generated log\\n' > app.log\nprintf 'source\\n' > src.txt", "git check-ignore -q .env || { echo '.env should be ignored.'; exit 1; }\ngit check-ignore -q app.log || { echo 'app.log should be ignored by *.log.'; exit 1; }\ngit diff --cached --name-only | grep -qx '.gitignore' || { echo '.gitignore should be staged.'; exit 1; }\ngit diff --cached --name-only | grep -qx 'src.txt' || { echo 'src.txt should be staged.'; exit 1; }\n! git diff --cached --name-only | grep -Eq '^(\\.env|app\\.log)
  }
}

export function boundedOutput(stdout = '', stderr = '') {
  const output = `${stdout}${stderr}`.trim()
  return output.length > 4_000 ? `${output.slice(0, 4_000)}\n[output truncated]` : output
}

export function evaluationResult(fixture, exitCode, output) {
  const passed = exitCode === 0 && output.includes('PATHWAY_TEST_PASS') && (!fixture.requiredOutput || output.includes(fixture.requiredOutput))
  return { passed, passingTests: passed ? fixture.tests : 0, totalTests: fixture.tests, feedback: passed ? 'All isolated Modal sandbox tests passed.' : (output || 'The sandboxed test did not produce a passing result.'), nextLessonSlug: null }
}


const MAX_HOOK_SCRIPT_BYTES = 20_000
const MAX_HOOK_COMMAND_BYTES = 1_000

export function validateHookRequest(value) {
  if (!value || value.event !== 'PreToolUse') return 'Only PreToolUse hooks are supported.'
  if (typeof value.matcher !== 'string' || value.matcher.length === 0 || value.matcher.length > 120) return 'Matcher must be between 1 and 120 characters.'
  if (typeof value.script !== 'string' || value.script.length === 0 || Buffer.byteLength(value.script, 'utf8') > MAX_HOOK_SCRIPT_BYTES) return 'Hook script must be between 1 and 20,000 bytes.'
  if (typeof value.command !== 'string' || value.command.length === 0 || Buffer.byteLength(value.command, 'utf8') > MAX_HOOK_COMMAND_BYTES) return 'Simulated command must be between 1 and 1,000 bytes.'
  try { new RegExp(`^(?:${value.matcher})$`) } catch { return 'Matcher is not a valid regular expression.' }
  return null
}

export function hookMatcherMatches(matcher, toolName = 'Bash') {
  if (matcher === '*') return true
  return new RegExp(`^(?:${matcher})$`).test(toolName)
}

export function hookInputFor(command) {
  return {
    session_id: 'pathway-hook-lab',
    transcript_path: '/tmp/pathway-hook-lab/transcript.jsonl',
    cwd: '/workspace',
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command,
      description: 'Pathway Hook Playground simulated Bash tool call',
    },
    tool_use_id: 'toolu_pathway_lab',
  }
}

export function interpretHookResult(inputJson, matcherMatched, exitCode, stdout = '', stderr = '') {
  const cleanStdout = stdout.trim()
  const cleanStderr = stderr.trim()
  if (!matcherMatched) {
    return {
      matcherMatched: false,
      executed: false,
      exitCode: null,
      outcome: 'skipped',
      summary: 'The hook did not run because the matcher did not match the Bash tool.',
      reason: null,
      stdout: '',
      stderr: '',
      inputJson,
    }
  }

  if (exitCode === 2) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'blocked',
      summary: 'Claude Code would block this PreToolUse tool call.',
      reason: cleanStderr || 'The hook exited with blocking status code 2.',
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  let parsed = null
  if (cleanStdout.startsWith('{') && cleanStdout.endsWith('}')) {
    try { parsed = JSON.parse(cleanStdout) } catch { parsed = null }
  }

  const hookOutput = parsed?.hookSpecificOutput
  if (hookOutput?.hookEventName === 'PreToolUse') {
    const decision = hookOutput.permissionDecision
    const reason = hookOutput.permissionDecisionReason ?? null
    const known = new Set(['allow', 'deny', 'ask', 'defer'])
    if (!known.has(decision)) {
      return {
        matcherMatched: true,
        executed: true,
        exitCode,
        outcome: 'error',
        summary: 'Claude Code would treat this as a non-blocking hook error and continue normal permission flow.',
        reason: 'permissionDecision must be allow, deny, ask, or defer.',
        stdout: cleanStdout,
        stderr: cleanStderr,
        inputJson,
      }
    }
    const summaries = {
      deny: 'Claude Code would deny the Bash tool call and show Claude the hook reason.',
      allow: 'Claude Code would allow the Bash tool call without prompting for permission.',
      ask: 'Claude Code would require the normal user permission prompt.',
      defer: 'Claude Code would defer the tool call for later handling.',
    }
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: decision === 'deny' ? 'denied' : decision === 'allow' ? 'allowed' : decision,
      summary: summaries[decision],
      reason,
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  if (exitCode === 0 && !cleanStdout) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'no_decision',
      summary: 'The hook succeeded silently. Claude Code would continue through its normal permission flow.',
      reason: null,
      stdout: '',
      stderr: cleanStderr,
      inputJson,
    }
  }

  return {
    matcherMatched: true,
    executed: true,
    exitCode,
    outcome: 'error',
    summary: exitCode === 0
      ? 'Claude Code would treat this output as a non-blocking hook error and continue normal permission flow.'
      : 'The hook failed with a non-blocking status. Claude Code would continue normal permission flow.',
    reason: exitCode === 0
      ? 'PreToolUse structured decisions must be a valid JSON object on stdout.'
      : (cleanStderr || `Hook exited with status ${exitCode}.`),
    stdout: cleanStdout,
    stderr: cleanStderr,
    inputJson,
  }
}
 || { echo 'Ignored files must not be staged.'; exit 1; }")
    case "git-fetch-remote":
      return gitFixture(code, "cd /workspace\ngit init -q --bare remote.git\ngit init -q seed\ncd seed\nprintf 'v1\\n' > app.txt\ngit add app.txt\ngit commit -qm 'Initial remote'\ngit remote add origin /workspace/remote.git\ngit push -q -u origin main\ncd /workspace\ngit clone -q /workspace/remote.git repo\ncd repo\ngit rev-parse main > /workspace/local_before\ncd /workspace/seed\nprintf 'v2\\n' >> app.txt\ngit add app.txt\ngit commit -qm 'Remote update'\ngit push -q origin main\ngit rev-parse HEAD > /workspace/remote_head\ncd /workspace/repo", "test \"$(git rev-parse origin/main)\" = \"$(cat /workspace/remote_head)\" || { echo 'origin/main was not updated by fetch.'; exit 1; }\ntest \"$(git rev-parse main)\" = \"$(cat /workspace/local_before)\" || { echo 'fetch should not move local main.'; exit 1; }\ntest \"$(git rev-parse main)\" != \"$(git rev-parse origin/main)\" || { echo 'local main should remain behind origin/main.'; exit 1; }\ntest -z \"$(git status --porcelain)\" || { echo 'The working tree should remain unchanged.'; exit 1; }")
    case "git-rebase-feature":
      return gitFixture(code, "git init -q\nprintf 'base\\n' > app.txt\ngit add app.txt\ngit commit -qm 'Initial app'\ngit switch -q -c feature/search\nprintf 'search\\n' > search.txt\ngit add search.txt\ngit commit -qm 'Add search'\ngit switch -q main\nprintf 'main update\\n' > main.txt\ngit add main.txt\ngit commit -qm 'Update main'\ngit switch -q feature/search", "git merge-base --is-ancestor main feature/search || { echo 'feature/search is not rebased onto main.'; exit 1; }\ngrep -qx 'search' search.txt || { echo 'The feature change was not preserved.'; exit 1; }\ntest -z \"$(git rev-list --merges main..feature/search)\" || { echo 'The rebased feature history should be linear.'; exit 1; }")
    case "git-revert-push":
      return gitFixture(code, "cd /workspace\ngit init -q --bare remote.git\ncd repo\ngit init -q\nprintf 'stable\\n' > app.txt\ngit add app.txt\ngit commit -qm 'Stable release'\ngit remote add origin /workspace/remote.git\ngit push -q -u origin main\nprintf 'debug=true\\n' > debug.txt\ngit add debug.txt\ngit commit -qm 'Bad debug change'\ngit push -q origin main\ngit rev-parse HEAD > /workspace/bad_sha", "test \"$(git rev-parse HEAD)\" != \"$(cat /workspace/bad_sha)\" || { echo 'A new revert commit should exist.'; exit 1; }\ngit merge-base --is-ancestor \"$(cat /workspace/bad_sha)\" HEAD || { echo 'The bad commit should remain in history rather than being rewritten away.'; exit 1; }\ntest ! -e debug.txt || { echo 'The revert should remove debug.txt.'; exit 1; }\ntest \"$(git rev-parse HEAD)\" = \"$(git --git-dir=/workspace/remote.git rev-parse refs/heads/main)\" || { echo 'origin/main does not match local main after push.'; exit 1; }")
    default:
      return null
  }
}

export function boundedOutput(stdout = '', stderr = '') {
  const output = `${stdout}${stderr}`.trim()
  return output.length > 4_000 ? `${output.slice(0, 4_000)}\n[output truncated]` : output
}

export function evaluationResult(fixture, exitCode, output) {
  const passed = exitCode === 0 && output.includes('PATHWAY_TEST_PASS') && (!fixture.requiredOutput || output.includes(fixture.requiredOutput))
  return { passed, passingTests: passed ? fixture.tests : 0, totalTests: fixture.tests, feedback: passed ? 'All isolated Modal sandbox tests passed.' : (output || 'The sandboxed test did not produce a passing result.'), nextLessonSlug: null }
}


const MAX_HOOK_SCRIPT_BYTES = 20_000
const MAX_HOOK_COMMAND_BYTES = 1_000

export function validateHookRequest(value) {
  if (!value || value.event !== 'PreToolUse') return 'Only PreToolUse hooks are supported.'
  if (typeof value.matcher !== 'string' || value.matcher.length === 0 || value.matcher.length > 120) return 'Matcher must be between 1 and 120 characters.'
  if (typeof value.script !== 'string' || value.script.length === 0 || Buffer.byteLength(value.script, 'utf8') > MAX_HOOK_SCRIPT_BYTES) return 'Hook script must be between 1 and 20,000 bytes.'
  if (typeof value.command !== 'string' || value.command.length === 0 || Buffer.byteLength(value.command, 'utf8') > MAX_HOOK_COMMAND_BYTES) return 'Simulated command must be between 1 and 1,000 bytes.'
  try { new RegExp(`^(?:${value.matcher})$`) } catch { return 'Matcher is not a valid regular expression.' }
  return null
}

export function hookMatcherMatches(matcher, toolName = 'Bash') {
  if (matcher === '*') return true
  return new RegExp(`^(?:${matcher})$`).test(toolName)
}

export function hookInputFor(command) {
  return {
    session_id: 'pathway-hook-lab',
    transcript_path: '/tmp/pathway-hook-lab/transcript.jsonl',
    cwd: '/workspace',
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command,
      description: 'Pathway Hook Playground simulated Bash tool call',
    },
    tool_use_id: 'toolu_pathway_lab',
  }
}

export function interpretHookResult(inputJson, matcherMatched, exitCode, stdout = '', stderr = '') {
  const cleanStdout = stdout.trim()
  const cleanStderr = stderr.trim()
  if (!matcherMatched) {
    return {
      matcherMatched: false,
      executed: false,
      exitCode: null,
      outcome: 'skipped',
      summary: 'The hook did not run because the matcher did not match the Bash tool.',
      reason: null,
      stdout: '',
      stderr: '',
      inputJson,
    }
  }

  if (exitCode === 2) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'blocked',
      summary: 'Claude Code would block this PreToolUse tool call.',
      reason: cleanStderr || 'The hook exited with blocking status code 2.',
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  let parsed = null
  if (cleanStdout.startsWith('{') && cleanStdout.endsWith('}')) {
    try { parsed = JSON.parse(cleanStdout) } catch { parsed = null }
  }

  const hookOutput = parsed?.hookSpecificOutput
  if (hookOutput?.hookEventName === 'PreToolUse') {
    const decision = hookOutput.permissionDecision
    const reason = hookOutput.permissionDecisionReason ?? null
    const known = new Set(['allow', 'deny', 'ask', 'defer'])
    if (!known.has(decision)) {
      return {
        matcherMatched: true,
        executed: true,
        exitCode,
        outcome: 'error',
        summary: 'Claude Code would treat this as a non-blocking hook error and continue normal permission flow.',
        reason: 'permissionDecision must be allow, deny, ask, or defer.',
        stdout: cleanStdout,
        stderr: cleanStderr,
        inputJson,
      }
    }
    const summaries = {
      deny: 'Claude Code would deny the Bash tool call and show Claude the hook reason.',
      allow: 'Claude Code would allow the Bash tool call without prompting for permission.',
      ask: 'Claude Code would require the normal user permission prompt.',
      defer: 'Claude Code would defer the tool call for later handling.',
    }
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: decision === 'deny' ? 'denied' : decision === 'allow' ? 'allowed' : decision,
      summary: summaries[decision],
      reason,
      stdout: cleanStdout,
      stderr: cleanStderr,
      inputJson,
    }
  }

  if (exitCode === 0 && !cleanStdout) {
    return {
      matcherMatched: true,
      executed: true,
      exitCode,
      outcome: 'no_decision',
      summary: 'The hook succeeded silently. Claude Code would continue through its normal permission flow.',
      reason: null,
      stdout: '',
      stderr: cleanStderr,
      inputJson,
    }
  }

  return {
    matcherMatched: true,
    executed: true,
    exitCode,
    outcome: 'error',
    summary: exitCode === 0
      ? 'Claude Code would treat this output as a non-blocking hook error and continue normal permission flow.'
      : 'The hook failed with a non-blocking status. Claude Code would continue normal permission flow.',
    reason: exitCode === 0
      ? 'PreToolUse structured decisions must be a valid JSON object on stdout.'
      : (cleanStderr || `Hook exited with status ${exitCode}.`),
    stdout: cleanStdout,
    stderr: cleanStderr,
    inputJson,
  }
}
