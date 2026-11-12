import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { build } from './helpers/client-build.mjs'
import { afterAll, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')
const source = 'packages/modern-ui/src/vendor/translation/client/translation.ts'
const directory = await mkdtemp(path.join(tmpdir(), 'translation-limits-'))
const modulePath = path.join(directory, 'translation.cjs')
const baseline = process.env.TRANSLATION_LIMITS_BASELINE_REF
await build({
  ...(baseline
    ? { stdin: { contents: execFileSync('git', ['show', `${baseline}:${source}`], { cwd: root, encoding: 'utf8' }), resolveDir: root, loader: 'ts' } }
    : { entryPoints: [path.join(root, source)] }),
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
afterAll(() => rm(directory, { recursive: true, force: true }))

// Bad limits used to spin synchronously: the parent bounds both runtime and the worker heap.
function fragments(text, running, limit) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads');
       const {reasoningFragments}=require(workerData.modulePath);
       parentPort.postMessage(reasoningFragments(workerData.text,workerData.running,workerData.limit));`,
      { eval: true, workerData: { modulePath, text, running, limit }, resourceLimits: { maxOldGenerationSizeMb: 32 } },
    )
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('Translation fragment worker exceeded its deadline'))
    }, 5000)
    worker.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    worker.once('message', value => {
      clearTimeout(timer)
      void worker.terminate().then(() => resolve(value), reject)
    })
  })
}

test.each([
  [0, 1],
  [-1, 1],
  [0.5, 1],
  [1.5, 1],
  [NaN, 4000],
  [Infinity, 4000],
  [-Infinity, 4000],
])('normalizes invalid or fractional limit %s without losing source text', async (limit, maximum) => {
  const text = '😀A B\n\nC😀D' + 'x'.repeat(4001)
  const parts = await fragments(text, true, limit)
  assert.equal(parts.map(part => part.text + part.suffix).join(''), text)
  assert.ok(parts.every(part => part.text.length <= maximum))
  assert.equal(parts.at(-1).complete, false)
})

test('valid UTF-16 limits retain whitespace, surrogate pairs and completed paragraph boundaries', async () => {
  const text = 'a😀b\n\nC  D'
  const parts = await fragments(text, false, 2)
  assert.deepEqual(
    parts.map(part => part.text),
    ['a', '😀', 'b', 'C', 'D'],
  )
  assert.equal(parts.map(part => part.text + part.suffix).join(''), text)
  assert.ok(parts.every(part => part.complete))
})
