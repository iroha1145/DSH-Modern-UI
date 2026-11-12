import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { build, transform } from 'esbuild'
import { test } from 'vitest'
import { emitClientChunks } from '../../scripts/client-chunks.mjs'

const require = createRequire(import.meta.url)
const hostRequire = process.env.COMPAT_BACKEND_PACKAGE ? createRequire(path.resolve(process.env.COMPAT_BACKEND_PACKAGE)) : require
const owner = '@test/chunks'

test('split factories use the official loader, share state, deduplicate requests, surface failures and reload together', async () => {
  await mkdir(path.resolve('.artifacts'), { recursive: true })
  const directory = await mkdtemp(path.resolve('.artifacts/client-chunks-'))
  try {
    await mkdir(path.join(directory, 'src'))
    await mkdir(path.join(directory, 'lib'))
    const sources = {
      'client.tsx': `import {state,loadNested} from './shared'; export {state,loadNested}; export const first=()=>import('./first'); export const second=()=>import('./second'); export const broken=()=>import('./broken');`,
      'shared.ts': `export const state={count:0}; export const loadNested=()=>import('./nested');`,
      'nested.ts': `export const value=42;`,
      'lazy-shared.ts': `export const lazyState={count:0};`,
      'first.ts': `import {state} from './shared'; import {lazyState} from './lazy-shared'; state.count++; lazyState.count++; export {state,lazyState};`,
      'second.ts': `import {state} from './shared'; import {lazyState} from './lazy-shared'; export {state,lazyState};`,
      'broken.ts': `throw new Error('optional feature failed'); export const unused=1;`,
    }
    for (const [name, source] of Object.entries(sources)) await writeFile(path.join(directory, 'src', name), source)
    const result = await build({
      absWorkingDir: directory,
      entryPoints: ['src/client.tsx'],
      outdir: 'lib',
      entryNames: 'client',
      chunkNames: 'client.[name]-[hash]',
      bundle: true,
      format: 'esm',
      splitting: true,
      write: false,
      metafile: true,
    })
    const metafile = await emitClientChunks(directory, owner, result, transform)
    assert.ok(Object.keys(metafile.outputs).length > 3)
    const target = { mode: 'queue', pendingQueue: [], load: undefined }
    const context = createContext({ window: { __ModuleLoader__: { load: registration => target.pendingQueue.push(registration) } } })
    runInContext(await readFile(hostRequire.resolve('@deepseek-ai/dsh-client-modules/client'), 'utf8'), context)
    const bootstrap = target.pendingQueue.pop()
    const runtime = bootstrap.factory(() => {
      throw new Error('Unexpected platform dependency')
    })
    context.window.__ModuleLoader__ = target
    const requests: string[] = []
    let rejectNext = false
    const loader = new runtime.ClientModuleSystem({
      manifest: {
        rev: 'test',
        plugins: [],
        modules: [
          {
            id: owner,
            rev: 'test',
            url: `/plugins/??${owner}/client.js&rev=test`,
            initialUrl: `/plugins/??${owner}/client.js&rev=test`,
            inject: [],
            external: [],
          },
        ],
      },
      staticModules: {},
      registrationTarget: target,
      bootstrapModule: { id: bootstrap.id, exports: runtime },
      loadBundle: async url => {
        requests.push(url)
        if (rejectNext) {
          rejectNext = false
          throw new Error('transport failed')
        }
        const file = url.includes('/??') ? 'client.js' : path.basename(new URL(url, 'http://host').pathname)
        runInContext(await readFile(path.join(directory, 'lib', file), 'utf8'), context)
      },
    })
    const entry = await loader.import(owner)
    assert.equal(requests.length, 1)
    assert.equal(entry.state.count, 0)
    assert.equal((await entry.loadNested()).value, 42)
    rejectNext = true
    await assert.rejects(entry.first(), /transport failed/)
    const [first, again] = await Promise.all([entry.first(), entry.first()])
    assert.equal(first, again)
    assert.equal(first.state, entry.state)
    assert.equal(first.lazyState.count, 1)
    const before = requests.length
    assert.equal((await entry.first()).state.count, 1)
    assert.equal(requests.length, before)
    const second = await entry.second()
    assert.equal(second.state, entry.state)
    assert.equal(second.lazyState, first.lazyState)
    await assert.rejects(entry.broken(), /optional feature failed/)
    loader.invalidate(owner, 'new')
    const reloaded = await loader.import(owner)
    assert.notEqual(reloaded.state, entry.state)
    assert.equal((await reloaded.first()).state.count, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
