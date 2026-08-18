import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedOutput, evaluationResult, fixtureFor, validateRequest } from '../src/evaluator.mjs'

test('accepts bounded valid code submissions', () => assert.equal(validateRequest({ lessonSlug: 'python-functions', code: 'def greet(name): return name' }), null))

test('builds a Rust fixture with a pinned isolated runtime', () => { const fixture = fixtureFor('rust-hello-functions', 'fn greet(name: &str) -> String { format!("Hello, {name}") }'); assert.equal(fixture.runtime, 'rust'); assert.equal(fixture.tests, 2); assert.equal(evaluationResult(fixture, 0, 'PATHWAY_TEST_PASS').passed, true) })
test('rejects malformed and oversized submissions', () => { assert.match(validateRequest({}), /required/); assert.match(validateRequest({ lessonSlug: 'x', code: 'a'.repeat(50_001) }), /50,000/) })
test('builds fixtures and returns passing isolated test result', () => { const fixture = fixtureFor('python-functions', 'def greet(name): return name'); assert.equal(fixture.tests, 2); assert.equal(evaluationResult(fixture, 0, 'PATHWAY_TEST_PASS').passed, true) })
test('has isolated fixtures for every shipped code exercise', () => {
  for (const lessonSlug of ['foundations-making-decisions', 'modern-csharp-records', 'web-api-sealed-services', 'python-functions', 'python-fastapi-endpoint'])
    assert.ok(fixtureFor(lessonSlug, 'pass'))
})
test('bounds sandbox output', () => assert.match(boundedOutput('a'.repeat(4_001)), /output truncated/))
