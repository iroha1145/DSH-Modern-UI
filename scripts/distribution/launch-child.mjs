import { spawn } from 'node:child_process'
import { constants } from 'node:os'

/** Keep one signal owner across preflight, configuration writes, and the running application. */
export function createLaunchLifecycle() {
  let active
  let interrupted
  const handlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const forward = () => {
      interrupted ??= signal
      if (active?.exitCode === null && active.signalCode === null) active.kill(signal)
    }
    handlers.set(signal, forward)
    process.on(signal, forward)
  }
  return {
    get interrupted() {
      return interrupted
    },
    run(executable, args, options, { captureOutput = false, maxBuffer = 1024 * 1024, timeout = 0 } = {}) {
      // An interruption between children must not start the next stage.
      if (interrupted) return Promise.resolve({ exitCode: 128 + constants.signals[interrupted], signal: interrupted })
      if (active) throw new Error('Launch lifecycle already has a running child')
      return new Promise((resolve, reject) => {
        const child = spawn(executable, args, captureOutput ? { ...options, stdio: ['ignore', 'pipe', 'pipe'] } : options)
        active = child
        let failure
        const chunks = { stdout: [], stderr: [] }
        const sizes = { stdout: 0, stderr: 0 }
        const terminate = error => {
          failure ??= error
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        }
        const timer = timeout > 0 ? setTimeout(() => terminate(new Error(`Child timed out after ${timeout}ms`)), timeout) : undefined
        if (captureOutput)
          for (const stream of ['stdout', 'stderr'])
            child[stream].on('data', chunk => {
              if (failure) return
              sizes[stream] += chunk.length
              if (sizes[stream] > maxBuffer) terminate(new Error(`Child ${stream} exceeded ${maxBuffer} bytes`))
              else chunks[stream].push(chunk)
            })
        child.on('error', error => {
          failure ??= error
        })
        child.once('close', (code, signal) => {
          clearTimeout(timer)
          active = undefined
          if (failure) reject(failure)
          else
            resolve({
              exitCode: code ?? 128 + constants.signals[signal],
              ...(signal ? { signal } : {}),
              ...(captureOutput ? { stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') } : {}),
            })
        })
      })
    },
    dispose() {
      for (const [signal, handler] of handlers) process.off(signal, handler)
    },
  }
}

// The caller retains its operation lease until the child and its stdio close.
export async function launchChild(executable, args, options) {
  const lifecycle = createLaunchLifecycle()
  try {
    return await lifecycle.run(executable, args, options)
  } finally {
    lifecycle.dispose()
  }
}
