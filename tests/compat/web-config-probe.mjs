/** Real CLI plugin using public configuration, session, tool, and provider APIs. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const inject = ['configEditor', 'pluginManager', 'web', 'tools', 'workspaceController', 'sessionController', 'agents', 'commands', 'webServer']
export function apply(ctx, config) {
  let agent
  ctx.on('approval/request', (request, next) => (request.agent === agent && ['web_search', 'web_fetch'].includes(request.toolName) ? 'allowed-once' : next()))
  const entry = id => {
    const value = ctx.configEditor.entries().find(row => row.options.id === id)
    assert.ok(value, `Official profile entry ${id} must exist`)
    return value
  }
  const edit = (id, action) => ctx.configEditor.edit(entry(id), action)
  const toolsConfig = () => entry('preset-standard').options.config.plugins.find(row => row.id === 'tool-web').config
  const setTools = enabled =>
    edit('preset-standard', current => {
      const value = structuredClone(current)
      const tool = value.plugins.find(row => row.id === 'tool-web')
      assert.ok(tool, 'Official standard preset must own the web tool configuration')
      tool.config = { ...tool.config, search: enabled, fetch: enabled }
      return value
    })
  const setProvider = async enabled => {
    const provider = (await ctx.pluginManager.listPlugins()).find(row => row.patchId === 'web-search-deepseek')
    assert.ok(provider)
    const result = await ctx.pluginManager.setPluginEnabled(provider.entryId, enabled)
    assert.ok(['applied', 'restart-required'].includes(result.application))
    return { api: 'pluginManager.setPluginEnabled', application: result.application, enabled }
  }
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/compat-web-config/check',
    handler: async (request, response) => {
      response.setHeader('Content-Type', 'application/json')
      const phase = new URL(request.url, 'http://localhost').searchParams.get('phase')
      try {
        assert.ok(['configure', 'enabled', 'disabled', 'provider-disabled', 'restored'].includes(phase))
        const report = { phase, passed: false, mutations: [] }
        if (phase === 'configure') {
          await edit('web-search-deepseek', current => ({
            ...current,
            apiKey: 'fixture-not-a-secret',
            baseURL: `${config.endpoint}/v1`,
            model: 'controlled-search',
          }))
          await edit('web', current => ({ ...current, searchProvider: 'deepseek-official', fetchProvider: 'http' }))
          await setTools(true)
          report.mutations.push({ api: 'configEditor.edit', entries: ['web-search-deepseek', 'web', 'preset-standard'] })
        } else {
          const enabled = phase !== 'disabled'
          assert.equal(toolsConfig().search, enabled)
          assert.equal(toolsConfig().fetch, enabled)
          report.configuration = toolsConfig()
          const workspace = join(config.workspace, phase)
          await mkdir(workspace, { recursive: true })
          const registered = await ctx.workspaceController.create({ path: workspace })
          const made = await ctx.sessionController.create({
            workspaceId: registered.workspace.workspaceId,
            sessionId: `compat-web-${randomUUID()}`,
            agentPreset: 'standard',
          })
          agent = ctx.agents.get(made.sessionId)
          assert.ok(agent)
          report.schemas = ctx.tools.schemas(agent).map(row => row.name)
          for (const name of ['web_search', 'web_fetch']) assert.equal(report.schemas.includes(name), enabled)
          for (const name of ['read', 'write']) assert.ok(report.schemas.includes(name))
          assert.equal(
            ctx.commands.list(agent).some(row => row.name === 'web'),
            false,
          )
          report.commandsHaveNoRetiredWebSwitch = true
          if (enabled) {
            const invoke = (name, args) =>
              ctx.tools.execute({ callId: `compat-web-${randomUUID()}`, name, arguments: args, agent, signal: new AbortController().signal })
            const search = await invoke('web_search', { queries: ['controlled fixture'] })
            assert.equal(search.isError, phase === 'provider-disabled')
            assert.match(JSON.stringify(search), phase === 'provider-disabled' ? /WEB_PROVIDER_CONFIGURED_MISSING/ : /CONTROLLED_SEARCH_MARKER/)
            const fetchResult = await invoke('web_fetch', { url: `${config.endpoint}/page` })
            assert.equal(fetchResult.isError, true)
            assert.match(JSON.stringify(fetchResult), /BLOCKED|PRIVATE|UNSAFE/)
            report.search = { isError: search.isError, content: search.content }
            report.loopbackFetchRejected = { isError: fetchResult.isError, content: fetchResult.content }
          }
          if (phase === 'enabled') {
            await setTools(false)
            report.mutations.push({ api: 'configEditor.edit', entry: 'preset-standard', enabled: false })
          }
          if (phase === 'disabled') {
            await setTools(true)
            report.mutations.push(await setProvider(false))
          }
          if (phase === 'provider-disabled') report.mutations.push(await setProvider(true))
        }
        report.passed = true
        response.end(JSON.stringify(report))
      } catch (error) {
        response.statusCode = 500
        response.end(JSON.stringify({ phase, passed: false, error: error.message, stack: error.stack }))
      }
    },
  })
}
