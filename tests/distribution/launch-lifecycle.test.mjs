import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { acquireOperationLock } from '../../scripts/distribution/operation-lock.mjs'
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url))
async function waitFile(path, signal) {
  for (let i = 0; i < 250; i++) {
    try { return await readFile(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(20, undefined, { signal })
  }
  throw new Error(`Timed out waiting for ${path}`)
}
async function launch(t, mode, missing = false, forkOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-launch-'))
  await writeFile(join(root, 'current.json'), JSON.stringify({ root, home: root, generation: root,
    node: missing ? join(root, 'missing-node') : process.execPath, cli: fixture('launch-child'), profile: 'test', officialBaseline: {} }))
  const parent = fork(fixture('launch-runner'), [root, mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], ...forkOptions })
  let stderr = ''
  parent.stderr.on('data', data => { stderr += data })
  let managerSettled = false
  const message = new Promise(resolve => {
    const received = value => {
      managerSettled = true
      parent.off('exit', ended)
      resolve(value)
    }
    const ended = () => { parent.off('message', received); resolve(undefined) }
    parent.once('message', received)
    parent.once('exit', ended)
  })
  const exited = once(parent, 'exit')
  const closed = once(parent, 'close')
  t.after(async () => {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL')
    if (!managerSettled) {
      try {
        await readFile(join(root, 'child-exited'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        try { process.kill(Number(await readFile(join(root, 'child-ready'), 'utf8')), 'SIGKILL') }
        catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
      }
    }
    await closed
    await rm(root, { recursive: true, force: true })
  })
  return { root, parent, message, exited, closed, stderr: () => stderr }
}
async function unlocked(root) { const lease = await acquireOperationLock(root); await lease.release() }
for (const code of [0, 7]) test(`launch preserves child exit ${code} and releases the real lease`, { timeout: 10000 }, async t => {
  const run = await launch(t, String(code))
  const message = await run.message
  assert.deepEqual(await run.closed, [code, null], run.stderr())
  assert.equal(message.result.exitCode, code)
  assert.equal(message.cleanListeners, true)
  await unlocked(run.root)
})
test('spawn failure cleans listeners and releases the real lease', { timeout: 10000 }, async t => {
  const run = await launch(t, '0', true)
  const message = await run.message
  assert.match(message.error, /ENOENT/)
  assert.equal(message.cleanListeners, true)
  assert.deepEqual(await run.closed, [1, null])
  await unlocked(run.root)
})
for (const signal of ['SIGTERM', 'SIGINT']) test(`${signal} reaches child and retains lease until child exits`, {
  timeout: 10000, skip: process.platform === 'win32' ? 'Windows kill() force-terminates processes; POSIX signal delivery is exercised on Linux CI' : false,
}, async t => {
  const run = await launch(t, 'hold')
  await waitFile(join(run.root, 'child-ready'))
  await assert.rejects(acquireOperationLock(run.root), { code: 'DSH_OPERATION_LOCKED' })
  run.parent.kill(signal)
  const controller = new AbortController()
  let observed
  try {
    observed = await Promise.race([
      waitFile(join(run.root, 'child-signal'), controller.signal).then(signal => ({ signal })),
      run.exited.then(([code, signal]) => ({ parentExit: { code, signal } })),
    ])
  } finally { controller.abort() }
  if (observed.parentExit) {
    const childPid = Number(await readFile(join(run.root, 'child-ready'), 'utf8'))
    process.kill(childPid, 0)
    await unlocked(run.root)
    t.diagnostic(JSON.stringify({ parentExit: observed.parentExit, childPid, childAlive: true, operationLockReacquired: true }))
    assert.fail(`${signal}: manager exited while its child remained alive and the operation lock became available`)
  }
  assert.equal(observed.signal, signal)
  await assert.rejects(acquireOperationLock(run.root), { code: 'DSH_OPERATION_LOCKED' })
  assert.equal(run.parent.exitCode, null)
  await writeFile(join(run.root, 'child-release'), '')
  const message = await run.message
  assert.equal(message.cleanListeners, true)
  assert.deepEqual(await run.closed, [0, null])
  await unlocked(run.root)
})
for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) test(`${signal} child termination preserves signal exit status`, {
  timeout: 10000, skip: process.platform === 'win32' ? 'Windows kill() force-terminates processes; POSIX signal delivery is exercised on Linux CI' : false,
}, async t => {
  const run = await launch(t, 'default-signal')
  await waitFile(join(run.root, 'child-ready'))
  run.parent.kill(signal)
  const message = await run.message
  assert.ok(message, 'Manager exited before reporting child completion')
  assert.deepEqual(message.result, { exitCode: code, signal })
  assert.equal(message.cleanListeners, true)
  assert.deepEqual(await run.closed, [code, null])
  await unlocked(run.root)
})
for (const signal of ['SIGINT', 'SIGHUP']) test(`terminal-style process-group ${signal} reaches the child exactly once`, {
  timeout: 10000, skip: process.platform === 'win32' ? 'POSIX process groups only' : false,
}, async t => {
  // A terminal signals its whole foreground process group. The manager must not add a second
  // delivery on top of that: the official exit controller force-quits on a repeated signal.
  const run = await launch(t, 'hold', false, { detached: true })
  await waitFile(join(run.root, 'child-ready'))
  process.kill(-run.parent.pid, signal)
  await waitFile(join(run.root, 'child-signals'))
  await delay(400)
  assert.deepEqual((await readFile(join(run.root, 'child-signals'), 'utf8')).trim().split('\n'), [signal])
  assert.equal(run.parent.exitCode, null)
  await writeFile(join(run.root, 'child-release'), '')
  assert.equal((await run.message).cleanListeners, true)
  assert.deepEqual(await run.closed, [0, null])
  await unlocked(run.root)
})
test('normal running child excludes another operation until it exits', { timeout: 10000 }, async t => {
  const run = await launch(t, 'hold')
  await waitFile(join(run.root, 'child-ready'))
  await assert.rejects(acquireOperationLock(run.root), { code: 'DSH_OPERATION_LOCKED' })
  await writeFile(join(run.root, 'child-release'), '')
  assert.equal((await run.message).cleanListeners, true)
  assert.deepEqual(await run.closed, [0, null])
  await unlocked(run.root)
})
