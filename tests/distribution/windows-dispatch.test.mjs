import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { installEntrypoint, privatePnpm, runtimeEnvironment } from '../../scripts/distribution/manager.mjs'

test('private pnpm dispatch is self-contained under scrubbed environment and code page 932', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-'))
  try {
    const generation = join(root, 'program space \u7a7a\u683c')
    await mkdir(generation)
    const pnpm = join(generation, 'package \u6570\u636e.cjs')
    const receipt = join(root, 'argv.json')
    await writeFile(pnpm, 'require("node:fs").writeFileSync(process.env.DSH_TEST_ARGV, JSON.stringify(process.argv.slice(2)))')
    const state = { generation, root, home: root, node: process.execPath, pnpm }
    await privatePnpm(state)
    const text = await readFile(join(generation, 'bin/pnpm.cmd'), 'utf8')
    assert.match(text, /^[\x00-\x7f]*$/)
    assert.match(await readFile(join(generation, 'bin/pnpm.ps1'), 'utf8'), /^[\x00-\x7f]*$/)
    const runtime = runtimeEnvironment(state)
    const env = Object.fromEntries(['SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'PATH'].filter(key => runtime[key]).map(key => [key, runtime[key]]))
    env.DSH_TEST_ARGV = receipt
    const result = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', 'chcp 932>nul & pnpm.cmd "space arg" "\u4e2d\u6587" "amp & char" "semi;colon" "dollar$" "tick`" "paren()" "percent%"'], { cwd: join(generation, 'bin'), env, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(receipt, 'utf8')), ['space arg', '\u4e2d\u6587', 'amp & char', 'semi;colon', 'dollar$', 'tick`', 'paren()', 'percent%'])
    assert.equal(env.DSH_MODERN_PRIVATE_NODE, undefined)
    assert.equal(env.DSH_MODERN_PRIVATE_PNPM, undefined)
    assert.deepEqual(JSON.parse(await readFile(join(generation, 'bin/runtime.json'), 'utf8')), { node: process.execPath, pnpm })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('managed launcher upgrades atomically and dispatches Unicode/quoted CLI arguments under code page 932', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-launch-'))
  try {
    const root = join(scratch, 'program space \u7a7a\u683c')
    const generation = join(root, 'versions', 'test-generation')
    await mkdir(generation, { recursive: true })
    await writeFile(join(root, 'current.json'), JSON.stringify({ node: process.execPath }))
    await writeFile(join(root, 'dsh-ui.cmd'), '@echo off\r\nrem DSH Modern UI managed dispatcher\r\nexit /b 99\r\n')
    await installEntrypoint({ root, generation, node: process.execPath })
    for (const name of ['dsh-ui.cmd', 'launch.ps1']) assert.match(await readFile(join(root, name), 'utf8'), /^[\x00-\x7f]*$/)
    const receipt = join(scratch, 'argv.json')
    await writeFile(join(root, 'launch.mjs'), 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.DSH_TEST_ARGV, JSON.stringify(process.argv.slice(2)))')
    const result = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', 'chcp 932>nul & dsh-ui.cmd "space arg" "\u4e2d\u6587" "amp & char" "semi;colon" "dollar$" "tick`" "paren()" "percent%" "quote\\"inside" "trailing slash\\\\"'], { cwd: root, env: { ...process.env, DSH_TEST_ARGV: receipt }, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(receipt, 'utf8')), ['space arg', '\u4e2d\u6587', 'amp & char', 'semi;colon', 'dollar$', 'tick`', 'paren()', 'percent%', 'quote"inside', 'trailing slash\\'])
    await writeFile(join(root, 'launch.mjs'), '// DSH Modern UI managed dispatcher\n')
    await writeFile(join(root, 'dsh-ui.cmd'), '@echo off\r\nrem unrelated user launcher\r\n')
    await assert.rejects(installEntrypoint({ root, generation: join(root, 'versions', 'next'), node: process.execPath }), /unrelated entrypoint/)
    assert.match(await readFile(join(root, 'dsh-ui.cmd'), 'utf8'), /unrelated user launcher/)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
