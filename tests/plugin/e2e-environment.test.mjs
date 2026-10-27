import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { browserExecutable, settingsShortcut, fixtureEnvironment, dataSnapshot } from './fixtures/e2e-environment.mjs'

test('browser fixtures use the actual platform settings binding and browser fallback', () => {
  assert.equal(settingsShortcut('win32'), 'Control+Alt+Comma')
  assert.equal(settingsShortcut('linux'), undefined)
  assert.equal(settingsShortcut('darwin'), 'Meta+Alt+Comma')
  assert.equal(browserExecutable('linux', ''), '')
  assert.equal(browserExecutable('linux', null), undefined)
  assert.equal(browserExecutable('darwin', null), undefined)
  assert.equal(browserExecutable('darwin', '/custom/browser'), '/custom/browser')
  assert.match(browserExecutable('win32', null), /msedge\.exe$/)
})

test('fixture environment isolates home, clears module injection and removes inherited paid credentials', () => {
  const source = { DSH_HOME: '/source', NODE_OPTIONS: '--import=paid-provider', NODE_PATH: '/source/node_modules', DEEPSEEK_API_KEY: 'secret', PATH: '/runtime/bin' }
  const fixture = fixtureEnvironment('/scratch', source)
  assert.equal(fixture.DSH_HOME, '/scratch')
  assert.equal(fixture.NODE_OPTIONS, '')
  assert.equal(fixture.NODE_PATH, '')
  assert.equal(fixture.DEEPSEEK_API_KEY, undefined)
  assert.equal(fixture.PATH, source.PATH)
  assert.equal(source.DSH_HOME, '/source')
  assert.equal(source.DEEPSEEK_API_KEY, 'secret')
})

test('consumer data evidence detects changed settings and sessions without hashing dependency trees', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'modern-ui-isolation-'))
  try {
    await mkdir(path.join(home, 'profiles', 'consumer', 'node_modules'), { recursive: true })
    await mkdir(path.join(home, 'sessions'))
    await writeFile(path.join(home, 'profiles', 'consumer', 'cordis.patch.yml'), '[]')
    await writeFile(path.join(home, 'profiles', 'consumer', 'node_modules', 'ignored'), 'package')
    await writeFile(path.join(home, 'sessions', 'source.jsonl'), 'original session')
    const before = await dataSnapshot(home)
    assert.equal(Object.keys(before).length, 2)
    await writeFile(path.join(home, 'profiles', 'consumer', 'node_modules', 'ignored'), 'rebuilt package')
    assert.deepEqual(await dataSnapshot(home), before)
    await writeFile(path.join(home, 'sessions', 'source.jsonl'), 'changed session')
    assert.notDeepEqual(await dataSnapshot(home), before)
    await writeFile(path.join(home, 'profiles', 'consumer', 'cordis.patch.yml'), '- language: ja')
    assert.notEqual((await dataSnapshot(home))[path.join('profiles', 'consumer', 'cordis.patch.yml')], before[path.join('profiles', 'consumer', 'cordis.patch.yml')])
  } finally { await rm(home, { recursive: true, force: true }) }
})
