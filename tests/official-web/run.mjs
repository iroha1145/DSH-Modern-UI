/** Official rc.4 configuration, provider lifecycle, and real tool-loop acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const script = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(script), '../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const cleanEnvironment = home => {
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
  for (const key of Object.keys(env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY)$/i.test(key)
    || /^(DSH_WEB_|DEEPSEEK_SEARCH_|DEEPSEEK_BASE_URL)/.test(key)) delete env[key]
  return env
}
async function child(node, args, env, cwd, log) {
  const process = spawn(node, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [process.stdout, process.stderr]) stream.on('data', bytes => { output += bytes })
  const timeout = setTimeout(() => process.kill(), 90000)
  const code = await new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', resolve) })
  clearTimeout(timeout)
  await writeFile(log, output.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
  assert.equal(code, 0, `Child failed (${code}); see ${log}`)
}

if (process.argv[2] !== '--worker') {
  const statePath = path.resolve(process.argv[2] ?? process.env.MODERN_UI_INSTALLED_STATE ?? '')
  assert.ok(process.argv[2] || process.env.MODERN_UI_INSTALLED_STATE, 'Pass an installed current.json')
  const original = await readFile(statePath)
  const installed = JSON.parse(original)
  const parent = path.join(root, '.artifacts/official-web')
  await mkdir(parent, { recursive: true })
  const run = await mkdtemp(path.join(parent, 'run-'))
  const home = path.join(run, 'home')
  const counts = { search: 0, fetch: 0, models: [] }
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/messages' && request.method === 'POST') {
      let data = ''; for await (const part of request) data += part
      const body = JSON.parse(data)
      counts.search++; counts.models.push(body.model)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.org/fixture', title: 'OFFICIAL_SEARCH_MARKER' }] },
        { type: 'text', text: 'Controlled source', citations: [{ url: 'https://example.org/fixture', cited_text: 'SEARCH_SNIPPET_MARKER' }] },
      ] }))
    } else if (request.url === '/page') {
      counts.fetch++
      response.setHeader('content-type', 'text/html')
      response.end('<html><body><h1>LOCAL_FETCH_MARKER</h1><p>Readable controlled content.</p></body></html>')
    } else { response.statusCode = 404; response.end('Not found') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}`
  const state = { node: installed.node, cli: installed.cli, plugin: process.env.MODERN_UI_PLUGIN_ENTRY
    ?? path.join(installed.plugin.path, 'lib/index.js'), installedIntegrity: installed.plugin.integrity,
    home, run, profile: 'official-web-fixture', endpoint }
  await writeFile(path.join(run, 'state.json'), JSON.stringify(state, null, 2))
  const { runtimeEnvironment } = await import(pathToFileURL(installed.manager).href)
  const env = { ...runtimeEnvironment(installed), ...cleanEnvironment(home) }
  env.PATH = runtimeEnvironment(installed).PATH
  const report = { run, statePath, official: state.cli, plugin: state.plugin, phases: [], counts, status: 'failed' }
  try {
    await child(state.node, [state.cli, state.profile, '--from-default-profile', 'web', '--dump-config'], env, run, path.join(run, 'initial-composition.txt'))
    // Install the packaged plugin into the fixture profile so its
    // declared host peers receive the same resolution scope as production.
    const fixtureProfile = path.join(home, 'profiles', state.profile)
    await child(state.node, [installed.pnpm, 'add', '--save-exact', '--ignore-scripts',
      path.join(installed.generation, 'modern-ui.tgz')], env, fixtureProfile, path.join(run, 'plugin-install.log'))
    const manifestPath = path.join(fixtureProfile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dsh.profile.bundles.push('@iroha1145/dsh-modern-ui')
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    state.plugin = path.join(home, 'profiles', state.profile, 'node_modules/@iroha1145/dsh-modern-ui/lib/index.js')
    assert.equal(hash(await readFile(state.plugin)), hash(await readFile(path.join(installed.plugin.path, 'lib/index.js'))))
    await writeFile(path.join(run, 'state.json'), JSON.stringify(state, null, 2))
    report.plugin = state.plugin
    const pluginRequire = createRequire(state.plugin)
    const hostRequire = createRequire(state.cli)
    const yaml = createRequire(hostRequire.resolve('@deepseek-ai/dsh-app-boot'))('js-yaml')
    const bundle = yaml.load(await readFile(pluginRequire.resolve('@iroha1145/dsh-modern-ui/cordis.patch.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA })
    const patch = [
      ...bundle.filter(row => row.disabled === true),
      { id: 'workspace-controller', config: { documentsDirectory: path.join(run, 'documents') } },
      { id: 'agent-default-model', config: { provider: 'official-web-fixture', model: 'counted' } },
      { id: 'modern-ui', config: { enabled: true, models: {}, prices: {} } },
    ]
    // JSON is YAML; this is initial scratch composition, not the tested configuration write path.
    await writeFile(path.join(home, 'profiles', state.profile, 'cordis.patch.yml'), JSON.stringify(patch, null, 2))
    for (const phase of ['configure', 'enabled', 'tools-disabled', 'provider-disabled', 'restored']) {
      const before = { search: counts.search, fetch: counts.fetch }
      await child(state.node, [script, '--worker', path.join(run, 'state.json'), phase], env, run, path.join(run, `${phase}.log`))
      const result = JSON.parse(await readFile(path.join(run, `${phase}.json`), 'utf8'))
      result.endpointDelta = { search: counts.search - before.search, fetch: counts.fetch - before.fetch }
      if (phase === 'enabled' || phase === 'restored') assert.deepEqual(result.endpointDelta, { search: 1, fetch: 1 })
      else if (phase === 'provider-disabled') assert.deepEqual(result.endpointDelta, { search: 0, fetch: 1 })
      else assert.equal(result.endpointDelta.search, 0)
      if (phase === 'tools-disabled' || phase === 'configure') assert.equal(result.endpointDelta.fetch, 0)
      report.phases.push(result)
    }
    assert.equal(hash(await readFile(statePath)), hash(original), 'Existing installation selection remains byte-identical')
    report.status = 'passed'
  } catch (error) { report.failure = error.stack; process.exitCode = 1 }
  finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await writeFile(path.join(run, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ status: report.status, result: path.join(run, 'result.json') }))
  }
} else {
  const state = JSON.parse(await readFile(process.argv[3], 'utf8'))
  const phase = process.argv[4]
  const require = createRequire(state.cli)
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const [{ runProfile }, { createLaunchEnvironmentSnapshot }, { LlmAdapter, ToolCallId }] = await Promise.all([
    load('@deepseek-ai/dsh/profile-boot'), load('@deepseek-ai/dsh-launch-environment'), load('@deepseek-ai/dsh-llm'),
  ])
  const report = { phase, version: require('@deepseek-ai/dsh/package.json').version, node: process.version, tools: [], mutations: [] }
  let shutdown, agent
  try {
    assert.equal(report.version, '0.2.1-rc.4')
    const boot = await runProfile({ profile: state.profile, args: ['--port', '0', '--no-open'], patchFiles: [],
      environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) })
    shutdown = boot.shutdown
    const ctx = boot.ctx
    const modern = ctx.configEditor.entries().find(entry => entry.options.id === 'modern-ui')
    assert.equal(modern?.fiber?.state, 2, 'Installed Modern Host entry must activate')
    report.modernEntry = { name: modern.options.name, phase: modern.fiber.state }
    const config = id => {
      const entry = ctx.configEditor.entries().find(entry => entry.options.id === id)
      assert.ok(entry, `Official profile exposes config entry ${id}`)
      return entry
    }
    const edit = async (id, change) => {
      await ctx.configEditor.edit(config(id), change)
      report.mutations.push({ api: 'configEditor.edit', entry: id })
    }
    const setTools = async enabled => edit('preset-standard', current => {
      const next = structuredClone(current)
      const tool = next.plugins.find(row => row.id === 'tool-web')
      assert.ok(tool, 'Use the existing official standard preset tool row')
      tool.config = { ...tool.config, search: enabled, fetch: enabled }
      return next
    })
    const setProvider = async enabled => {
      const row = (await ctx.pluginManager.listPlugins()).find(row => row.patchId === 'web-search-deepseek')
      assert.ok(row)
      const result = await ctx.pluginManager.setPluginEnabled(row.entryId, enabled)
      report.mutations.push({ api: 'pluginManager.setPluginEnabled', ...result })
      assert.ok(['applied', 'restart-required'].includes(result.application), JSON.stringify(result))
    }
    report.webRows = (await ctx.pluginManager.listPlugins()).filter(row => /dsh-(tool-web|web-fetch-http|web-search-deepseek)$/.test(row.moduleName))
    report.toolConfiguration = config('preset-standard').options.config.plugins.find(row => row.id === 'tool-web').config
    if (phase === 'configure') {
      await edit('web-search-deepseek', current => ({ ...current, apiKey: 'fixture-not-a-secret', baseURL: `${state.endpoint}/v1`, model: 'controlled-search-v1' }))
      await edit('web', current => ({ ...current, fetchProvider: 'local-fixture', searchProvider: 'deepseek-official' }))
      await setTools(true)
    } else {
      const disabled = phase === 'tools-disabled'
      assert.equal(report.toolConfiguration.search, !disabled)
      assert.equal(report.toolConfiguration.fetch, !disabled)
      const provider = report.webRows.find(row => row.patchId === 'web-search-deepseek')
      assert.equal(provider.enabled, phase !== 'provider-disabled')
      let step = 0
      const plan = disabled ? [] : [
        { name: 'web_search', arguments: { queries: ['controlled fixture'] } },
        { name: 'web_fetch', arguments: { url: `${state.endpoint}/page` } },
      ]
      class CountedAdapter extends LlmAdapter {
        async resolveModel(provider, id) { return { provider, id, name: id } }
        async *stream(options) {
          if (!options.tools?.length || step >= plan.length) {
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Controlled tools complete.' } }
            yield { type: 'finish', reason: { kind: 'stop' } }; return
          }
          const call = plan[step++]
          assert.ok(options.tools.some(tool => tool.name === call.name))
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`web-fixture-${step}`), name: call.name, arguments: JSON.stringify(call.arguments) } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        }
      }
      const fixture = ctx.plugin({ inject: ['llm', 'web', 'tools'], apply(scope) {
        scope.llm.registerAdapter(['official-web-fixture'], new CountedAdapter())
        scope.web.registerFetchProvider({ id: 'local-fixture', available: () => true, async fetch(request, signal) {
          assert.equal(request.url, `${state.endpoint}/page`)
          const response = await fetch(request.url, { signal })
          return { url: request.url, statusCode: response.status, body: { kind: 'html', content: await response.text() }, truncated: false }
        } })
        scope.on('tools/result', (exec, result) => {
          if (exec.agent === agent) report.tools.push({ name: exec.name, isError: result.isError, error: result.error, value: result.value, content: result.content })
        })
        scope.on('approval/request', (request, next) => request.agent === agent && ['web_search', 'web_fetch'].includes(request.toolName) ? 'allowed-once' : next())
      } })
      await fixture.await()
      const workspace = path.join(state.run, `workspace-${phase}`); await mkdir(workspace)
      const registered = await ctx.workspaceController.create({ path: workspace })
      const made = await ctx.sessionController.create({ workspaceId: registered.workspace.workspaceId, sessionId: `official-web-${randomUUID()}`, agentPreset: 'standard' })
      agent = ctx.agents.get(made.sessionId)
      report.session = made.sessionId
      report.schemas = ctx.tools.schemas(agent).map(tool => tool.name)
      for (const name of ['read', 'write']) assert.ok(report.schemas.includes(name), 'Unrelated official file tools remain composed')
      report.commands = ctx.commands.list(agent).map(command => command.name)
      assert.equal(report.commands.includes('web'), false, 'No removed Modern /web command is registered')
      for (const name of ['web_search', 'web_fetch']) assert.equal(report.schemas.includes(name), !disabled)
      const idle = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Agent did not finish')), 30000)
        const off = ctx.on('agent/status', event => { if (event.agent === agent && event.status === 'idle') { clearTimeout(timer); off(); resolve() } })
      })
      await ctx.sessionController.prompt({ sessionId: made.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Run the deterministic available web tools.' }] }, new AbortController().signal)
      await idle
      assert.equal(report.tools.length, plan.length)
      if (!disabled) {
        assert.equal(report.tools[1].isError, false)
        assert.match(JSON.stringify(report.tools[1]), /LOCAL_FETCH_MARKER/)
        if (phase === 'provider-disabled') {
          assert.equal(report.tools[0].isError, true)
          assert.match(JSON.stringify(report.tools[0]), /WEB_PROVIDER_CONFIGURED_MISSING/)
        } else {
          assert.equal(report.tools[0].isError, false)
          assert.match(JSON.stringify(report.tools[0]), /OFFICIAL_SEARCH_MARKER/)
          assert.match(JSON.stringify(report.tools[0]), /SEARCH_SNIPPET_MARKER/)
        }
      }
      const events = agent.session.snapshotEvents()
      report.eventTypes = [...new Set(events.map(event => event.type))]
      assert.equal(events.some(event => event.type === 'web/search'), false)
      assert.doesNotMatch(JSON.stringify(events), /\/web (?:on|off)|#web-off|modern-ui\/web-policy/)
      await writeFile(path.join(state.run, `${phase}-events.json`), JSON.stringify(events, null, 2))
      if (phase === 'enabled') await setTools(false)
      if (phase === 'tools-disabled') { await setTools(true); await setProvider(false) }
      if (phase === 'provider-disabled') await setProvider(true)
      if (phase === 'restored') {
        await edit('web', current => ({ ...current, fetchProvider: 'http' }))
        await assert.rejects(ctx.web.fetch({ url: `${state.endpoint}/page` }), error => {
          report.officialHttpLoopbackRejection = { code: error.code, message: error.message }
          return /BLOCKED|PRIVATE|UNSAFE/.test(error.code)
        })
      }
    }
    report.status = 'passed'
  } catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1 }
  finally {
    await writeFile(path.join(state.run, `${phase}.json`), JSON.stringify(report, null, 2))
    if (shutdown) await shutdown.shutdown(report.status === 'passed' ? 0 : 1)
  }
}

