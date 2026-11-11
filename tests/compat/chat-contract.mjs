import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chatContract, chatContractVersions } from './chat-contract-versions.mjs'

const execute = promisify(execFile)
const repo = fileURLToPath(new URL('../../', import.meta.url))
const options = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  assert.ok(['--host', '--root'].includes(key) && process.argv[i + 1] && !Object.hasOwn(options, key), `Invalid option: ${key}`)
  options[key] = process.argv[i + 1]
}
const versions = options['--host'] ? [options['--host']] : chatContractVersions
for (const version of versions) chatContract(version)
const output = options['--root'] ? path.resolve(options['--root']) : await mkdtemp(path.join(tmpdir(), 'modern-chat-contract-'))
await mkdir(output, { recursive: true })
const relative = path.relative(await realpath(repo), await realpath(output))
assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Consumers must be outside the development repository')
const npm =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
const report = {
  startedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  scope: 'Published chat contract and pure Modern projections only; no full host/platform verification',
  hosts: [],
}
let failed = false
for (const requested of versions) {
  const directory = await mkdtemp(path.join(output, requested + '-'))
  const result = { requested, directory }
  report.hosts.push(result)
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, dependencies: { '@deepseek-ai/dsh': requested } }))
    const installed = await execute(
      process.execPath,
      [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(output, 'npm-cache')],
      { cwd: directory, windowsHide: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
    )
    await writeFile(path.join(directory, 'install.log'), installed.stdout + installed.stderr)
    const consumer = createRequire(path.join(directory, 'package.json'))
    const backendPackage = await realpath(consumer.resolve('@deepseek-ai/dsh/package.json'))
    const backend = createRequire(backendPackage)
    const chatPackage = await realpath(backend.resolve('@deepseek-ai/dsh-client-ui-chat/package.json'))
    for (const filename of [backendPackage, chatPackage]) {
      const dependency = path.relative(await realpath(directory), filename)
      assert.ok(
        dependency !== '..' && !dependency.startsWith('..' + path.sep) && !path.isAbsolute(dependency),
        'Release dependencies must resolve within this independent consumer',
      )
    }
    result.backendVersion = JSON.parse(await readFile(backendPackage, 'utf8')).version
    result.chatVersion = JSON.parse(await readFile(chatPackage, 'utf8')).version
    Object.assign(result, { backendPackage, chatPackage })
    assert.equal(result.backendVersion, requested)
    assert.equal(result.chatVersion, requested)
    const checked = await execute(
      process.execPath,
      [path.join(repo, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'compat', 'tests/compat/chat-contract.test.mjs'],
      {
        cwd: repo,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          COMPAT_BACKEND_PACKAGE: backendPackage,
          COMPAT_EXPECTED_HOST: requested,
          COMPAT_CONTRACT_EVIDENCE: path.join(directory, 'contract.json'),
        },
      },
    )
    await writeFile(path.join(directory, 'contract.log'), checked.stdout + checked.stderr)
    result.contract = JSON.parse(await readFile(path.join(directory, 'contract.json'), 'utf8'))
    result.status = 'passed'
  } catch (error) {
    failed = true
    result.status = 'failed'
    result.error = error.message
    await writeFile(path.join(directory, 'failure.log'), `${error.stdout ?? ''}${error.stderr ?? ''}\n${error.stack}`)
  }
  console.info(`${requested}: ${result.status} (${directory})`)
  result.completedAt = new Date().toISOString()
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
if (failed) process.exitCode = 1
