import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const source = fileURLToPath(new URL('../../scripts/distribution/', import.meta.url))
const preview = process.env.MODERN_UI_ROOT_PREVIEW ? resolve(process.env.MODERN_UI_ROOT_PREVIEW) : undefined
const posix = process.platform !== 'win32'
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-root-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const base = join(directory, 'user data 空格')
  await mkdir(base)
  return { directory, base }
}
async function stagedInstaller(directory) {
  const entry = join(directory, 'entry')
  const installer = preview ? join(entry, 'installer') : entry
  await cp(preview ?? source, entry, { recursive: true })
  await writeFile(join(installer, 'manager.mjs'), `export const versions = { node: '24.22.1' }
export async function main(args) { return { args } }
`)
  return { entry, installer }
}
function dispatchJs(staged, environment, root) {
  return spawnSync(process.execPath, [join(staged.entry, 'install-existing.mjs'), '--backend', 'official.json',
    ...(preview ? [] : ['--plugin', 'plugin.tgz', '--plugin-integrity', 'sha512-fixture']),
    '--skip-community', 'true', ...(root ? ['--root', root] : [])], { encoding: 'utf8', env: environment })
}
function dispatchShell(staged, environment, root) {
  return spawnSync('sh', [join(staged.entry, 'install-existing.sh'), 'official.json',
    ...(preview ? [] : ['plugin.tgz', 'sha512-fixture']), ...(root ? [root] : [])], { encoding: 'utf8', env: environment })
}
function core(result) {
  assert.equal(result.status, 0, result.stderr)
  const values = JSON.parse('[' + result.stdout.trim().replace(/}\s*{/g, '},{') + ']')
  return values.find(value => value.phase === 'core').result.args
}

test('actual JavaScript installer retains selected data and honors explicit roots on every host', async t => {
  const { directory, base } = await fixture(t)
  const installer = await stagedInstaller(directory)
  const root = join(base, 'explicit program')
  const retained = join(base, 'retained data')
  await mkdir(root)
  await writeFile(join(root, 'current.json'), JSON.stringify({ home: retained }))
  const result = dispatchJs(installer, process.env, root)
  const args = core(result)
  assert.equal(args[args.indexOf('--root') + 1], root)
  assert.equal(args[args.indexOf('--home') + 1], retained)
})

test('entries reached through a symbolic link still run instead of exiting silently', { skip: !posix }, async t => {
  const { directory, base } = await fixture(t)
  const installer = await stagedInstaller(directory)
  // Node canonicalizes the main entry (macOS os.tmpdir() lives under the /var link), so the
  // caller's spelling and import.meta.url differ; the scripts must still recognize themselves.
  const linked = join(directory, 'linked entry')
  await symlink(installer.entry, linked, 'dir')
  const viaLink = { entry: linked, installer: preview ? join(linked, 'installer') : linked }
  const root = join(base, 'explicit program')
  const environment = { ...process.env, DSH_MODERN_NODE: process.execPath, DSH_MODERN_SKIP_COMMUNITY: '1' }
  for (const result of [dispatchJs(viaLink, environment, root), dispatchShell(viaLink, environment, root)]) {
    const args = core(result)
    assert.equal(args[args.indexOf('--root') + 1], root)
  }
})

test('actual POSIX entries refuse two distinct existing application directories before installation', { skip: !posix }, async t => {
  const { directory, base } = await fixture(t)
  const installer = await stagedInstaller(directory)
  const canonical = join(base, 'dsh-modern-ui')
  const legacy = join(base, 'DSH-Modern-UI')
  await mkdir(canonical)
  if (existsSync(legacy)) return t.skip('Requires case-sensitive directories')
  await mkdir(legacy)
  const environment = { ...process.env, XDG_DATA_HOME: base, DSH_MODERN_NODE: process.execPath, DSH_MODERN_SKIP_COMMUNITY: '1' }
  const results = [
    dispatchShell(installer, environment),
    dispatchJs(installer, environment),
  ]
  for (const result of results) {
    assert.notEqual(result.status, 0, `Ambiguous root must fail before calling the manager: ${result.stdout}`)
    assert.match(result.stderr, /Both .*explicit program root/)
    assert.equal(result.stdout, '')
  }
})

test('actual POSIX shell and JavaScript entries agree for fresh, retained, ambiguous and explicit roots', { skip: !posix }, async t => {
  const { directory, base } = await fixture(t)
  const installer = await stagedInstaller(directory)
  const environment = { ...process.env, XDG_DATA_HOME: base, DSH_MODERN_NODE: process.execPath, DSH_MODERN_SKIP_COMMUNITY: '1' }
  const runShell = root => dispatchShell(installer, environment, root)
  const runJs = root => dispatchJs(installer, environment, root)
  const assertRoot = expected => {
    for (const result of [runShell(), runJs()]) {
      const args = core(result)
      assert.equal(args[args.indexOf('--root') + 1], expected)
      assert.equal(dirname(args[args.indexOf('--home') + 1]), dirname(expected))
    }
  }
  assertRoot(join(base, 'dsh-modern-ui/program'))
  const legacy = join(base, 'DSH-Modern-UI/program')
  await mkdir(legacy, { recursive: true })
  if (existsSync(join(base, 'dsh-modern-ui'))) return t.skip('Distinct-directory cases require a case-sensitive filesystem; fresh dispatch passed')
  const retained = join(base, 'original data')
  await writeFile(join(legacy, 'current.json'), JSON.stringify({ home: retained }))
  for (const result of [runShell(), runJs()]) {
    const args = core(result)
    assert.equal(args[args.indexOf('--root') + 1], legacy)
    assert.equal(args[args.indexOf('--home') + 1], retained)
  }
  await mkdir(join(base, 'dsh-modern-ui'))
  for (const result of [runShell(), runJs()]) {
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Both .*explicit program root/)
    assert.equal(result.stdout, '')
  }
  for (const result of [runShell(legacy), runJs(legacy)]) {
    const args = core(result)
    assert.equal(args[args.indexOf('--home') + 1], retained)
  }
  // A bootstrap stand-in records dispatch before any download or installation.
  await writeFile(join(installer.installer, 'bootstrap.sh'), '#!/bin/sh\nprintf "%s\\n" "$@"\n')
  environment.DSH_MODERN_NODE = join(directory, 'no node')
  assert.notEqual(runShell().status, 0)
  const fallback = runShell(legacy)
  assert.equal(fallback.status, 0, fallback.stderr)
  assert.equal(fallback.stdout.split('\n')[0], legacy)
  await rm(join(base, 'dsh-modern-ui'), { recursive: true })
  const retainedFallback = runShell()
  assert.equal(retainedFallback.status, 0, retainedFallback.stderr)
  assert.equal(retainedFallback.stdout.split('\n')[0], legacy)
  await symlink(dirname(legacy), join(base, 'dsh-modern-ui'), 'dir')
  environment.DSH_MODERN_NODE = process.execPath
  for (const result of [runShell(), runJs()]) {
    const args = core(result)
    assert.equal(args[args.indexOf('--root') + 1], join(base, 'dsh-modern-ui/program'))
    assert.equal(args[args.indexOf('--home') + 1], retained)
  }
})
