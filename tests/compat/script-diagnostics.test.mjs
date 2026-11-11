import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { containsPath } from '../../scripts/distribution/contains-path.mjs'
import { ensurePreviewDependency } from '../../scripts/preview-dependency.mjs'

const execute = promisify(execFile)
const repo = path.resolve(import.meta.dirname, '../..')
const artifacts = path.join(repo, '.artifacts')
await mkdir(artifacts, { recursive: true })
const scratch = await mkdtemp(path.join(artifacts, 'script-diagnostics-'))
const entrypoint = pathToFileURL(path.join(repo, 'scripts/distribution/entrypoint.mjs')).href
const preview = pathToFileURL(path.join(repo, 'scripts/preview-dependency.mjs')).href
const gate = path.join(scratch, 'gate.mjs')
await writeFile(gate, `import {isMainModule} from ${JSON.stringify(entrypoint)}; console.log(isMainModule(import.meta.url)?'MAIN':'IMPORTED')`)
afterAll(async () => {
  assert.ok(scratch.startsWith(artifacts + path.sep))
  await rm(scratch, { recursive: true, force: true })
})

async function run(args, options = {}) {
  try {
    const result = await execute(process.execPath, args, { cwd: repo, windowsHide: true, timeout: 30_000, ...options })
    return { ...result, code: 0 }
  } catch (error) {
    if (typeof error.code !== 'number') throw error
    return { stdout: error.stdout, stderr: error.stderr, code: error.code }
  }
}

test('entrypoint distinguishes direct and linked CLI entry from eval and stdin imports', async () => {
  assert.equal((await run([gate])).stdout.trim(), 'MAIN')
  const link = path.join(scratch, 'linked')
  const source = path.join(scratch, 'source')
  await mkdir(source)
  await writeFile(path.join(source, 'main.mjs'), await readFile(gate))
  await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await run([path.join(link, 'main.mjs')])).stdout.trim(), 'MAIN')
  const statement = `import ${JSON.stringify(pathToFileURL(gate).href)}`
  assert.equal((await run(['--input-type=module', '-e', statement])).stdout.trim(), 'IMPORTED')
  const stdin = await new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ['--input-type=module', '-'], { cwd: repo, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
    child.stdin.end(statement)
  })
  assert.equal(stdin.stdout.trim(), 'IMPORTED')
  const nonexistent = await run([
    '--input-type=module',
    '-e',
    `process.argv[1]=${JSON.stringify(path.join(scratch, 'absent'))}; await import(${JSON.stringify(pathToFileURL(gate).href)})`,
  ])
  assert.equal(nonexistent.code, 0)
  assert.equal(nonexistent.stdout.trim(), 'IMPORTED')
})

test('unexpected argv and module normalization failures are visible failures, never successful silent exits', async () => {
  for (const failAt of [1, 2]) {
    const faulty = path.join(scratch, `fault-${failAt}.mjs`)
    await writeFile(
      faulty,
      `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
import {isMainModule} from ${JSON.stringify(entrypoint)};
const original=fs.realpathSync; let calls=0;
fs.realpathSync=(...args)=>{if(++calls===${failAt})throw Object.assign(new Error('normalization EIO ${failAt}'),{code:'EIO'});return original(...args)};
syncBuiltinESMExports(); if(isMainModule(import.meta.url))console.log('BUSINESS EXECUTED');`,
    )
    const result = await run([faulty])
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, new RegExp(`normalization EIO ${failAt}`))
    assert.match(result.stderr, /entrypoint\.mjs/)
    assert.doesNotMatch(result.stdout, /BUSINESS EXECUTED/)
  }
})

