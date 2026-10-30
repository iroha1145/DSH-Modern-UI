import { test } from 'vitest'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CotTranslationController from '@deepseek-ai/dsh-experimental-client-ui-cot-translation'
import OfficialTranslator, { TranslationError } from '@deepseek-ai/dsh-experimental-translator'
import Llm from '@deepseek-ai/dsh-llm'
import SessionStore, { pluginRecordOf } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Typert from '@deepseek-ai/dsh-typert-registry'
import * as ModernMcp from '../../packages/modern-ui/lib/mcp-client.js'
import ModernTranslator from '../../packages/modern-ui/lib/translator.js'

// Behavior baseline for the two Host replacements (docs/host-compat.md). The official rc.4 translator
// accepts blank output and the official MCP client follows redirects; the replacements must not.
// These load the built entries in packages/modern-ui/lib, so run `npm run build` first.

async function listen(handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}/mcp` }
}
async function close(server) {
  server.closeAllConnections()
  await new Promise((accept, reject) => server.close(error => (error ? reject(error) : accept())))
}
function replyTranslation(response, provider, text) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(provider === 'google' ? [[[text, 'Original paragraph', null, null]], null, 'en'] : [{ translations: [{ text, to: 'zh-Hans' }] }]))
}

test('official translation controller recognizes Modern errors and activates a cold session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'modern-cold-translation-'))
  const ctx = new Context()
  let activations = 0
  try {
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(JsonlPersistence, { root, compression: 'none' }).await()
    const writer = await ctx.sessionPersistence.create({ version: 4, id: 'cold', createdAt: 1, isSeeded: false })
    await writer.flush()
    await writer.close()
    await ctx.plugin(ModernTranslator).await()
    const request = { text: 'uncached reasoning', provider: 'bing', sessionId: 'cold', targetLanguage: 'zh' }
    await assert.rejects(
      ctx.translator.translate(ctx.translator.resolve(request)),
      error => error instanceof TranslationError && error.code === 'TRANSLATION_SESSION_INACTIVE',
    )
    await ctx.plugin(Typert).await()
    ctx.provide('sessionController', {
      async resolveAgent() {
        activations++
        throw new Error('Fixture stops after observing official activation, before any external translation')
      },
    })
    await ctx.plugin(CotTranslationController, { provider: 'bing', targetLanguage: 'zh' }).await()
    await assert.rejects(ctx.cotTranslation.translate(request, new AbortController().signal))
    assert.equal(activations, 1)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

for (const provider of ['google', 'bing']) {
  test(`replacement translator rejects blank ${provider}, preserves valid text and retries`, async () => {
    let text = ''
    const endpoint = await listen((request, response) => {
      request.resume()
      replyTranslation(response, provider, text)
    })
    const ctx = new Context()
    try {
      await ctx.plugin(ModernTranslator, { googleEndpoint: endpoint.url, bingEndpoint: endpoint.url }).await()
      const spec = ctx.translator.resolve({ text: 'Original paragraph', targetLanguage: 'zh', provider })
      for (const blank of ['', ' \n\t ']) {
        text = blank
        await assert.rejects(ctx.translator.translate(spec), { code: 'TRANSLATION_INVALID_RESPONSE' })
      }
      text = '  译文\n'
      assert.equal(await ctx.translator.translate(spec), text)
    } finally {
      await ctx.fiber.dispose()
      await close(endpoint.server)
    }
  })

  test(`replacement translator repairs legacy ${provider} blank cache without rewriting old events`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'modern-host-storage-'))
    let text = ' \n '
    let requests = 0
    const endpoint = await listen((request, response) => {
      requests++
      request.resume()
      replyTranslation(response, provider, text)
    })
    const config = { googleEndpoint: endpoint.url, bingEndpoint: endpoint.url }
    let ctx
    let handle
    const start = async Translator => {
      ctx = new Context()
      for (const plugin of [Llm, SessionStore, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin).await()
      await ctx.plugin(JsonlPersistence, { root, compression: 'none' }).await()
      await ctx.plugin(AgentLoop, { agents: [] }).await()
      await ctx.plugin(Translator, config).await()
    }
    const events = async () => {
      const reader = await ctx.sessionPersistence.open('cache-fixture', 'read')
      try {
        return (await reader.read()).events
      } finally {
        await reader.close()
      }
    }
    const results = list => list.filter(event => pluginRecordOf(event)?.type === 'plugin:translator/result').length
    try {
      // The official translator is the control: it caches the blank result this replacement repairs.
      await start(OfficialTranslator)
      handle = await ctx.agents.create({ sessionId: 'cache-fixture' })
      const original = handle.agent.session
      await ctx.sessions.flush(original)
      const request = { text: 'Original paragraph', provider, targetLanguage: 'zh', sessionId: original.id }
      assert.equal(await ctx.translator.translate(ctx.translator.resolve(request)), text)
      const originalEvents = await events()
      assert.equal(results(originalEvents), 1)
      await handle.dispose()
      handle = undefined
      await ctx.fiber.dispose()
      ctx = undefined
      const file = (await readdir(root, { recursive: true })).find(name => name.endsWith('session.v4.jsonl'))
      assert.ok(file)
      const oldBytes = await readFile(path.join(root, file))

      text = 'Recovered translation'
      await start(ModernTranslator)
      handle = await ctx.agents.resume({ resumeSessionId: 'cache-fixture' })
      assert.equal(await ctx.translator.translate(ctx.translator.resolve(request)), text)
      assert.equal(await ctx.translator.translate(ctx.translator.resolve(request)), text)
      assert.equal(requests, 2)
      const updated = await events()
      assert.deepEqual(updated.slice(0, originalEvents.length), originalEvents)
      assert.equal(results(updated), 2)
      const newBytes = await readFile(path.join(root, file))
      assert.deepEqual(newBytes.subarray(0, oldBytes.length), oldBytes)
      await handle.dispose()
      handle = undefined
      await ctx.fiber.dispose()
      ctx = undefined

      await start(ModernTranslator)
      assert.equal(await ctx.translator.translate(ctx.translator.resolve(request)), text)
      assert.equal(requests, 2, 'restart must reuse the valid durable result')
    } finally {
      try {
        await handle?.dispose()
      } finally {
        try {
          await ctx?.fiber.dispose()
        } finally {
          await close(endpoint.server)
          await rm(root, { recursive: true, force: true })
        }
      }
    }
  })
}

for (const status of [0, 307, 308]) {
  for (const sameOrigin of status === 0 ? [true] : [true, false]) {
    test(`replacement MCP transport ${status || 'direct'} sameOrigin=${sameOrigin}`, async () => {
      let targetRequests = 0
      const respond = (request, response) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', chunk => {
          body += chunk
        })
        request.on('end', () => {
          targetRequests++
          const message = body ? JSON.parse(body) : {}
          if (message.id === undefined) {
            response.writeHead(202).end()
            return
          }
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result:
                message.method === 'initialize'
                  ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'host-fixture', version: '1' } }
                  : { tools: [] },
            }),
          )
        })
      }
      const target = await listen(respond)
      const origin = await listen((request, response) => {
        if (status === 0 || request.url === '/target') {
          respond(request, response)
          return
        }
        request.resume()
        response.writeHead(status, { location: sameOrigin ? origin.url.replace('/mcp', '/target') : target.url }).end()
      })
      const ctx = new Context()
      try {
        await ctx.plugin(Prompt).await()
        await ctx.plugin(Tools).await()
        const plugin = ctx.plugin(ModernMcp, {
          transport: 'streamable-http',
          serverName: 'host-fixture',
          url: origin.url,
          headers: { 'X-Fixture-Secret': 'synthetic-only' },
          failOnStartupError: true,
          reconnect: { enabled: false },
        })
        if (status === 0) {
          await plugin.await()
          assert.ok(targetRequests > 0)
        } else {
          await assert.rejects(plugin.await(), /initial connection or tool synchronization failed/)
          assert.equal(targetRequests, 0, 'redirect target must receive neither request body nor synthetic credential')
        }
      } finally {
        await ctx.fiber.dispose()
        await Promise.all([close(origin.server), close(target.server)])
      }
    })
  }
}
