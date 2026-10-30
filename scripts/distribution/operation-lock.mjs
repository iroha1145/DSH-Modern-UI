import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

// Keep this namespace and mapping stable across manager upgrades: two versions
// operating on the same directory must contend for the same kernel endpoint.
const NAMESPACE = 'dsh-modern-ui-operation-lock-v1'
const FIRST_PORT = 20_000
const PORT_COUNT = 40_000

/** A live owner or an unrelated listener occupies this root's lock endpoint. */
export class OperationLockedError extends Error {
  constructor(root, endpoint, cause) {
    super(
      `Another operation/launch is active, or the operation-lock endpoint ${endpoint.host}:${endpoint.port} is occupied; cannot lock ${root}. Stop the owning operation and retry. Removing a lock file will not help.`,
      { cause },
    )
    this.name = 'OperationLockedError'
    this.code = 'DSH_OPERATION_LOCKED'
    this.root = root
    this.endpoint = endpoint
  }
}

async function describe(root) {
  const canonical = await realpath(resolve(root))
  const metadata = await stat(canonical, { bigint: true })
  if (!metadata.isDirectory()) throw new Error(`Operation lock requires an existing directory: ${canonical}`)
  if (metadata.ino === 0n) throw new Error(`Filesystem provides no stable directory identity for operation locking: ${canonical}`)
  // dev identifies the local filesystem/volume; ino identifies the directory.
  // Case, drive-letter spelling, symlinks and junctions are not lock identities.
  // The loopback namespace is already local to this machine's kernel.
  const identity = `${process.platform}:${metadata.dev.toString(16)}:${metadata.ino.toString(16)}`
  const hash = createHash('sha256').update(`${NAMESPACE}\0${identity}`).digest()
  const port = FIRST_PORT + Number(hash.readBigUInt64BE(0) % BigInt(PORT_COUNT))
  return { root: canonical, identity, endpoint: Object.freeze({ host: '127.0.0.1', port }) }
}

/**
 * Acquire a host-local operation lease before installation or launching DSH.
 *
 * The calling process owns an exclusive TCP listening handle, not a file or a
 * separate helper process. Blocking its JS thread with spawnSync leaves the
 * kernel handle held; process termination (including SIGKILL) releases it.
 * No protocol, background daemon, PID probing or stale-file deletion is used.
 * Historical operation.lock files are neither consulted nor changed.
 *
 * A hash collision or unrelated listener conservatively denies acquisition.
 * Never retry at a different port: that could admit two owners of one root.
 * This is a local-machine lease, not cross-machine coordination for a shared
 * network filesystem. The program root must remain in place during the lease.
 *
 * @param {string} root Existing program root; aliases of one directory contend.
 * @returns {Promise<{root: string, identity: string, endpoint: {host: string, port: number}, release: () => Promise<void>}>}
 */
export async function acquireOperationLock(root) {
  const descriptor = await describe(root)
  // This endpoint carries no application traffic. Immediately discard an
  // unsolicited connection so it cannot delay normal release.
  const server = createServer({ pauseOnConnect: true }, socket => socket.destroy())
  await new Promise((accept, reject) => {
    const failed = error => {
      if (error.code === 'EADDRINUSE') reject(new OperationLockedError(descriptor.root, descriptor.endpoint, error))
      else reject(error)
    }
    server.once('error', failed)
    server.listen({ ...descriptor.endpoint, exclusive: true, reusePort: false }, () => {
      server.off('error', failed)
      accept()
    })
  })
  let releasing
  return Object.freeze({
    ...descriptor,
    release() {
      releasing ??= new Promise((accept, reject) => {
        server.close(error => (error ? reject(error) : accept()))
      })
      return releasing
    },
  })
}

/** Run one operation under the lease, releasing it on success or rejection. */
export async function withOperationLock(root, operation) {
  const lease = await acquireOperationLock(root)
  try {
    return await operation(lease)
  } finally {
    await lease.release()
  }
}
