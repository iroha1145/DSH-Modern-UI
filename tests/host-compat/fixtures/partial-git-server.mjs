import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, connect } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'

const root = fileURLToPath(new URL('../../../', import.meta.url))

export async function bytesOnDisk(directory) {
  let total = 0
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) total += (await stat(path.join(entry.parentPath, entry.name))).size
  }
  return total
}

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

/** Real Git daemon behind a loopback-only TCP relay; the relay can hold new connections for cancellation tests. */
export async function partialGitServer(t) {
  const work = path.join(root, 'work')
  await mkdir(work, { recursive: true })
  const parent = await realpath(work)
  const directory = await mkdtemp(path.join(parent, 'repository-cache-git-'))
  const emptyConfig = path.join(directory, 'empty.gitconfig')
  await writeFile(emptyConfig, '')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never',
    GIT_NO_LAZY_FETCH: '1' }
  // The test's setup/inspection Git never consults credentials or user URL rewrites.
  const git = async (args, cwd = directory) => (await execa('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd, env, extendEnv: false, windowsHide: true, timeout: 10000 })).stdout
  const source = path.join(directory, 'source')
  const served = path.join(directory, 'served')
  const remote = path.join(served, 'fixture.git')
  const cacheDir = path.join(directory, 'cache')
  await mkdir(source); await mkdir(served); await mkdir(cacheDir)
  await git(['init', '--quiet', '--template=', '--initial-branch=main'], source)
  await git(['config', 'core.autocrlf', 'false'], source)
  const small = Buffer.from('# Actual Git README\nA small complete read.\n')
  const blobs = Array.from({ length: 6 }, () => randomBytes(64 * 1024))
  await writeFile(path.join(source, 'README.md'), small)
  for (const [index, blob] of blobs.entries()) await writeFile(path.join(source, `large-${index}.bin`), blob)
  await git(['add', '--all'], source)
  await git(['-c', 'user.name=Repository Cache Fixture', '-c', 'user.email=cache-fixture@example.invalid', 'commit', '--quiet', '-m', 'Partial-clone fixture'], source)
  const commit = await git(['rev-parse', 'HEAD'], source)
  const blobIds = await Promise.all(blobs.map((_, index) => git(['rev-parse', `HEAD:large-${index}.bin`], source)))
  await git(['clone', '--quiet', '--bare', '--no-local', source, remote])
  await git(['--git-dir', remote, 'config', 'uploadpack.allowFilter', 'true'])
  await git(['--git-dir', remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true'])
  const portReservation = createServer()
  const daemonPort = await listen(portReservation)
  await new Promise(resolve => portReservation.close(resolve))
  const daemonLife = new AbortController()
  const daemon = execa('git', ['daemon', '--reuseaddr', '--export-all', '--listen=127.0.0.1',
    `--port=${daemonPort}`, `--base-path=${served}`, served], {
    cwd: directory, env, extendEnv: false, windowsHide: true, cancelSignal: daemonLife.signal,
    killDescendants: true, reject: false,
  })
  // Attach immediately: teardown intentionally terminates this long-running real Git process.
  const daemonDone = daemon.catch(error => error)
  const sockets = new Set()
  let gate = false
  let nextHeld
  const relay = createServer(client => {
    sockets.add(client); client.on('error', () => {}); client.on('close', () => sockets.delete(client))
    if (gate) { client.pause(); nextHeld?.(); nextHeld = undefined; return }
    const upstream = connect({ host: '127.0.0.1', port: daemonPort })
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream))
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.pipe(upstream).pipe(client)
  })
  const relayPort = await listen(relay)
  const url = `git://127.0.0.1:${relayPort}/fixture.git`
  const repository = path.join(cacheDir, createHash('sha256').update(url).digest('hex').slice(0, 24))
  const tracked = []
  t.after(async () => {
    for (const { life } of tracked) life.abort(new Error('Fixture disposed'))
    await Promise.all(tracked.map(({ cache }) => cache.settled()))
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => relay.close(resolve))
    daemonLife.abort(); await daemonDone
    assert.equal(path.dirname(await realpath(directory)), parent)
    assert.match(path.basename(directory), /^repository-cache-git-/)
    await rm(directory, { recursive: true, force: true })
  })
  // Only a controlled git:// loopback transport is allowed by the product options below.
  // Refuse an environment that would rewrite that URL before handing it to the product.
  const globalRewrites = await execa('git', ['config', '--get-regexp', '^url\..*\.insteadof$'], { reject: false })
  for (const line of globalRewrites.stdout.split('\n')) {
    const prefix = line.slice(line.indexOf(' ') + 1).trim()
    assert.ok(!prefix || !url.startsWith(prefix), 'global Git configuration must not rewrite the loopback fixture URL')
  }
  const started = Date.now()
  while (true) {
    try { await git(['ls-remote', url, 'HEAD']); break } catch (error) {
      if (Date.now() - started > 5000) throw error
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  return {
    directory, cacheDir, repository, url, commit, small, blobs, blobIds, git,
    track(cache, life) { tracked.push({ cache, life }); return cache },
    holdConnections() {
      gate = true
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { nextHeld = undefined; reject(new Error('Git did not open the held loopback connection')) }, 5000)
        nextHeld = () => { clearTimeout(timer); resolve() }
      })
    },
    releaseConnections() { gate = false; for (const socket of sockets) socket.destroy() },
  }
}
