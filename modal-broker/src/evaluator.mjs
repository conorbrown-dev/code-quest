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
  return { files: { 'exercise.sh': script }, command: ['/bin/bash', '/workspace/exercise.sh'], tests, runtime: 'git' }
}

function sqliteFixture(code, setup, checks, tests = 3) {
  const script = [
    '#!/bin/bash',
    'set -euo pipefail',
    'DB=/workspace/lab.db',
    "sqlite3 -batch -bail \"$DB\" <<'PATHWAY_SETUP'",
    setup,
    'PATHWAY_SETUP',
    "cat > /workspace/submission.sql <<'PATHWAY_SQL'",
    code,
    'PATHWAY_SQL',
    'sqlite3 -batch -bail "$DB" < /workspace/submission.sql > /workspace/learner.out',
    'cat /workspace/learner.out',
    checks,
    'echo PATHWAY_TEST_PASS',
    '',
  ].join('\n')
  return {
    files: { 'exercise.sh': script },
    command: ['/bin/bash', '/workspace/exercise.sh'],
    tests,
    runtime: 'sqlite',
  }
}

function reactFixture(code, checks, tests = 2) {
  const stubs = `
declare namespace React { type ReactNode = any }
declare namespace JSX { interface IntrinsicElements { [element: string]: any } }
declare module 'react' {
  export type ReactNode = any
  export type ButtonHTMLAttributes<T> = { className?: string; [key: string]: any }
  export type Context<T> = { __type?: T }
  export function useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void]
  export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function createContext<T>(value: T): Context<T>
  export function useContext<T>(context: Context<T>): T
  export function useActionState<S>(action: (state: S, data: FormData) => Promise<S>, initial: S): [S, (data: FormData) => void, boolean]
}
declare module 'react-dom' { export function useFormStatus(): { pending: boolean } }
declare module 'react-router/dom' {
  export type Router = unknown
  export function RouterProvider(props: { router: Router }): any
}
declare module 'react-router' {
  export type LoaderFunctionArgs = { params: Record<string, string | undefined>; request: Request }
  export type ActionFunctionArgs = { params: Record<string, string | undefined>; request: Request }
  export function createBrowserRouter(routes: unknown[]): unknown
  export function Form(props: { method?: string; action?: string; children?: any }): any
  export function Link(props: { to: string; children?: any }): any
  export function Outlet(): any
}
declare module '@testing-library/react' {
  export function render(value: any): unknown
  export const screen: { getByRole(role: string, options?: any): any }
}
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => void): void
  export function expect(value: any): any
}
`
  const tsconfig = JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      module: 'Preserve',
      moduleResolution: 'Bundler',
      jsx: 'preserve',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      lib: ['ES2023', 'DOM'],
    },
    files: ['/workspace/react-stubs.d.ts', '/workspace/submission.tsx'],
  })
  return {
    files: {
      'submission.tsx': code,
      'react-stubs.d.ts': stubs,
      'tsconfig.json': tsconfig,
    },
    command: ['/bin/sh', '-c', `tsc -p /workspace/tsconfig.json && ${checks} && echo PATHWAY_TEST_PASS`],
    tests,
    runtime: 'react',
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

    case 'sqlite-open-inspect':
      return sqliteFixture(code, '', "test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='products';\")\" = '1'; test \"$(sqlite3 \"$DB\" \"SELECT pk FROM pragma_table_info('products') WHERE name='id';\")\" = '1'; test \"$(sqlite3 \"$DB\" \"SELECT [notnull] FROM pragma_table_info('products') WHERE name='name';\")\" = '1'")
    case 'sqlite-strict-tables':
      return sqliteFixture(code, '', "grep -Eq 'CREATE TABLE users.*STRICT' <(sqlite3 \"$DB\" \"SELECT replace(sql, char(10), ' ') FROM sqlite_schema WHERE name='users';\") || { echo 'users must be STRICT'; exit 1; }; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM pragma_index_list('users') WHERE [unique]=1;\")\" -ge 1; test \"$(sqlite3 \"$DB\" \"SELECT dflt_value FROM pragma_table_info('users') WHERE name='active';\")\" = '1'")
    case 'sqlite-constraints':
      return sqliteFixture(code, '', "sqlite3 \"$DB\" \"INSERT INTO inventory(sku, location) VALUES('A','WH1');\"; test \"$(sqlite3 \"$DB\" \"SELECT quantity FROM inventory WHERE sku='A';\")\" = '0'; ! sqlite3 \"$DB\" \"INSERT INTO inventory(sku,quantity,location) VALUES('B',-1,'WH1');\" >/dev/null 2>&1; test \"$(sqlite3 \"$DB\" \"SELECT pk FROM pragma_table_info('inventory') WHERE name='sku';\")\" = '1'")
    case 'sqlite-crud':
      return sqliteFixture(code, "CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1); INSERT INTO users(email) VALUES('temp@example.test');", "test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM users WHERE email IN ('ada@example.test','grace@example.test');\")\" = '2'; test \"$(sqlite3 \"$DB\" \"SELECT active FROM users WHERE email='grace@example.test';\")\" = '0'; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM users WHERE email='temp@example.test';\")\" = '0'")
    case 'sqlite-select-filter-sort':
      return sqliteFixture(code, "CREATE TABLE users(email TEXT, active INTEGER, created_at TEXT); INSERT INTO users VALUES('old@example.test',1,'2026-01-01'),('new@example.test',1,'2026-09-01'),('off@example.test',0,'2026-10-01'),('b@example.test',1,'2026-08-01'),('c@example.test',1,'2026-07-01'),('d@example.test',1,'2026-06-01'),('e@example.test',1,'2026-05-01'),('f@example.test',1,'2026-04-01');", "test \"$(wc -l < /workspace/learner.out | tr -d ' ')\" = '5'; head -n 1 /workspace/learner.out | grep -Fq 'new@example.test|2026-09-01'; ! grep -Fq 'off@example.test' /workspace/learner.out")
    case 'sqlite-joins':
      return sqliteFixture(code, "CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE orders(id INTEGER PRIMARY KEY,customer_id INTEGER,total REAL); INSERT INTO customers VALUES(1,'Ada'),(2,'Grace'); INSERT INTO orders VALUES(10,1,12.5),(11,2,30.0);", "test \"$(wc -l < /workspace/learner.out | tr -d ' ')\" = '2'; grep -Fq '10|Ada|12.5' /workspace/learner.out; grep -Fq '11|Grace|30.0' /workspace/learner.out")
    case 'sqlite-aggregates-group-having':
      return sqliteFixture(code, "CREATE TABLE orders(customer_id INTEGER,total REAL); INSERT INTO orders VALUES(1,10),(1,20),(2,5),(3,7),(3,8),(3,9);", "grep -Fq '1|2|30.0' /workspace/learner.out; grep -Fq '3|3|24.0' /workspace/learner.out; ! grep -Eq '^2\\|' /workspace/learner.out")
    case 'sqlite-ctes-subqueries':
      return sqliteFixture(code, "CREATE TABLE users(role TEXT,active INTEGER); INSERT INTO users VALUES('admin',1),('admin',1),('admin',0),('editor',1),('viewer',1),('viewer',1);", "grep -Fq 'admin|2' /workspace/learner.out; grep -Fq 'viewer|2' /workspace/learner.out; ! grep -Fq 'editor|' /workspace/learner.out")
    case 'sqlite-transactions':
      return sqliteFixture(code, "CREATE TABLE accounts(id INTEGER PRIMARY KEY,balance INTEGER NOT NULL); INSERT INTO accounts VALUES(1,100),(2,50);", "test \"$(sqlite3 \"$DB\" \"SELECT balance FROM accounts WHERE id=1;\")\" = '75'; test \"$(sqlite3 \"$DB\" \"SELECT balance FROM accounts WHERE id=2;\")\" = '75'; grep -Eqi 'BEGIN|BEGIN TRANSACTION' /workspace/submission.sql")
    case 'sqlite-foreign-keys':
      return sqliteFixture(code, "CREATE TABLE customers(id INTEGER PRIMARY KEY); INSERT INTO customers VALUES(1);", "grep -Eqi 'PRAGMA[[:space:]]+foreign_keys[[:space:]]*=[[:space:]]*ON' /workspace/submission.sql; grep -Eqi 'REFERENCES[[:space:]]+customers' /workspace/submission.sql; grep -Eqi 'ON[[:space:]]+DELETE[[:space:]]+RESTRICT' /workspace/submission.sql; ! sqlite3 \"$DB\" \"PRAGMA foreign_keys=ON; INSERT INTO orders(customer_id) VALUES(999);\" >/dev/null 2>&1")
    case 'sqlite-indexes':
      return sqliteFixture(code, "CREATE TABLE orders(id INTEGER PRIMARY KEY,customer_id INTEGER,created_at TEXT);", "test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name='idx_orders_customer_created';\")\" = '1'; test \"$(sqlite3 \"$DB\" \"SELECT group_concat(name, ',') FROM pragma_index_info('idx_orders_customer_created') ORDER BY seqno;\")\" = 'customer_id,created_at'; test \"$(sqlite3 \"$DB\" \"SELECT [unique] FROM pragma_index_list('orders') WHERE name='idx_orders_customer_created';\")\" = '0'")
    case 'sqlite-schema-migrations':
      return sqliteFixture(code, "CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL); INSERT INTO users(email) VALUES('ada@example.test');", "test \"$(sqlite3 \"$DB\" \"SELECT type FROM pragma_table_info('users') WHERE name='display_name';\")\" = 'TEXT'; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM users;\")\" = '1'; test \"$(sqlite3 \"$DB\" \"SELECT [notnull] FROM pragma_table_info('users') WHERE name='display_name';\")\" = '0'")
    case 'sqlite-views-triggers':
      return sqliteFixture(code, "CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER); INSERT INTO users VALUES(1,'ada@example.test',1),(2,'off@example.test',0);", "test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM sqlite_schema WHERE type='view' AND name='active_users';\")\" = '1'; test \"$(sqlite3 \"$DB\" \"SELECT group_concat(name, ',') FROM pragma_table_info('active_users');\")\" = 'id,email'; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM active_users;\")\" = '1'")
    case 'sqlite-capstone':
      return sqliteFixture(code, '', "test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('projects','users','issues','comments');\")\" = '4'; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name='idx_issues_project_status_created';\")\" = '1'; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM sqlite_schema WHERE type='view' AND name='open_issue_summary';\")\" = '1'; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM issues WHERE status='open';\")\" -ge 1; test \"$(sqlite3 \"$DB\" \"SELECT COUNT(*) FROM comments;\")\" -ge 1; test \"$(sqlite3 \"$DB\" \"PRAGMA integrity_check;\")\" = 'ok'; grep -Eqi 'BEGIN|BEGIN TRANSACTION' /workspace/submission.sql")

    case 'react-lite-jsx-rendering':
      return reactFixture(code, "grep -Fq 'DashboardHeading' /workspace/submission.tsx && grep -Fq '<h1' /workspace/submission.tsx && grep -Fq 'title' /workspace/submission.tsx")
    case 'react-lite-components-props':
      return reactFixture(code, "grep -Fq 'StatCard' /workspace/submission.tsx && grep -Fq 'label' /workspace/submission.tsx && grep -Fq 'value' /workspace/submission.tsx")
    case 'react-lite-state':
      return reactFixture(code, "grep -Fq 'useState' /workspace/submission.tsx && grep -Fq 'onChange' /workspace/submission.tsx && grep -Fq 'value=' /workspace/submission.tsx")
    case 'react-lite-forms':
      return reactFixture(code, "grep -Fq 'useState' /workspace/submission.tsx && grep -Fq '<form' /workspace/submission.tsx && grep -Fq \"type='email'\" /workspace/submission.tsx")
    case 'react-lite-router-pages':
      return reactFixture(code, "grep -Fq 'createBrowserRouter' /workspace/submission.tsx && grep -Fq '/users' /workspace/submission.tsx")
    case 'react-lite-layout-nav':
      return reactFixture(code, "grep -Fq 'Link' /workspace/submission.tsx && grep -Fq 'Outlet' /workspace/submission.tsx && grep -Fq '/users' /workspace/submission.tsx")
    case 'react-lite-table-filter-sort':
      return reactFixture(code, "grep -Fq 'filterUsers' /workspace/submission.tsx && grep -Fq '.filter(' /workspace/submission.tsx && grep -Fq 'toLowerCase' /workspace/submission.tsx")
    case 'react-lite-dummy-api-read':
      return reactFixture(code, "grep -Fq 'usersApi' /workspace/submission.tsx && grep -Fq 'async list' /workspace/submission.tsx && grep -Fq 'seedUsers' /workspace/submission.tsx")
    case 'react-lite-router-loader':
      return reactFixture(code, "grep -Fq 'usersLoader' /workspace/submission.tsx && grep -Fq 'usersApi.list' /workspace/submission.tsx")
    case 'react-lite-dummy-api-write':
      return reactFixture(code, "grep -Fq 'async create' /workspace/submission.tsx && grep -Fq 'users.push' /workspace/submission.tsx")
    case 'react-lite-router-action-crud':
      return reactFixture(code, "grep -Fq 'ActionFunctionArgs' /workspace/submission.tsx && grep -Fq 'formData' /workspace/submission.tsx && grep -Fq 'usersApi.create' /workspace/submission.tsx")
    case 'react-lite-basic-testing':
      return reactFixture(code, "grep -Fq \"from 'vitest'\" /workspace/submission.tsx && grep -Fq 'filterUsers' /workspace/submission.tsx && grep -Fq 'toHaveLength' /workspace/submission.tsx")
    case 'react-lite-capstone':
      return reactFixture(code, "grep -Fq 'DashboardPage' /workspace/submission.tsx && grep -Fq 'StatCard' /workspace/submission.tsx && grep -Fq 'UserTable' /workspace/submission.tsx")
    case 'react-composition-root':
      return reactFixture(code, "grep -Fq 'RouterProvider' /workspace/submission.tsx && grep -Fq 'AppProviders' /workspace/submission.tsx")
    case 'react-props-composition':
      return reactFixture(code, "grep -Fq 'OrderStatusBadge' /workspace/submission.tsx && grep -Fq '<span' /workspace/submission.tsx")
    case 'react-use-state':
      return reactFixture(code, "grep -Fq 'useState' /workspace/submission.tsx && grep -Fq 'onClick' /workspace/submission.tsx")
    case 'react-use-reducer':
      return reactFixture(code, "grep -Fq 'useReducer' /workspace/submission.tsx && grep -Fq 'type Action' /workspace/submission.tsx")
    case 'react-effects-synchronization':
      return reactFixture(code, "grep -Fq 'useEffect' /workspace/submission.tsx && grep -Fq 'subscribeToOrder' /workspace/submission.tsx && grep -Fq '[orderId]' /workspace/submission.tsx")
    case 'react-context-provider-boundaries':
      return reactFixture(code, "grep -Fq 'createContext' /workspace/submission.tsx && grep -Fq 'useTenant' /workspace/submission.tsx && grep -Fq 'TenantProvider' /workspace/submission.tsx")
    case 'react-actions-optimistic-use':
      return reactFixture(code, "grep -Fq 'useActionState' /workspace/submission.tsx && grep -Fq 'useFormStatus' /workspace/submission.tsx && grep -Fq '<form' /workspace/submission.tsx")
    case 'react-router-data-mode':
      return reactFixture(code, "grep -Fq 'createBrowserRouter' /workspace/submission.tsx && grep -Fq 'orders' /workspace/submission.tsx")
    case 'react-router-loaders-params-search':
      return reactFixture(code, "grep -Fq 'params.orderId' /workspace/submission.tsx && grep -Fq 'getOrder' /workspace/submission.tsx")
    case 'react-router-actions-navigation':
      return reactFixture(code, "grep -Fq 'approveOrder' /workspace/submission.tsx && grep -Fq '<Form' /workspace/submission.tsx")
    case 'react-api-client-boundary':
      return reactFixture(code, "grep -Fq 'encodeURIComponent' /workspace/submission.tsx && grep -Fq 'response.ok' /workspace/submission.tsx && grep -Fq 'signal' /workspace/submission.tsx")
    case 'react-tailwind-design-system':
      return reactFixture(code, "grep -Fq 'ButtonHTMLAttributes' /workspace/submission.tsx && grep -Fq 'primary' /workspace/submission.tsx && grep -Fq 'secondary' /workspace/submission.tsx")
    case 'react-testing-vitest-rtl':
      return reactFixture(code, "grep -Fq 'render(' /workspace/submission.tsx && grep -Fq 'getByRole' /workspace/submission.tsx && grep -Fq 'expect' /workspace/submission.tsx")
    case 'react-enterprise-capstone':
      return reactFixture(code, "grep -Fq 'OrderApprovalPage' /workspace/submission.tsx && grep -Fq 'OrderSummary' /workspace/submission.tsx && grep -Fq 'ApproveOrderForm' /workspace/submission.tsx")
    case "git-init-status":
      return gitFixture(code, "printf '# Pathway Git Lab\\n' > README.md", "test -d .git || { echo 'Repository was not initialized.'; exit 1; }; git status --porcelain | grep -Fq '?? README.md' || { echo 'README.md should remain untracked.'; exit 1; }")
    case "git-stage-files":
      return gitFixture(code, "git init -q; printf '# Pathway Git Lab\\n' > README.md; printf 'scratch\\n' > notes.txt", "git diff --cached --name-only | grep -Fxq 'README.md' || { echo 'README.md is not staged.'; exit 1; }; ! git diff --cached --name-only | grep -Fxq 'notes.txt' || { echo 'notes.txt should not be staged.'; exit 1; }; git status --porcelain | grep -Fq '?? notes.txt' || { echo 'notes.txt should remain untracked.'; exit 1; }")
    case "git-first-commit":
      return gitFixture(code, "git init -q; printf '# Pathway Git Lab\\n' > README.md; git add README.md", "git rev-parse --verify HEAD >/dev/null 2>&1 || { echo 'No commit exists yet.'; exit 1; }; git ls-tree --name-only HEAD | grep -Fxq 'README.md' || { echo 'README.md is not in the commit.'; exit 1; }; test -z \"$(git status --porcelain)\" || { echo 'The working tree should be clean after the commit.'; exit 1; }")
    case "git-history-diff":
      return gitFixture(code, "git init -q; printf '# Pathway Git Lab\\n' > README.md; git add README.md; git commit -qm 'Initial README'; printf 'notes v1\\n' > notes.txt; git add notes.txt; git commit -qm 'Add notes'; printf 'draft change\\n' >> notes.txt", "grep -Fq 'Add notes' /workspace/learner.out || { echo 'Output should include the Add notes commit.'; exit 1; }; grep -Fq 'Initial README' /workspace/learner.out || { echo 'Output should include the Initial README commit.'; exit 1; }; grep -Fq 'notes.txt' /workspace/learner.out || { echo 'Output should identify notes.txt as modified.'; exit 1; }")
    case "git-switch-branch":
      return gitFixture(code, "git init -q; printf 'baseline\\n' > app.txt; git add app.txt; git commit -qm 'Initial app'", "test \"$(git branch --show-current)\" = 'feature/navigation' || { echo 'Current branch should be feature/navigation.'; exit 1; }; git merge-base --is-ancestor main feature/navigation || { echo 'feature/navigation should start from main.'; exit 1; }")
    case "git-feature-commit":
      return gitFixture(code, "git init -q; printf 'Pathway app\\n' > app.txt; git add app.txt; git commit -qm 'Initial app'; git switch -q -c feature/greeting; git rev-parse main > /workspace/base_main", "test \"$(git branch --show-current)\" = 'feature/greeting' || { echo 'Stay on feature/greeting.'; exit 1; }; test \"$(git rev-list --count main..HEAD)\" -ge 1 || { echo 'The feature branch needs a commit.'; exit 1; }; grep -Fxq 'Hello from the feature branch' app.txt || { echo 'app.txt is missing the requested greeting.'; exit 1; }; test \"$(git rev-parse main)\" = \"$(cat /workspace/base_main)\" || { echo 'main should remain unchanged.'; exit 1; }")
    case "git-merge-feature":
      return gitFixture(code, "git init -q; printf '# Project\\n' > README.md; git add README.md; git commit -qm 'Initial README'; git switch -q -c feature/readme; printf '\\nFeature documentation\\n' >> README.md; git add README.md; git commit -qm 'Document feature'; git switch -q main", "git merge-base --is-ancestor feature/readme main || { echo 'feature/readme is not integrated into main.'; exit 1; }; grep -Fq 'Feature documentation' README.md || { echo 'README.md does not contain the feature content.'; exit 1; }; test -z \"$(git status --porcelain)\" || { echo 'The working tree should be clean.'; exit 1; }")
    case "git-resolve-conflict":
      return gitFixture(code, "git init -q; printf 'theme=light\\nfont=sans\\n' > settings.txt; git add settings.txt; git commit -qm 'Add settings'; git switch -q -c feature/theme; printf 'theme=purple\\nfont=sans\\n' > settings.txt; git add settings.txt; git commit -qm 'Use purple theme'; git switch -q main; printf 'theme=light\\nfont=mono\\n' > settings.txt; git add settings.txt; git commit -qm 'Use mono font'", "test -z \"$(git ls-files -u)\" || { echo 'Unmerged paths remain.'; exit 1; }; printf 'theme=purple\\nfont=mono\\n' > /workspace/expected_settings; cmp -s settings.txt /workspace/expected_settings || { echo 'settings.txt does not contain the required combined result.'; exit 1; }; test \"$(git rev-list --parents -n 1 HEAD | wc -w)\" -eq 3 || { echo 'HEAD should be the completed merge commit.'; exit 1; }")
    case "git-restore-reset":
      return gitFixture(code, "git init -q; printf 'stable app\\n' > app.txt; printf 'stable notes\\n' > notes.txt; git add app.txt notes.txt; git commit -qm 'Baseline'; printf 'temporary app edit\\n' >> app.txt; printf 'keep this notes edit\\n' >> notes.txt; git add notes.txt", "git diff --quiet -- app.txt || { echo 'The unstaged app.txt change should be discarded.'; exit 1; }; git diff --cached --quiet -- notes.txt || { echo 'notes.txt should be unstaged.'; exit 1; }; ! git diff --quiet -- notes.txt || { echo 'The notes.txt working-tree edit should be preserved.'; exit 1; }")
    case "git-ignore-generated-files":
      return gitFixture(code, "git init -q; printf 'SECRET=not-real\\n' > .env; printf 'generated log\\n' > app.log; printf 'source\\n' > src.txt", "git check-ignore -q .env || { echo '.env should be ignored.'; exit 1; }; git check-ignore -q app.log || { echo 'app.log should be ignored by *.log.'; exit 1; }; git diff --cached --name-only | grep -Fxq '.gitignore' || { echo '.gitignore should be staged.'; exit 1; }; git diff --cached --name-only | grep -Fxq 'src.txt' || { echo 'src.txt should be staged.'; exit 1; }; ! git diff --cached --name-only | grep -Fxq '.env' || { echo '.env must not be staged.'; exit 1; }; ! git diff --cached --name-only | grep -Fxq 'app.log' || { echo 'app.log must not be staged.'; exit 1; }")
    case "git-fetch-remote":
      return gitFixture(code, "cd /workspace; git init -q --bare remote.git; git init -q seed; cd seed; printf 'v1\\n' > app.txt; git add app.txt; git commit -qm 'Initial remote'; git remote add origin /workspace/remote.git; git push -q -u origin main; cd /workspace; git clone -q /workspace/remote.git repo; cd repo; git rev-parse main > /workspace/local_before; cd /workspace/seed; printf 'v2\\n' >> app.txt; git add app.txt; git commit -qm 'Remote update'; git push -q origin main; git rev-parse HEAD > /workspace/remote_head; cd /workspace/repo", "test \"$(git rev-parse origin/main)\" = \"$(cat /workspace/remote_head)\" || { echo 'origin/main was not updated by fetch.'; exit 1; }; test \"$(git rev-parse main)\" = \"$(cat /workspace/local_before)\" || { echo 'fetch should not move local main.'; exit 1; }; test \"$(git rev-parse main)\" != \"$(git rev-parse origin/main)\" || { echo 'local main should remain behind origin/main.'; exit 1; }; test -z \"$(git status --porcelain)\" || { echo 'The working tree should remain unchanged.'; exit 1; }")
    case "git-rebase-feature":
      return gitFixture(code, "git init -q; printf 'base\\n' > app.txt; git add app.txt; git commit -qm 'Initial app'; git switch -q -c feature/search; printf 'search\\n' > search.txt; git add search.txt; git commit -qm 'Add search'; git switch -q main; printf 'main update\\n' > main.txt; git add main.txt; git commit -qm 'Update main'; git switch -q feature/search", "git merge-base --is-ancestor main feature/search || { echo 'feature/search is not rebased onto main.'; exit 1; }; grep -Fxq 'search' search.txt || { echo 'The feature change was not preserved.'; exit 1; }; test -z \"$(git rev-list --merges main..feature/search)\" || { echo 'The rebased feature history should be linear.'; exit 1; }")
    case "git-revert-push":
      return gitFixture(code, "cd /workspace; git init -q --bare remote.git; cd repo; git init -q; printf 'stable\\n' > app.txt; git add app.txt; git commit -qm 'Stable release'; git remote add origin /workspace/remote.git; git push -q -u origin main; printf 'debug=true\\n' > debug.txt; git add debug.txt; git commit -qm 'Bad debug change'; git push -q origin main; git rev-parse HEAD > /workspace/bad_sha", "test \"$(git rev-parse HEAD)\" != \"$(cat /workspace/bad_sha)\" || { echo 'A new revert commit should exist.'; exit 1; }; git merge-base --is-ancestor \"$(cat /workspace/bad_sha)\" HEAD || { echo 'The bad commit should remain in history rather than being rewritten away.'; exit 1; }; test ! -e debug.txt || { echo 'The revert should remove debug.txt.'; exit 1; }; test \"$(git rev-parse HEAD)\" = \"$(git --git-dir=/workspace/remote.git rev-parse refs/heads/main)\" || { echo 'origin/main does not match local main after push.'; exit 1; }")
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
