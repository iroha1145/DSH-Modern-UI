/** Deterministic external MCP peer; no harness APIs or dependencies are replaced. */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const events = process.argv[2]
if (!events) throw new Error('An event log path is required')
const record = (event, extra = {}) => appendFileSync(events, JSON.stringify({ event, pid: process.pid, ...extra }) + '\n')
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const pending = new Set()
record('start')
const input = createInterface({ input: process.stdin })
input.on('line', line => {
  const request = JSON.parse(line)
  if (request.method === 'initialize') {
    record('initialize')
    send({
      id: request.id,
      result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'modern-compat-fixture', version: '1.0.0' } },
    })
  } else if (request.method === 'notifications/initialized') record('initialized')
  else if (request.method === 'tools/list') {
    record('discover')
    send({
      id: request.id,
      result: {
        tools: ['echo', 'failure', 'wait'].map(name => ({
          name,
          description: `Compatibility ${name}`,
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false },
        })),
      },
    })
  } else if (request.method === 'tools/call') {
    const name = request.params.name
    record('call', { name, requestId: request.id, arguments: request.params.arguments })
    if (name === 'wait') pending.add(request.id)
    else if (name === 'echo') send({ id: request.id, result: { content: [{ type: 'text', text: `echo:${request.params.arguments?.text ?? ''}` }] } })
    else if (name === 'failure') send({ id: request.id, result: { isError: true, content: [{ type: 'text', text: 'deterministic MCP failure' }] } })
    else send({ id: request.id, error: { code: -32602, message: 'Unknown fixture tool' } })
  } else if (request.method === 'notifications/cancelled') {
    const requestId = request.params.requestId
    record('cancelled', { requestId, pending: pending.delete(requestId) })
    send({ id: requestId, error: { code: -32800, message: 'Fixture request cancelled' } })
  } else if (request.method === 'ping') send({ id: request.id, result: {} })
  else if (request.id !== undefined) {
    record('unsupported-method', { method: request.method })
    send({ id: request.id, error: { code: -32601, message: 'Unsupported fixture method' } })
  }
})
input.on('close', () => {
  record('stdin-closed', { pending: pending.size })
  process.exit(0)
})
process.on('SIGTERM', () => {
  record('terminated', { pending: pending.size })
  process.exit(0)
})
