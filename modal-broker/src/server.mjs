import http from 'node:http'
import crypto from 'node:crypto'
import { ModalClient } from 'modal'
import { boundedOutput, evaluationResult, fixtureFor, validateRequest } from './evaluator.mjs'

const port = Number(process.env.PORT ?? 8080)
const sharedSecret = process.env.RUNNER_SHARED_SECRET
const modalTokenId = process.env.MODAL_TOKEN_ID
const modalTokenSecret = process.env.MODAL_TOKEN_SECRET
const configured = Boolean(sharedSecret && modalTokenId && modalTokenSecret)
const client = configured ? new ModalClient({ tokenId: modalTokenId, tokenSecret: modalTokenSecret }) : null

function reply(response, status, value) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
function isAuthorized(request) {
  const supplied = request.headers['x-pathway-runner-key']
  if (!sharedSecret || typeof supplied !== 'string') return false
  const left = Buffer.from(sharedSecret)
  const right = Buffer.from(supplied)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}
async function readBody(request) {
  const parts = []; let size = 0
  for await (const part of request) { size += part.length; if (size > 60_000) throw new Error('Request too large.'); parts.push(part) }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}
async function evaluate(payload) {
  const fixture = fixtureFor(payload.lessonSlug, payload.code)
  if (!fixture) return { passed: false, passingTests: 0, totalTests: 0, feedback: 'This exercise has no isolated test fixture yet.', nextLessonSlug: null }
  const app = await client.apps.fromName('code-quest-evaluator', { createIfMissing: true })
  const image = modalImage(client)
  const sandbox = await client.sandboxes.create(app, image, { command: ['sleep', 'infinity'], workdir: '/workspace', cpu: 0.5, cpuLimit: 0.5, memoryMiB: 512, memoryLimitMiB: 512, timeoutMs: 20_000, idleTimeoutMs: 20_000, blockNetwork: true })
  try {
    for (const [path, content] of Object.entries(fixture.files)) await sandbox.filesystem.writeText(content, `/workspace/${path}`)
    const process = await sandbox.exec(fixture.command, { timeoutMs: 12_000 })
    const [stdout, stderr, exitCode] = await Promise.all([process.stdout.readText(), process.stderr.readText(), process.wait()])
    return evaluationResult(fixture, exitCode, boundedOutput(stdout, stderr))
  } finally { await sandbox.terminate().catch(() => undefined); sandbox.detach() }
}
function modalImage(modal) {
  return modal.images.fromRegistry('mcr.microsoft.com/dotnet/sdk:10.0').dockerfileCommands(['RUN apt-get update && apt-get install -y --no-install-recommends python3 coreutils && rm -rf /var/lib/apt/lists/*'])
}

http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return reply(response, configured ? 200 : 503, { status: configured ? 'ok' : 'misconfigured', provider: 'modal' })
  if (request.method !== 'POST' || request.url !== '/evaluate') return reply(response, 404, { message: 'Not found.' })
  if (!isAuthorized(request)) return reply(response, 401, { message: 'Unauthorized.' })
  try { const payload = await readBody(request); const issue = validateRequest(payload); if (issue) return reply(response, 400, { message: issue }); return reply(response, 200, await evaluate(payload)) }
  catch (error) { console.error('Modal sandbox evaluation failed.', error); return reply(response, 503, { message: 'The isolated evaluator is temporarily unavailable.' }) }
}).listen(port, '0.0.0.0', () => console.log(`Modal evaluator broker listening on ${port}`))
