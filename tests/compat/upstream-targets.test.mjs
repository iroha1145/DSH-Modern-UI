import { test } from 'vitest'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const script = path.resolve(import.meta.dirname, '../../scripts/upstream-targets.mjs')

async function targets(versions, args = [], status = 200) {
  const directory = await mkdtemp(path.join(tmpdir(), 'modern-canary-targets-'))
  const output = path.join(directory, 'github-output')
  const metadata = JSON.stringify({ versions: Object.fromEntries(versions.map(version => [version, {}])) })
  // Exercise the real CLI with a deterministic registry; an explicit override must not fetch at all.
  const preload = `globalThis.fetch = async url => {
    if (${args.length > 0}) throw new Error('Manual selection must not fetch registry metadata');
    if (url !== 'https://registry.npmjs.org/@deepseek-ai%2Fdsh') throw new Error('Unexpected registry URL');
    return new Response(${JSON.stringify(metadata)}, {status:${status}});
  }`
  try {
    const { stdout } = await execute(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), script, ...args], {
      env: { ...process.env, GITHUB_OUTPUT: output },
      windowsHide: true,
    })
    const hosts = JSON.parse(stdout)
    assert.equal(await readFile(output, 'utf8'), `hosts=${JSON.stringify(hosts)}\n`)
    return hosts
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test.each([
  {
    name: 'retires the old alpha after an admitted rc is published (issue #41)',
    versions: ['0.2.2-alpha.3', '0.2.1-rc.4', '0.2.2-rc.3', '0.2.2-rc.1'],
    expected: ['0.2.2-rc.3'],
  },
  {
    name: 'still alerts on an alpha with no newer admitted version',
    versions: ['0.2.1-rc.4', '0.2.2-alpha.3'],
    expected: ['0.2.2-alpha.3'],
  },
  {
    name: 'keeps a genuinely new prerelease line outside the range',
    versions: ['0.2.2-alpha.3', '0.2.3-alpha.1', '0.2.2-rc.3'],
    expected: ['0.2.2-rc.3', '0.2.3-alpha.1'],
  },
  {
    name: 'keeps the next minor alpha without hiding the current rc',
    versions: ['0.3.0-alpha.1', '0.2.2-rc.3', '0.2.2-alpha.3'],
    expected: ['0.2.2-rc.3', '0.3.0-alpha.1'],
  },
  {
    name: 'selects the newest admitted prerelease, release and future release separately',
    versions: ['0.3.0-alpha.1', '0.2.2-rc.9', '0.2.2-alpha.3', '0.3.0', '0.2.2', '0.2.2-rc.10'],
    expected: ['0.2.2-rc.10', '0.2.2', '0.3.0'],
  },
  {
    name: 'retires an older out-of-range prerelease after an admitted stable release',
    versions: ['0.2.2-alpha.3', '0.2.2'],
    expected: ['0.2.2'],
  },
  {
    name: 'ignores verified, known-broken, invalid and older versions',
    versions: ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.2-alpha.2', 'not-a-version', '0.2.0', '0.2.1-rc.1'],
    expected: [],
  },
  { name: 'handles an empty registry without dropping the verified baseline', versions: [], expected: [] },
])('$name', async ({ versions, expected }) => {
  assert.deepEqual(await targets(versions), expected)
})

test('an explicit host can still probe an old alpha without registry access', async () => {
  assert.deepEqual(await targets([], ['--host', '0.2.2-alpha.3']), ['0.2.2-alpha.3'])
})

test('invalid manual versions and registry failures remain errors', async () => {
  await assert.rejects(targets([], ['--host', 'invalid']), /Invalid --host version/)
  await assert.rejects(targets([], [], 503), /Registry metadata request failed \(HTTP 503\)/)
})
