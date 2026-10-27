/** Real installed Host/agent/tool consumption. Only the new scratch Workspace is written. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { isolatedInstalledFixture } from './fixtures/e2e-environment.mjs'

const script = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(script), '../..')
if (process.argv[2] !== '--worker') {
  const statePath = process.env.MODERN_UI_INSTALLED_STATE ?? process.argv[2]
  assert.ok(statePath, 'Pass an installed current.json path or MODERN_UI_INSTALLED_STATE')
  const source = JSON.parse(await readFile(statePath, 'utf8'))
  const artifacts = path.join(process.env.MODERN_UI_E2E_ARTIFACTS ?? path.join(root, '.artifacts'), 'runtime-tools')
  await mkdir(artifacts, { recursive: true })
  const run = await mkdtemp(path.join(artifacts, 'run-'))
  const isolation = await isolatedInstalledFixture(source, run)
  const state = isolation.state
  const isolatedStatePath = path.join(run, 'current.json')
  await writeFile(isolatedStatePath, JSON.stringify({ cli: state.cli, profile: state.profile, powershell: state.powershell ? { path: state.powershell.path } : undefined }))
  const environment = isolation.environment
  for (const key of Object.keys(environment)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY)$/i.test(key)) delete environment[key]
  const child = spawn(state.node, [script, '--worker', isolatedStatePath, run], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { diagnostics += data })
  const timeout = setTimeout(() => child.kill(), 90000)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  clearTimeout(timeout)
  await isolation.verifySource()
  await writeFile(path.join(run, 'diagnostics.txt'), diagnostics.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
  console.log(JSON.stringify({ run, exit: code, result: path.join(run, 'result.json') }))
  assert.equal(code, 0, `Tool consumption failed; inspect ${path.join(run, 'result.json')}`)
  assert.equal(JSON.parse(await readFile(path.join(run, 'result.json'), 'utf8')).status, 'passed')
} else {
  const state = JSON.parse(await readFile(process.argv[3], 'utf8'))
  const run = process.argv[4]
  const workspace = path.join(run, 'workspace')
  await mkdir(workspace)
  const officialRequire = createRequire(state.cli)
  const load = name => import(pathToFileURL(officialRequire.resolve(name)).href)
  const [{ runProfile }, { createLaunchEnvironmentSnapshot }, { LlmAdapter, ToolCallId }] = await Promise.all([
    load('@deepseek-ai/dsh/profile-boot'), load('@deepseek-ai/dsh-launch-environment'), load('@deepseek-ai/dsh-llm'),
  ])
  const overlay = path.join(run, 'fixture.patch.yml')
  await writeFile(overlay, '- id: agent-default-model\n  config:\n    provider: runtime-tools-fixture\n    model: counted\n')
  const report = { host: officialRequire('@deepseek-ai/dsh/package.json').version, node: process.version,
    os: process.platform, cpu: process.arch, official: state.cli, profile: state.profile,
    workspace, run, launchPath: process.env.PATH, declaredPrivatePowerShell: state.powershell?.path,
    modelCalls: 0, tools: [], approvals: [], schemas: [], passed: [] }
  let shutdown, agent
  try {
    const boot = await runProfile({ profile: state.profile, args: ['--port', '0', '--no-open'], patchFiles: [overlay],
      environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) })
    shutdown = boot.shutdown
    const ctx = boot.ctx
    const marker = 'DSH_FILE_TOOL_OK'
    const shellMarker = 'DSH_PWSH_TOOL_OK'
    const plan = [
      { name: 'write', arguments: { file_path: 'file-marker.txt', content: marker } },
      { name: 'read', arguments: { file_path: 'file-marker.txt' } },
      { name: 'pwsh', arguments: { description: 'Write and verify the scratch PowerShell marker', command: "Set-Content -LiteralPath './shell-marker.txt' -Value 'DSH_PWSH_TOOL_OK' -NoNewline; Write-Output 'DSH_PWSH_TOOL_OK'; Write-Output ('DSH_PWSH_EXECUTABLE=' + (Get-Process -Id $PID).Path); Write-Output ('DSH_PWSH_PID=' + $PID)", timeoutMs: 10000 } },
      { name: 'read', arguments: { file_path: 'shell-marker.txt' } },
    ].map((step, index) => ({ ...step, callId: `runtime-tools-${index}` }))
    class CountedAdapter extends LlmAdapter {
      async resolveModel(provider, id) { return { provider, id, name: id } }
      async *stream(options) {
        if (!options.tools?.length) {
          report.auxiliaryModelCalls = (report.auxiliaryModelCalls ?? 0) + 1
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Runtime tool fixture' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        const index = report.modelCalls++
        const step = plan[index]
        if (!step) { yield { type: 'finish', reason: { kind: 'stop' } }; return }
        assert.ok(options.tools?.some(tool => tool.name === step.name), `${step.name} must be visible to the actual model`)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(step.callId), name: step.name, arguments: JSON.stringify(step.arguments) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
    }
    const fixture = ctx.plugin({ inject: ['llm', 'tools'], apply(scope) {
      scope.llm.registerAdapter(['runtime-tools-fixture'], new CountedAdapter())
      scope.on('tools/result', (exec, result) => {
        if (exec.agent !== agent) return
        report.tools.push({ name: exec.name, callId: exec.callId, isError: result.isError,
          ...(result.isError ? { error: result.error } : { value: result.value }), content: result.content })
      })
      scope.on('approval/request', (request, next) => {
        const approved = request.agent === agent && plan.some(step => step.callId === request.callId && step.name === request.toolName)
        if (!approved) return next()
        report.approvals.push({ callId: request.callId, tool: request.toolName, decision: 'allowed-once' })
        return 'allowed-once'
      })
    } })
    await fixture.await()
    const registered = await ctx.workspaceController.create({ path: workspace })
    report.workspaceId = registered.workspace.workspaceId
    assert.ok(report.workspaceId)
    const made = await ctx.sessionController.create({ workspaceId: report.workspaceId, sessionId: `runtime-tools-${randomUUID()}` })
    report.sessionId = made.sessionId
    agent = ctx.agents.get(made.sessionId)
    const schemas = ctx.tools.schemas(agent)
    report.visibleTools = schemas.map(schema => schema.name)
    report.agentPreset = made.agentPreset
    await writeFile(path.join(run, 'official-tool-schemas.json'), JSON.stringify(schemas.filter(schema => ['read', 'write', 'pwsh'].includes(schema.name)), null, 2))
    for (const name of ['write', 'read', 'pwsh']) {
      const schema = schemas.find(value => value.name === name)
      assert.ok(schema, `Installed official profile must expose ${name}`)
      report.schemas.push(schema)
    }
    const writer = report.schemas.find(value => value.name === 'write').parameters.properties
    const reader = report.schemas.find(value => value.name === 'read').parameters.properties
    const shell = report.schemas.find(value => value.name === 'pwsh').parameters.properties
    assert.ok(writer.file_path && writer.content && reader.file_path)
    assert.ok(shell.command && shell.description)

    const idle = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Real agent tool loop did not become idle in 60 seconds')), 60000)
      const stop = ctx.on('agent/status', event => { if (event.agent === agent && event.status === 'idle') { clearTimeout(timer); stop(); resolve() } })
    })
    await ctx.sessionController.prompt({ sessionId: made.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Run the four deterministic scratch file and PowerShell tool checks.' }] }, new AbortController().signal)
    await idle
    report.durableToolResults = agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data)
    assert.equal(report.modelCalls, 5)
    assert.equal(report.tools.length, 4)
    assert.ok(report.tools.every(tool => tool.isError === false), 'Every actual official tool result must succeed')
    assert.equal((await readFile(path.join(workspace, 'file-marker.txt'), 'utf8')).replace(/^\uFEFF/, '').trim(), marker)
    assert.equal((await readFile(path.join(workspace, 'shell-marker.txt'), 'utf8')).replace(/^\uFEFF/, '').trim(), shellMarker)
    assert.ok(JSON.stringify(report.tools[1].content).includes(marker))
    assert.ok(JSON.stringify(report.tools[2].content).includes(shellMarker))
    report.powerShellProcess = { executable: report.tools[2].value.stdout.text.match(/DSH_PWSH_EXECUTABLE=([^\r\n]+)/)?.[1],
      pid: Number(report.tools[2].value.stdout.text.match(/DSH_PWSH_PID=(\d+)/)?.[1]) }
    assert.match(report.powerShellProcess.executable ?? '', /(?:pwsh|powershell)\.exe$/i)
    if (state.powershell) assert.equal(path.resolve(report.powerShellProcess.executable).toLowerCase(), path.resolve(state.powershell.path).toLowerCase(), 'Actual official executor must use the installed private PowerShell')
    assert.ok(report.powerShellProcess.pid > 0)
    assert.ok(JSON.stringify(report.tools[3].content).includes(shellMarker))
    report.passed = ['official Workspace registration', 'new isolated Session through official Controller', 'counted mock actual agent loop',
      'official write + read file tools', 'official pwsh shell tool + command output', 'PowerShell file independently verified and read by official file tool']
    report.status = 'passed'
  } catch (error) { report.status = 'failed'; report.failure = error.message; process.exitCode = 1 }
  finally {
    await writeFile(path.join(run, 'result.json'), JSON.stringify(report, null, 2))
    if (shutdown) await shutdown.shutdown(report.status === 'passed' ? 0 : 1)
  }
}


