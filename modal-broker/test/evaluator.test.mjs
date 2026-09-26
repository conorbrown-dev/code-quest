import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedOutput, evaluationResult, fixtureFor, hookInputFor, hookMatcherMatches, interpretHookResult, validateHookRequest, validateRequest } from '../src/evaluator.mjs'

test('accepts bounded valid code submissions', () => assert.equal(validateRequest({ lessonSlug: 'python-functions', code: 'def greet(name): return name' }), null))

test('builds a Rust fixture with a pinned isolated runtime', () => { const fixture = fixtureFor('rust-hello-functions', 'fn greet(name: &str) -> String { format!("Hello, {name}") }'); assert.equal(fixture.runtime, 'rust'); assert.equal(fixture.tests, 2); assert.equal(evaluationResult(fixture, 0, 'PATHWAY_TEST_PASS').passed, true) })
test('rejects malformed and oversized submissions', () => { assert.match(validateRequest({}), /required/); assert.match(validateRequest({ lessonSlug: 'x', code: 'a'.repeat(50_001) }), /50,000/) })
test('builds fixtures and returns passing isolated test result', () => { const fixture = fixtureFor('python-functions', 'def greet(name): return name'); assert.equal(fixture.tests, 2); assert.equal(evaluationResult(fixture, 0, 'PATHWAY_TEST_PASS').passed, true) })
test('has isolated fixtures for every shipped code exercise', () => {
  for (const lessonSlug of ['foundations-making-decisions', 'modern-csharp-records', 'web-api-sealed-services', 'python-functions', 'python-fastapi-endpoint'])
    assert.ok(fixtureFor(lessonSlug, 'pass'))
})

test('has isolated TypeScript fixtures for every React coding exercise', () => {
  const lessons = [
    'react-composition-root',
    'react-props-composition',
    'react-use-state',
    'react-use-reducer',
    'react-effects-synchronization',
    'react-context-provider-boundaries',
    'react-actions-optimistic-use',
    'react-router-data-mode',
    'react-router-loaders-params-search',
    'react-router-actions-navigation',
    'react-api-client-boundary',
    'react-tailwind-design-system',
    'react-testing-vitest-rtl',
    'react-enterprise-capstone',
  ]
  for (const lessonSlug of lessons) {
    const fixture = fixtureFor(lessonSlug, 'export const value = 1')
    assert.ok(fixture, `missing fixture for ${lessonSlug}`)
    assert.equal(fixture.runtime, 'react')
    assert.equal(fixture.tests, 2)
    assert.match(fixture.command.join(' '), /tsc/)
    assert.ok(fixture.files['react-stubs.d.ts'])
  }
})

test('has isolated TypeScript fixtures for every React Lite coding exercise', () => {
  const lessons = [
    'react-lite-jsx-rendering',
    'react-lite-components-props',
    'react-lite-state',
    'react-lite-forms',
    'react-lite-router-pages',
    'react-lite-layout-nav',
    'react-lite-table-filter-sort',
    'react-lite-dummy-api-read',
    'react-lite-router-loader',
    'react-lite-dummy-api-write',
    'react-lite-router-action-crud',
    'react-lite-basic-testing',
    'react-lite-capstone',
  ]
  for (const lessonSlug of lessons) {
    const fixture = fixtureFor(lessonSlug, 'export const value = 1')
    assert.ok(fixture, `missing fixture for ${lessonSlug}`)
    assert.equal(fixture.runtime, 'react')
    assert.equal(fixture.tests, 2)
    assert.match(fixture.command.join(' '), /tsc/)
  }
})

test('has isolated Git fixtures for the full CLI course', () => {
  const lessons = [
    'git-init-status', 'git-stage-files', 'git-first-commit', 'git-history-diff',
    'git-switch-branch', 'git-feature-commit', 'git-merge-feature', 'git-resolve-conflict',
    'git-restore-reset', 'git-ignore-generated-files', 'git-fetch-remote',
    'git-rebase-feature', 'git-revert-push',
  ]
  for (const lessonSlug of lessons) {
    const fixture = fixtureFor(lessonSlug, 'git status')
    assert.ok(fixture, `missing fixture for ${lessonSlug}`)
    assert.equal(fixture.runtime, 'git')
    assert.equal(fixture.tests, 3)
    assert.match(fixture.files['exercise.sh'], /PATHWAY_TEST_PASS/)
  }
})
test('bounds sandbox output', () => assert.match(boundedOutput('a'.repeat(4_001)), /output truncated/))


test('validates and matches Claude PreToolUse hook requests', () => {
  const payload = { event: 'PreToolUse', matcher: 'Bash', script: 'exit 0', command: 'npm test' }
  assert.equal(validateHookRequest(payload), null)
  assert.equal(hookMatcherMatches('Bash', 'Bash'), true)
  assert.equal(hookMatcherMatches('Edit|Write', 'Bash'), false)
})

test('interprets a structured deny decision from a Claude hook', () => {
  const inputJson = JSON.stringify(hookInputFor('rm -rf /tmp/build'))
  const stdout = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Destructive command blocked by hook',
    },
  })
  const result = interpretHookResult(inputJson, true, 0, stdout, '')
  assert.equal(result.outcome, 'denied')
  assert.equal(result.reason, 'Destructive command blocked by hook')
  assert.equal(result.executed, true)
})

test('interprets silent exit zero as no hook decision', () => {
  const inputJson = JSON.stringify(hookInputFor('npm test'))
  const result = interpretHookResult(inputJson, true, 0, '', '')
  assert.equal(result.outcome, 'no_decision')
})
