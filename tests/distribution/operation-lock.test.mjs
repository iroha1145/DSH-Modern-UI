import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { acquireOperationLock, OperationLockedError, withOperationLock } from '../../scripts/distribution/operation-lock.mjs'

const filename = fileURLToPath(import.meta.url)

// The test file doubles as a small child fixture; no installed DSH is needed.
async function childOwner(root, mode) {
  const send = message => new Promise((accept, reject) => {
    process.send(message, error => error ? reject(error) : accept())
  })
  let lease
  try { lease = await acquireOperationLock(root) }
  catch (error) {
    await send({ kind: 'denied', code: error.code, message: error.message })
    process.disconnect()
    return
  }
  const released = new Promise(accept => {
    process.once('message', async message => {
      assert.equal(message, 'release')
      await lease.release()
      process.disconnect()
      accept()
    })
  })
  await send({ kind: 'held', endpoint: lease.endpoint, identity: lease.identity })
  if (mode === 'blocking') {
    // This owned subprocess exits by itself shortly after its owner is killed.
    // It performs no I/O and inherits no listening handle.
    spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900)'],
      { windowsHide: true, stdio: 'ignore', timeout: 2000 })
  }
  await released
}

async function fixture(t) {
  const parent = await realpath(tmpdir())
  const directory = await mkdtemp(join(parent, 'dsh-operation-lock-'))
  const root = join(directory, 'program')
  await mkdir(root)
  const owners = []
  t.after(async () => {
    // Stop only subprocesses this test created, then remove its verified temp root.
    for (const owner of owners) {
      if (owner.child.exitCode === null && owner.child.signalCode === null) owner.child.kill('SIGKILL')
      await owner.exited
    }
    const inside = relative(parent, resolve(directory))
    assert.ok(inside !== '' && inside !== '..' && !inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(inside))
    await rm(directory, { recursive: true, force: true })
  })
  function owner(mode = 'hold', alias = root) {
    const child = spawn(process.execPath, [filename, '--owner', alias, mode], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    let stderr = ''
    child.stderr.on('data', bytes => { stderr += bytes })
    const exited = new Promise(accept => child.once('exit', (code, signal) => accept({ code, signal })))
    const ready = new Promise((accept, reject) => {
      child.once('message', accept)
      child.once('error', reject)
      child.once('exit', (code, signal) => reject(new Error(`Lock fixture exited before reporting (${code}, ${signal}): ${stderr}`)))
    })
    const handle = { child, ready, exited }
    owners.push(handle)
    return handle
  }
  return { directory, root, owner }
}

if (process.argv[2] === '--owner') {
  await childOwner(process.argv[3], process.argv[4])
} else {
  test('release is idempotent and exceptions release the kernel lease', async t => {
    const { root } = await fixture(t)
    const lease = await acquireOperationLock(root)
    assert.ok(lease.endpoint.port >= 20_000 && lease.endpoint.port < 60_000)
    await assert.rejects(acquireOperationLock(root), error => error instanceof OperationLockedError && error.code === 'DSH_OPERATION_LOCKED')
    await Promise.all([lease.release(), lease.release()])
    const failure = new Error('work rejected')
    await assert.rejects(withOperationLock(root, async () => { throw failure }), error => error === failure)
    assert.equal(await withOperationLock(root, async () => 'released'), 'released')
  })

  test('stale historical marker is ignored and never deleted or rewritten', async t => {
    const { root } = await fixture(t)
    const marker = join(root, 'operation.lock')
    await writeFile(marker, 'historical or user-owned marker')
    await withOperationLock(root, async () => {})
    assert.equal(await readFile(marker, 'utf8'), 'historical or user-owned marker')
  })

  test('real junction/symlink aliases and Windows case/drive aliases contend', async t => {
    const { directory, root } = await fixture(t)
    const alias = join(directory, 'alias')
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const lease = await acquireOperationLock(root)
    try {
      for (const spelling of [alias, ...(process.platform === 'win32' ? [root.toUpperCase(), root.toLowerCase()] : [])]) {
        await assert.rejects(acquireOperationLock(spelling), error => error.code === 'DSH_OPERATION_LOCKED'
          && error.endpoint.port === lease.endpoint.port)
      }
    } finally { await lease.release() }
    const throughAlias = await acquireOperationLock(alias)
    try {
      assert.equal(throughAlias.identity, lease.identity)
      assert.deepEqual(throughAlias.endpoint, lease.endpoint)
    } finally { await throughAlias.release() }
  })

  test('six real contenders admit exactly one live owner', { timeout: 15000 }, async t => {
    const { root, owner } = await fixture(t)
    const children = Array.from({ length: 6 }, () => owner())
    const results = await Promise.all(children.map(child => child.ready))
    assert.equal(results.filter(result => result.kind === 'held').length, 1)
    assert.equal(results.filter(result => result.kind === 'denied' && result.code === 'DSH_OPERATION_LOCKED').length, 5)
    await assert.rejects(acquireOperationLock(root), { code: 'DSH_OPERATION_LOCKED' })
    const winner = children[results.findIndex(result => result.kind === 'held')]
    winner.child.send('release')
    assert.equal((await winner.exited).code, 0)
    await withOperationLock(root, async () => {})
  })

  test('SIGKILL releases an owner while its JS thread is blocked in spawnSync', { timeout: 15000 }, async t => {
    const { root, owner } = await fixture(t)
    const current = join(root, 'current.json')
    const selection = '{"generation":"previous-generation-still-selected"}\n'
    await writeFile(current, selection)
    const child = owner('blocking')
    assert.equal((await child.ready).kind, 'held')
    await delay(75)
    await assert.rejects(acquireOperationLock(root), { code: 'DSH_OPERATION_LOCKED' })
    assert.equal(child.child.kill('SIGKILL'), true)
    await child.exited
    const newOwner = await acquireOperationLock(root)
    try {
      assert.equal(await readFile(current, 'utf8'), selection)
      await assert.rejects(acquireOperationLock(root), { code: 'DSH_OPERATION_LOCKED' })
    } finally { await newOwner.release() }
    // Let the deliberately orphaned, inert 900 ms test command finish itself.
    await delay(1000)
  })

  test('an unrelated listener denies acquisition without fallback or stealing', async t => {
    const { root } = await fixture(t)
    const probe = await acquireOperationLock(root)
    const endpoint = probe.endpoint
    await probe.release()
    const stranger = createServer(socket => socket.destroy())
    await new Promise((accept, reject) => {
      stranger.once('error', reject)
      stranger.listen({ ...endpoint, exclusive: true, reusePort: false }, accept)
    })
    try {
      await assert.rejects(acquireOperationLock(root), error => error.code === 'DSH_OPERATION_LOCKED'
        && error.endpoint.port === endpoint.port)
      assert.equal(stranger.listening, true)
    } finally { await new Promise((accept, reject) => stranger.close(error => error ? reject(error) : accept())) }
    await withOperationLock(root, async () => {})
  })

  test('independent roots can hold different kernel endpoints concurrently', async t => {
    const { directory, root } = await fixture(t)
    const other = join(directory, 'other-program')
    await mkdir(other)
    const first = await acquireOperationLock(root)
    try {
      let second
      try { second = await acquireOperationLock(other) }
      catch (error) {
        // A genuine hash collision is intentionally a conservative refusal.
        if (error.code === 'DSH_OPERATION_LOCKED' && error.endpoint.port === first.endpoint.port) return
        throw error
      }
      try { assert.notEqual(first.endpoint.port, second.endpoint.port) }
      finally { await second.release() }
    } finally { await first.release() }
  })

  test('unsolicited loopback connections cannot retain a released lease', { timeout: 5000 }, async t => {
    const { root } = await fixture(t)
    const lease = await acquireOperationLock(root)
    const client = createConnection(lease.endpoint)
    // Immediate server-side destruction may be reported as ECONNRESET.
    client.on('error', () => {})
    try {
      await new Promise((accept, reject) => {
        client.once('connect', accept)
        client.once('error', reject)
      })
      await lease.release()
      await withOperationLock(root, async () => {})
    } finally { client.destroy(); await lease.release() }
  })

  test('root validation neither creates missing directories nor accepts files', async t => {
    const { directory } = await fixture(t)
    const missing = join(directory, 'not-created')
    await assert.rejects(acquireOperationLock(missing), { code: 'ENOENT' })
    await assert.rejects(realpath(missing), { code: 'ENOENT' })
    const file = join(directory, 'not-a-directory')
    await writeFile(file, 'unchanged')
    await assert.rejects(acquireOperationLock(file), /requires an existing directory/)
    assert.equal(await readFile(file, 'utf8'), 'unchanged')
  })
}
