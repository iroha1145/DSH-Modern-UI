// Inspect Host behavior through public exports of an installed official release.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'

const consumer = resolve(process.argv[2])
const output = process.argv[3]
const require = createRequire(resolve(consumer, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const [{ Context }, { default: Translator }, { default: Tools }, mcp, { default: Prompt }] = await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-experimental-translator',
  '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-system-prompt',
].map(load))
const result = {
  officialVersion: require('@deepseek-ai/dsh/package.json').version,
  officialEntry: require.resolve('@deepseek-ai/dsh/profile-boot'),
  node: process.version,
  scenarios: [],
}
assert.equal(result.officialVersion, '0.2.1-rc.4')

async function listen(handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}/mcp` }
}
async function close(server) {
  server.closeAllConnections()
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()))
}

for (const provider of ['google', 'bing']) {
  let translated = ''
  const endpoint = await listen((request, response) => {
    request.resume()
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(provider === 'google'
      ? [[[translated, 'Original reasoning', null, null]], null, 'en']
      : [{ translations: [{ text: translated, to: 'zh-Hans' }] }]))
  })
  const ctx = new Context()
  try {
    await ctx.plugin(Translator, { googleEndpoint: endpoint.url, bingEndpoint: endpoint.url }).await()
    const spec = ctx.translator.resolve({ text: 'Original reasoning', targetLanguage: 'zh', provider })
    for (const blank of ['', ' \t\r\n ']) {
      translated = blank
      try {
        const text = await ctx.translator.translate(spec)
        result.scenarios.push({ name: 'translation-blank-output', provider, rejected: false, returned: text })
      } catch (error) {
        result.scenarios.push({ name: 'translation-blank-output', provider, rejected: true, code: error.code, message: error.message })
      }
    }
    translated = '  译文\n'
    assert.equal(await ctx.translator.translate(spec), translated)
    result.scenarios.push({ name: 'translation-valid-output', provider, preserved: true })
  } finally {
    await ctx.fiber.dispose()
    await close(endpoint.server)
  }
}

for (const status of [0, 307, 308]) {
  for (const sameOrigin of status === 0 ? [true] : [true, false]) {
    let targetRequests = 0
    let targetHeader = false
    let targetBody = false
    const respond = (request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        targetRequests++
        targetHeader ||= request.headers['x-fixture-secret'] === 'synthetic-secret'
        targetBody ||= body.includes('initialize')
        const message = body ? JSON.parse(body) : {}
        if (message.id === undefined) { response.writeHead(202).end(); return }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize'
          ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'loopback-fixture', version: '1' } }
          : { tools: [] } }))
      })
    }
    const target = await listen(respond)
    const origin = await listen((request, response) => {
      if (status === 0 || request.url === '/target') { respond(request, response); return }
      request.resume()
      response.writeHead(status, { location: sameOrigin ? origin.url.replace('/mcp', '/target') : target.url }).end()
    })
    const ctx = new Context()
    let rejected = false
    let errorMessage
    try {
      await ctx.plugin(Prompt).await()
      await ctx.plugin(Tools).await()
      try {
        await ctx.plugin(mcp, { transport: 'streamable-http', serverName: 'redirect-probe', url: origin.url,
          headers: { 'X-Fixture-Secret': 'synthetic-secret' }, failOnStartupError: true,
          toolCallTimeoutMs: 1500, reconnect: { enabled: false } }).await()
      } catch (error) { rejected = true; errorMessage = error.message }
      result.scenarios.push({ name: 'mcp-http-redirect', status, sameOrigin, rejected, targetRequests, targetHeader, targetBody, errorMessage })
      if (status === 0) assert.ok(targetRequests > 0, `direct endpoint must receive official MCP requests: ${errorMessage}`)
    } finally {
      await ctx.fiber.dispose()
      await Promise.all([close(origin.server), close(target.server)])
    }
  }
}
const json = JSON.stringify(result, null, 2) + '\n'
if (output) await writeFile(resolve(output), json)
process.stdout.write(json)
