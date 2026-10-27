// Usage: exact-node native-consumer.mjs official-package.json EMPTY_SCRATCH_DIRECTORY
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { runNativeProbe } from '../../scripts/distribution/native-probe.mjs'
const root = resolve(process.argv[3])
if (existsSync(root)) throw new Error('Use an absent scratch directory; real user data is never a probe target')
await runNativeProbe(process.argv[2], root)
// The Windows node-pty console-list helper can retain an IPC handle after its PTY exits.
process.exit(0)
