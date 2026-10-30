/** Installed test plugin: all services and lifecycle scopes come from the real CLI. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as mcp from '@iroha1145/dsh-modern-ui/mcp-client'

export const inject = ['tools', 'webServer', 'profileContext']
export function apply(ctx, config) {
  let busy = false
  let fiber
  const prefix = 'mcp__compat_stdio__'
  const events = async () => {
    try {
      return (await readFile(config.events, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await predicate()
      if (value) return value
      await delay(50)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }
  const alive = pid => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (error.code === 'ESRCH') return false
      throw error
    }
  }
  const attach = async () => {
    fiber = ctx.plugin(mcp, {
      transport: 'stdio',
      serverName: 'compat_stdio',
      command: process.execPath,
      args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url)), config.events],
      failOnStartupError: true,
      reconnect: { enabled: false },
      toolCallTimeoutMs: 10_000,
    })
    await fiber.await()
  }
  const detach = async () => {
    if (fiber) {
      const current = fiber
      fiber = undefined
      await current.dispose()
    }
  }
  ctx.on('dispose', detach)
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/compat-mcp/check',
    handler: async (_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (busy) {
        response.statusCode = 409
        response.end(JSON.stringify({ error: 'MCP check already running' }))
        return
      }
      busy = true
      const results = []
      try {
        const local = createRequire(import.meta.url)
        const host = createRequire(ctx.profileContext.installAnchor)
        const modulePaths = Object.fromEntries(
          ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools'].map(name => {
            assert.equal(local(name), host(name), `shared ${name} identity`)
            return [name, { local: local.resolve(name), host: host.resolve(name), shared: true }]
          }),
        )
        await attach()
        const schemas = ctx.tools.schemas().filter(row => row.name.startsWith(prefix))
        assert.deepEqual(schemas.map(row => row.name).sort(), ['echo', 'failure', 'wait'].map(name => prefix + name).sort())
        const firstPid = (await events()).filter(row => row.event === 'start').at(-1).pid
        results.push({ name: 'discovery', passed: true, tools: schemas.map(row => row.name) })
        const execute = (name, signal = new AbortController().signal) =>
          ctx.tools.execute({ callId: `compat-${name}-${Date.now()}`, name: prefix + name, arguments: { text: 'retained value' }, signal })
        const success = await execute('echo')
        assert.equal(success.isError, false)
        assert.ok(success.content.some(block => block.type === 'text' && block.text === 'echo:retained value'))
        results.push({ name: 'call', passed: true })
        const failure = await execute('failure')
        assert.equal(failure.isError, true)
        assert.match(JSON.stringify(failure.content), /deterministic MCP failure/)
        results.push({ name: 'error', passed: true, code: failure.code })
        const controller = new AbortController()
        const pending = execute('wait', controller.signal)
        await waitFor(async () => (await events()).find(row => row.pid === firstPid && row.event === 'call' && row.name === 'wait'), 'upstream pending call')
        controller.abort(new Error('compatibility cancellation'))
        const cancelled = await pending
        assert.equal(cancelled.isError, true)
        await waitFor(
          async () => (await events()).find(row => row.pid === firstPid && row.event === 'cancelled' && row.pending === true),
          'upstream cancellation notification',
        )
        results.push({ name: 'cancellation', passed: true, code: cancelled.code })
        await detach()
        await waitFor(() => !alive(firstPid), 'stdio process exit after unload')
        assert.equal(ctx.tools.get(prefix + 'echo'), undefined)
        assert.equal(ctx.tools.schemas().filter(row => row.name.startsWith(prefix)).length, 0)
        const calls = (await events()).filter(row => row.event === 'call').length
        const removed = await execute('echo')
        assert.equal(removed.isError, true)
        assert.equal((await events()).filter(row => row.event === 'call').length, calls)
        results.push({ name: 'unload', passed: true, processExited: true, toolsRemoved: true })
        await attach()
        const secondPid = (await events()).filter(row => row.event === 'start').at(-1).pid
        assert.equal(ctx.tools.schemas().filter(row => row.name.startsWith(prefix)).length, 3)
        assert.equal((await execute('echo')).isError, false)
        await detach()
        await waitFor(() => !alive(secondPid), 'second stdio process exit')
        assert.equal(ctx.tools.schemas().filter(row => row.name.startsWith(prefix)).length, 0)
        results.push({ name: 'reload-without-duplicate-registration', passed: true })
        response.end(
          JSON.stringify({
            passed: true,
            profile: ctx.profileContext.name,
            officialVersion: host('@deepseek-ai/dsh/package.json').version,
            modernMcpEntry: local.resolve('@iroha1145/dsh-modern-ui/mcp-client'),
            modulePaths,
            results,
          }),
        )
      } catch (error) {
        response.statusCode = 500
        response.end(JSON.stringify({ passed: false, error: error.message, results }))
      } finally {
        await detach()
        busy = false
      }
    },
  })
}
