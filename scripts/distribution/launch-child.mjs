import { spawn } from 'node:child_process'
import { constants } from 'node:os'

// The caller retains its operation lease until this promise settles.
export function launchChild(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, options)
    const handlers = new Map()
    let failure
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const forward = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal)
      }
      handlers.set(signal, forward)
      process.on(signal, forward)
    }
    child.on('error', error => { failure = error })
    child.once('close', (code, signal) => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
      if (failure) reject(failure)
      else resolve({ exitCode: code ?? 128 + constants.signals[signal], ...(signal ? { signal } : {}) })
    })
  })
}
