import { appendFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const [root, mode] = process.argv.slice(4)
process.on('exit', () => writeFileSync(join(root, 'child-exited'), 'true'))
if (mode === 'hold' || mode === 'default-signal') {
  if (mode === 'hold') {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { writeFileSync(join(root, 'child-signal'), signal); appendFileSync(join(root, 'child-signals'), signal + '\n') })
  }
  setInterval(() => { if (existsSync(join(root, 'child-release'))) process.exit(0) }, 20)
  writeFileSync(join(root, 'child-ready'), String(process.pid))
} else process.exit(Number(mode))
