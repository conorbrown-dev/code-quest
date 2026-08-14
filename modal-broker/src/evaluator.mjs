const MAX_CODE_BYTES = 50_000

export function validateRequest(value) {
  if (!value || typeof value.lessonSlug !== 'string' || typeof value.code !== 'string') return 'lessonSlug and code are required.'
  if (value.lessonSlug.length > 200 || value.code.length === 0 || Buffer.byteLength(value.code, 'utf8') > MAX_CODE_BYTES) return 'Code must be between 1 and 50,000 bytes.'
  return null
}

export function fixtureFor(lessonSlug, code) {
  switch (lessonSlug) {
    case 'python-functions':
      return {
        files: { 'main.py': `${code}\n\nresult = greet('Ada')\nassert isinstance(result, str) and result.strip()\nprint('PATHWAY_TEST_PASS')\n` },
        command: ['python3', '/workspace/main.py'],
        tests: 2,
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
