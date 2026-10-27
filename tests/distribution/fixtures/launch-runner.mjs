import { main } from '../../../scripts/distribution/manager.mjs'
const signals = ['SIGTERM', 'SIGINT', 'SIGHUP']
const counts = signals.map(signal => process.listenerCount(signal))
try {
  const result = await main(['launch', '--root', process.argv[2], '--', process.argv[2], process.argv[3]])
  process.send({ result, cleanListeners: signals.every((signal, i) => process.listenerCount(signal) === counts[i]) })
} catch (error) {
  process.send({ error: error.message, cleanListeners: signals.every((signal, i) => process.listenerCount(signal) === counts[i]) })
  process.exitCode = 1
}
process.disconnect()
