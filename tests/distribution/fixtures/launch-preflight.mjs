import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Real CLI preflight that acknowledges a signal but waits for a test-controlled graceful exit. */
export function holdPreflight(root) {
  process.on('exit', () => writeFileSync(join(root, 'preflight-exited'), 'true'))
  const mode = readFileSync(join(root, 'preflight-mode'), 'utf8')
  if (mode !== 'hold') {
    writeFileSync(join(root, 'preflight-ready'), String(process.pid))
    if (mode === 'fail') {
      process.stderr.write('fixture preflight failed')
      process.exit(9)
    }
    if (mode === 'overflow') {
      setInterval(() => {}, 1000)
      process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 65))
      return new Promise(() => {})
    }
    throw new Error(`Unknown preflight mode ${mode}`)
  }
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
