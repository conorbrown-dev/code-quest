import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedOutput, evaluationResult, fixtureFor, validateRequest } from '../src/evaluator.mjs'

test('accepts bounded valid code submissions', () => assert.equal(validateRequest({ lessonSlug: 'python-functions', code: 'def greet(name): return name' }), null))
test('rejects malformed and oversized submissions', () => { assert.match(validateRequest({}), /required/); assert.match(validateRequest({ lessonSlug: 'x', code: 'a'.repeat(50_001) }), /50,000/) })
test('builds fixtures and returns passing isolated test result', () => { const fixture = fixtureFor('python-functions', 'def greet(name): return name'); assert.equal(fixture.tests, 2); assert.equal(evaluationResult(fixture, 0, 'PATHWAY_TEST_PASS').passed, true) })
test('bounds sandbox output', () => assert.match(boundedOutput('a'.repeat(4_001)), /output truncated/))
