// Black-box public-service test against an installed npm dependency closure.
// Usage: <exact-node> native-probe.mjs <official-package.json> [empty-scratch-directory]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { isMainModule } from './entrypoint.mjs'
export async function runNativeProbe(backendPath, scratchPath) {
  const backend = await realpath(resolve(backendPath))
  const root = resolve(scratchPath)
  await mkdir(root, { recursive: true })
  const require = createRequire(backend)
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const persistence = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const { SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session')
  const { LocalSubprocessRuntime } = await load('@deepseek-ai/dsh-subprocess-local')
  const contexts = [new Context(), new Context()]
  let first
  let reopened
  let result
  try {
    if (process.platform === 'linux') {
      const sandboxRequire = createRequire(require.resolve('@deepseek-ai/dsh-sandbox-local/package.json'))
      const { probe } = await import(pathToFileURL(sandboxRequire.resolve('@deepseek-ai/node-addon-system/landlock-run')).href)
      assert.notEqual(probe(), 'unusable', 'Linux confinement must remain available')
    }
    for (const ctx of contexts) await persistence.apply(ctx, { root: join(root, 'sessions'), compression: 'none' })
    first = await contexts[0].sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id: 'native-lock-probe', createdAt: Date.now(), isSeeded: false, cwd: root, agentPreset: 'test-preserved-preset' })
    await first.flush()
    await assert.rejects(contexts[1].sessionPersistence.open('native-lock-probe', 'write'), /owned|locked|ownership/i)
    await first.close(); first = undefined
    reopened = await contexts[1].sessionPersistence.open('native-lock-probe', 'write')
    await reopened.close(); reopened = undefined
    const runtime = new LocalSubprocessRuntime(contexts[0])
    const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
    const args = process.platform === 'win32' ? ['/d', '/c', 'echo DSH_MANAGED_OK'] : ['-c', 'printf DSH_MANAGED_OK']
    const child = runtime.spawn({ argv: [command, ...args], cwd: root, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 1000 })
    let output = ''
    child.stdout.on('data', bytes => { output += bytes })
    assert.equal((await child.done).exitCode, 0)
    assert.match(output, /DSH_MANAGED_OK/)
    await child.waitForExit()
    const terminal = await runtime.spawnTerminal({ argv: [command, ...args], cwd: root, rows: 24, cols: 80, terminalType: 'xterm', graceMs: 1000 })
    let terminalOutput = ''
    terminal.output.on('data', bytes => { terminalOutput += bytes })
    assert.equal((await terminal.done).exitCode, 0)
    assert.match(terminalOutput, /DSH_MANAGED_OK/)
    await terminal.terminate()
    const searchRequire = createRequire(require.resolve('@deepseek-ai/dsh-tool-fs-search/package.json'))
    const { rgPath } = await import(pathToFileURL(searchRequire.resolve('@vscode/ripgrep')).href)
    const ripgrep = spawnSync(rgPath, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    assert.equal(ripgrep.status, 0, 'Published npm ripgrep binary must run without a system rg')
    result = { backend, node: process.version, platform: process.platform, arch: process.arch, sessionWriteLock: 'second writer rejected; reacquired after close', ordinarySubprocess: 'passed', officialTerminalService: 'passed',
      ripgrep: { path: rgPath, version: ripgrep.stdout.trim().split(/\r?\n/)[0] }, sourceCompilation: 'none invoked by this test' }
    await writeFile(join(root, 'native-consumer-result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  } finally {
    await reopened?.close(); await first?.close()
    for (const ctx of contexts) await ctx.fiber.dispose()
  }
  return result
}
if (isMainModule(import.meta.url)) {
  await runNativeProbe(process.argv[2], process.argv[3] ?? join(process.cwd(), '.native-probe'))
  process.exit(0)
}

