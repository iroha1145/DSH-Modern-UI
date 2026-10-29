import { spawn, execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execute = promisify(execFile)

export async function consumerEnvironment(state) {
  const { launchEnvironment } = await import(pathToFileURL(state.manager).href)
  const env = { ...launchEnvironment(state), DSH_HOME: state.home, DSH_TELEMETRY_DISABLED: '1' }
  for (const key of Object.keys(env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|NODE_PATH|NODE_OPTIONS)/i.test(key)) delete env[key]
  return env
}

export async function officialCommand(state, args, output) {
  const result = await execute(state.node, [state.cli, ...args], {
    cwd: state.generation, env: await consumerEnvironment(state), windowsHide: true,
    timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
  })
  if (output) await writeFile(output, result.stdout + result.stderr)
  return result.stdout
}

/** Own only this test's real CLI process; return its actual cookie-authenticated origin. */
export async function startHost(state, output) {
  output = resolve(output)
  await mkdir(dirname(output), { recursive: true })
  const env = await consumerEnvironment(state)
  let child, text = '', connection
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    await Promise.race([exited, delay(5000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
    await writeFile(output, text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
  }
  const start = async () => {
    const overlay = join(dirname(output), 'host-test.patch.yml')
    await writeFile(overlay, '- id: schedule\n  disabled: true\n')
    child = spawn(state.node, [state.cli, '--profile', state.profile, '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: state.generation, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let startup = ''
    const tokenUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Actual CLI did not announce its Web origin')), 60_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Actual CLI exited (${code}) before readiness`)) })
      child.stdout.on('data', chunk => {
        text += chunk
        startup += chunk
        const url = startup.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*)/)
        if (url) { clearTimeout(timer); resolve(url[1]) }
      })
      child.stderr.on('data', chunk => { text += chunk; startup += chunk })
    })
    const response = await fetch(tokenUrl, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
    if (!cookie) throw new Error('Actual CLI did not issue its browser cookie')
    connection = { baseUrl: new URL(tokenUrl).origin, cookie }
    await delay(500)
    const { auditStartupOutput } = await import(pathToFileURL(join(dirname(state.manager), 'web-self-test.mjs')).href)
    if (auditStartupOutput(startup).problem) throw new Error('Actual Host startup reported an inactive or invalid entry; inspect the startup log')
    return connection
  }
  try { await start() } catch (error) { await stop(); throw error }
  return { ...connection, stop, restart: async () => { await stop(); return start() } }
}