test('prompt checks distinguish absent, stale, matching and unreadable files without writing after a read fault', async () => {
  const hook = path.join(scratch, 'prompt-read.mjs')
  await writeFile(
    hook,
    `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFile,write=fs.writeFile;const mode=process.env.PROMPT_READ_FIXTURE;
fs.readFile=async(file,...args)=>{if(String(file).endsWith('system-prompt.generated.ts')) {
if(mode==='stale')return 'old';if(mode==='ENOENT'||mode==='EIO'||mode==='EACCES')throw Object.assign(new Error('prompt read '+mode),{code:mode});}
return read(file,...args)};
fs.writeFile=async(file,...args)=>{if(String(file).endsWith('system-prompt.generated.ts')){console.log('GENERATED WRITE');return}return write(file,...args)};
syncBuiltinESMExports();`,
  )
  for (const mode of ['match', 'stale', 'ENOENT', 'EIO', 'EACCES']) {
    for (const check of [true, false]) {
      const result = await run(['--import', pathToFileURL(hook).href, 'scripts/generate-openui-prompt.mjs', ...(check ? ['--check'] : [])], {
        env: { ...process.env, PROMPT_READ_FIXTURE: mode },
      })
      if (mode === 'EIO' || mode === 'EACCES') {
        assert.notEqual(result.code, 0)
        assert.match(result.stderr, new RegExp('prompt read ' + mode))
        assert.doesNotMatch(result.stderr + result.stdout, /is stale|up to date|GENERATED WRITE|Wrote/)
      } else {
        assert.equal(result.code, check && mode !== 'match' ? 1 : 0, result.stderr)
        if (check && mode !== 'match') assert.match(result.stderr, /is stale/)
        assert.equal(result.stdout.includes('GENERATED WRITE'), !check && mode !== 'match')
      }
    }
  }
})

test('preview links create only missing entries and preserve correct, wrong and dangling paths', async () => {
  const target = path.join(scratch, 'preview-target')
  const other = path.join(scratch, 'preview-other')
  const destination = path.join(scratch, 'dependency')
  await mkdir(target)
  await mkdir(other)
  await ensurePreviewDependency(target, destination)
  assert.equal(await realpath(destination), await realpath(target))
  await ensurePreviewDependency(target, destination)
  await assert.rejects(ensurePreviewDependency(other, destination), /Unexpected preview dependency/)
  assert.equal(await realpath(destination), await realpath(target))
  const dangling = path.join(scratch, 'dangling')
  const absent = path.join(scratch, 'absent-target')
  await symlink(absent, dangling, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    ensurePreviewDependency(target, dangling),
    error => error.message.includes('Dangling preview dependency') && error.cause.code === 'ENOENT',
  )
  const hook = path.join(scratch, 'preview-io.mjs')
  await writeFile(
    hook,
    `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const original=fs.realpath;fs.realpath=async(file,...args)=>{if(file===${JSON.stringify(destination)})throw Object.assign(new Error('preview original EIO'),{code:'EIO'});return original(file,...args)};
syncBuiltinESMExports();`,
  )
  const result = await run([
    '--import',
    pathToFileURL(hook).href,
    '--input-type=module',
    '-e',
    `import {ensurePreviewDependency} from ${JSON.stringify(preview)};await ensurePreviewDependency(${JSON.stringify(target)},${JSON.stringify(destination)})`,
  ])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /preview original EIO/)
  assert.doesNotMatch(result.stderr, /EEXIST/)
  assert.equal(await realpath(destination), await realpath(target))
})

test('program/data containment retains equality, parent, sibling and platform boundaries', () => {
  assert.equal(containsPath(scratch, scratch), true)
  assert.equal(containsPath(scratch, path.join(scratch, 'child')), true)
  assert.equal(containsPath(path.join(scratch, 'child'), scratch), false)
  assert.equal(containsPath(path.join(scratch, 'app'), path.join(scratch, 'app-data')), false)
  assert.equal(containsPath(scratch, path.join(scratch, '..x')), true)
  if (process.platform === 'win32') assert.equal(containsPath('C:\\app', 'D:\\app\\data'), false)
})
