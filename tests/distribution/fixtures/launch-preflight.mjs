import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Real CLI preflight that acknowledges a signal but waits for a test-controlled graceful exit. */
export function holdPreflight(root) {
  process.on('exit', () => writeFileSync(join(root, 'preflight-exited'), 'true'))
  const handlers = new Map()
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    const handler = () => {
      writeFileSync(join(root, 'preflight-signal'), signal)
      appendFileSync(join(root, 'preflight-signals'), signal + '\n')
    }
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (!existsSync(join(root, 'preflight-release'))) return
      clearInterval(timer)
      for (const [signal, handler] of handlers) process.off(signal, handler)
      resolve()
    }, 20)
    writeFileSync(join(root, 'preflight-ready'), String(process.pid))
  })
}
