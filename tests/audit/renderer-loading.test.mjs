import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { build, transform } from 'esbuild'
import { JSDOM } from 'jsdom'
import { act, cloneElement, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, test } from 'vitest'
import { chromium } from 'playwright-core'
import { highlightWorkerPlugin } from '../../scripts/highlight-worker.mjs'
import { emitClientChunks } from '../../scripts/client-chunks.mjs'

const require = createRequire(import.meta.url)
const repo = path.resolve(import.meta.dirname, '../..')
const source = name => path.join(repo, 'packages/modern-ui/src', name)
const directory = await mkdtemp(path.join(repo, '.artifacts/renderer-loading-'))
await mkdir(path.join(directory, 'src'))
await mkdir(path.join(directory, 'lib'))
await writeFile(
  path.join(directory, 'src/client.tsx'),
  `export {OpenUILoader} from ${JSON.stringify(source('vendor/intelligent/client/OpenUILoader.tsx'))}; export {renderTexToReact} from ${JSON.stringify(source('vendor/primitives/markdown/LazyMath.tsx'))}; export {CodeBlock} from ${JSON.stringify(source('vendor/primitives/markdown/CodeBlock.tsx'))}; export {ReadBlock} from ${JSON.stringify(source('vendor/primitives/ReadBlock.tsx'))}; export {isGrammarLoaded,subscribeGrammarLoaded} from ${JSON.stringify(source('vendor/primitives/markdown/highlight.ts'))};`,
)
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
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    highlightWorkerPlugin(build),
    {
      name: 'renderer-loading-fixture',
      setup(builder) {
        builder.onLoad({ filter: /[/\\](OpenUIBlock|MathContent)\.tsx$/ }, args => ({
          loader: 'tsx',
          resolveDir: repo,
          contents: args.path.endsWith('OpenUIBlock.tsx')
            ? `export function OpenUIBlock({code}) {return <div data-loaded="openui">{code}</div>}`
            : `export default function MathContent({value}) {return <span data-loaded="math">{value}</span>}`,
        }))
        builder.onLoad({ filter: /MathLoad\.module\.css$/ }, () => ({ contents: 'export default {source:"math-source",failure:"math-failure"}', loader: 'js' }))
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default {}', loader: 'js' }))
      },
    },
  ],
})
const owner = '@test/renderer-loading'
await emitClientChunks(directory, owner, result, transform)
afterAll(() => rm(directory, { recursive: true, force: true }))

async function fixture(kind, mode, run) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'http://host/' })
  const previous = Object.getOwnPropertyDescriptors(globalThis)
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const target = { mode: 'queue', pendingQueue: [], load: undefined }
  dom.window.__ModuleLoader__ = { load: registration => target.pendingQueue.push(registration) }
  let workerCreations = 0
  class CountedWorker extends Worker {
    constructor(...args) {
      super(...args)
      workerCreations += 1
    }
  }
  const context = createContext({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Error,
    AbortController,
    Worker: CountedWorker,
    URL,
    Blob,
    DOMException,
    performance,
    setTimeout,
    clearTimeout,
  })
  runInContext(await readFile(require.resolve('@deepseek-ai/dsh-client-modules/client'), 'utf8'), context)
  const bootstrap = target.pendingQueue.pop()
  const runtime = bootstrap.factory(() => {
    throw new Error('Unexpected platform dependency')
  })
  context.window.__ModuleLoader__ = target
  const requests = []
  let pending
  let announcePending
  const pendingStarted = new Promise(resolve => {
    announcePending = resolve
  })
  let transfer
  const featureName = kind === 'openui' ? 'OpenUIBlock' : kind === 'math' ? 'MathContent' : 'highlight.worker'
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
    staticModules: {
      react: require('react'),
      'react/jsx-runtime': require('react/jsx-runtime'),
      'react-dom': require('react-dom'),
      '@deepseek-ai/dsh-client-ui-primitives': { pointerModality: () => false },
    },
    registrationTarget: target,
    bootstrapModule: { id: bootstrap.id, exports: runtime },
    loadBundle: url => {
      const operation = (async () => {
        const feature = url.includes(`client.${featureName}-`)
        if (feature) {
          requests.push(url)
          if (requests.length === 1 && mode === 'fail-first') throw new Error(`client-modules: bundle script ${url} failed to load`)
          if (mode === 'pending')
            await new Promise((resolve, reject) => {
              pending = { resolve, reject, url }
              announcePending()
            })
        }
        const file = url.includes('/??') ? 'client.js' : path.basename(new URL(url, 'http://host').pathname)
        runInContext(await readFile(path.join(directory, 'lib', file), 'utf8'), context)
      })()
      if (url.includes(`client.${featureName}-`)) transfer = operation
      return operation
    },
  })
  const entry = await loader.import(owner)
  const root = createRoot(document.getElementById('root'))
  const original =
    kind === 'openui'
      ? 'root = Text("preserved source")'
      : kind === 'math'
        ? 'x^2 + y^2'
        : mode === 'pending'
          ? Array.from({ length: 120 }, (_, index) => `const source${index}: number = ${index}`).join('\n')
          : 'const source: number = 42'
  const copy = { title: 'Interactive component', preparingView: 'Preparing view', partial: 'Some content could not be shown', restartView: 'Restart view' }
  const content =
    kind === 'openui'
      ? createElement(entry.OpenUILoader, { code: original, labels: { copyLabel: 'Copy', copiedLabel: 'Copied' }, t: key => copy[key] })
      : kind === 'math'
        ? entry.renderTexToReact(original, false)
        : kind === 'highlight-code'
          ? createElement(entry.CodeBlock, { code: original, lang: 'ts', copyLabel: 'Copy', copiedLabel: 'Copied' })
          : createElement(entry.ReadBlock, {
              lines: original.split('\n').map((text, index) => ({ number: index + 1, text })),
              totalLines: original.split('\n').length,
              lang: 'ts',
              labels: {
                codeLabel: 'Code',
                copy: 'Copy',
                copied: 'Copied',
                wrapLabel: 'Wrap',
                unwrapLabel: 'Unwrap',
                window: () => '1/1',
                collapseAria: 'Collapse',
                expandAria: count => `Expand ${count}`,
                collapse: 'Collapse',
                expand: count => `Expand ${count}`,
              },
            })
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))
  try {
    await act(async () => {
      root.render(createElement('div', {}, createElement('p', {}, 'Earlier answer'), content, createElement('p', {}, 'Later answer')))
      await flush()
    })
    if (mode === 'pending' && kind.startsWith('highlight-')) await act(() => pendingStarted)
    const ready = () =>
      !kind.startsWith('highlight-') || entry.isGrammarLoaded('ts')
        ? Promise.resolve()
        : new Promise(resolve => {
            const stop = entry.subscribeGrammarLoaded('ts', () => {
              if (entry.isGrammarLoaded('ts')) {
                stop()
                resolve()
              }
            })
          })
    const refresh = () =>
      root.render(createElement('div', {}, createElement('p', {}, 'Earlier answer'), cloneElement(content), createElement('p', {}, 'Later answer')))
    await run({
      root,
      requests,
      pending: () => pending,
      transfer: () => transfer,
      original,
      flush,
      ready,
      refresh,
      tokenizations: () => workerCreations,
    })
  } finally {
    await act(() => root.unmount())
    for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
      else delete globalThis[key]
    }
    dom.window.close()
  }
}

test('real script transport preserves failed narrow math and defers the engine until the first code request', async () => {
  const bootstrap = await build({
    stdin: {
      resolveDir: repo,
      contents: `import * as React from 'react'; import * as ReactDOM from 'react-dom'; import {createRoot} from 'react-dom/client';
const target=window.__ModuleLoader__, bootstrap=target.pendingQueue.pop(), runtime=bootstrap.factory(()=>{throw new Error('Unexpected dependency')});
const modules=new runtime.ClientModuleSystem({manifest:{rev:'test',plugins:[],modules:[{id:${JSON.stringify(owner)},rev:'test',url:'/plugins/??${owner}/client.js&rev=test',initialUrl:'/plugins/??${owner}/client.js&rev=test',inject:[],external:[]}]},staticModules:{react:React,'react/jsx-runtime':await import('react/jsx-runtime'),'react-dom':ReactDOM,'@deepseek-ai/dsh-client-ui-primitives':{pointerModality:()=>false}},registrationTarget:target,bootstrapModule:{id:bootstrap.id,exports:runtime}});
const entry=await modules.import(${JSON.stringify(owner)});
const view=new URLSearchParams(location.search).get('view');
window.codeTimings={started:performance.now(),longTasks:[],rafMaxGapMs:0,inputEvents:[]};
const input=document.createElement('input');input.setAttribute('aria-label','Message');input.onkeydown=event=>{const sample={delayMs:performance.now()-event.timeStamp,whileWorkerPending:!document.querySelector('.shiki')};window.codeTimings.inputEvents.push(sample);requestAnimationFrame(()=>sample.nextFrameMs=performance.now()-event.timeStamp)};document.body.prepend(input);
if(view==='code'){
const timings=window.codeTimings;
new MutationObserver(()=>{const pre=document.querySelector('pre');if(pre&&timings.plain===undefined)timings.plain=performance.now();if(document.querySelector('.shiki')&&timings.colored===undefined)timings.colored=performance.now()}).observe(document.getElementById('root'),{childList:true,subtree:true});
const collect=entries=>timings.longTasks.push(...entries.map(entry=>({startTime:entry.startTime,duration:entry.duration})));
const observer=new PerformanceObserver(list=>collect(list.getEntries()));observer.observe({entryTypes:['longtask']});
let previous=timings.started;
const frame=()=>{const now=performance.now();timings.rafMaxGapMs=Math.max(timings.rafMaxGapMs,now-previous);previous=now;if(timings.plain!==undefined&&timings.colored===undefined&&timings.plainFrame===undefined)timings.plainFrame=now;if(timings.colored===undefined)requestAnimationFrame(frame)};requestAnimationFrame(frame);
window.finishCodeMeasurement=()=>{collect(observer.takeRecords());observer.disconnect();timings.longTasks=timings.longTasks.filter(task=>task.startTime>=timings.started&&task.startTime<=timings.colored);timings.longTaskTotalMs=timings.longTasks.reduce((sum,task)=>sum+task.duration,0);timings.longTaskMaxMs=Math.max(0,...timings.longTasks.map(task=>task.duration));return timings};
}
const body=view==='idle'?React.createElement('p',{},'No code'):view==='code'?React.createElement(entry.CodeBlock,{code:'const cold: number = 42',lang:'ts',copyLabel:'Copy',copiedLabel:'Copied'}):entry.renderTexToReact('x_'.repeat(3000),true,{failed:'Formula unavailable; source preserved',retry:'Retry formula'});
createRoot(document.getElementById('root')).render(React.createElement('article',{},body));`,
    },
    bundle: true,
    format: 'esm',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await readFile(source('vendor/primitives/markdown/MathLoad.module.css'), 'utf8'))
    .replaceAll('.source', '.math-source')
    .replaceAll('.failure', '.math-failure')
  let mathRequests = 0
  let engineRequests = 0
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://host').pathname
    if (pathname === '/favicon.ico') {
      response.statusCode = 204
      response.end()
      return
    }
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        `<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}article{width:280px;max-width:100%;min-width:0}${css}</style><div id="root"></div><script>window.sourceTokenizations=0;window.__ModuleLoader__={mode:'queue',pendingQueue:[],load(registration){this.pendingQueue.push(registration)}};</script><script src="/loader.js"></script><script type="module" src="/app.js"></script>`,
      )
      return
    }
    response.setHeader('Content-Type', 'text/javascript')
    response.setHeader('Cache-Control', 'no-store')
    if (pathname === '/app.js') response.end(bootstrap.outputFiles[0].text)
    else if (pathname === '/loader.js') response.end(await readFile(require.resolve('@deepseek-ai/dsh-client-modules/client')))
    else {
      const file = request.url.includes('/??') ? 'client.js' : path.basename(pathname)
      if (file.startsWith('client.highlight.worker-')) engineRequests++
      if (file.startsWith('client.MathContent-') && ++mathRequests === 1) {
        response.statusCode = 503
        response.end('')
      } else response.end(await readFile(path.join(directory, 'lib', file)))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch(
    process.env.MODERN_UI_BROWSER
      ? { executablePath: process.env.MODERN_UI_BROWSER, headless: true }
      : existsSync(chromium.executablePath())
        ? { headless: true }
        : { channel: 'msedge', headless: true },
  )
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByRole('alert').waitFor()
    const measured = await page.locator('article').evaluate(article => ({
      width: article.clientWidth,
      scrollWidth: article.scrollWidth,
      pageWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      source: article.querySelector('pre').textContent,
      whiteSpace: getComputedStyle(article.querySelector('pre')).whiteSpace,
    }))
    assert.equal(measured.source, 'x_'.repeat(3000))
    assert.equal(measured.whiteSpace, 'pre-wrap')
    assert.ok(measured.scrollWidth <= measured.width + 1)
    assert.ok(measured.pageScrollWidth <= measured.pageWidth + 1)
    await page.getByRole('button', { name: 'Retry formula' }).click()
    await page.locator('[data-loaded="math"]').waitFor()
    assert.equal(mathRequests, 2)
    assert.deepEqual(errors, [])
    const idle = await browser.newPage()
    await idle.goto(`http://127.0.0.1:${server.address().port}/?view=idle`)
    await idle.getByText('No code').waitFor()
    await idle.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(engineRequests, 0)
    await idle.close()
    const measurements = []
    for (const rate of [1, 4]) {
      const context = await browser.newContext({ viewport: { width: 360, height: 640 } })
      const cold = await context.newPage()
      const session = await context.newCDPSession(cold)
      await session.send('Emulation.setCPUThrottlingRate', { rate })
      await cold.goto(`http://127.0.0.1:${server.address().port}/?view=code`)
      await cold.getByRole('textbox', { name: 'Message' }).focus()
      await cold.keyboard.type('typing')
      await cold.locator('.shiki').waitFor()
      await cold.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const measured = await cold.evaluate(() => ({
        ...window.finishCodeMeasurement(),
        resources: performance
          .getEntriesByType('resource')
          .filter(entry => entry.name.includes('/plugins/') && !entry.name.includes('/??'))
          .map(entry => ({
            url: entry.name,
            bytes: entry.encodedBodySize,
            startTime: entry.startTime,
            responseEnd: entry.responseEnd,
            duration: entry.duration,
          })),
      }))
      assert.ok(measured.plain < measured.colored)
      assert.equal(measured.inputEvents.length, 6)
      assert.ok(measured.resources.some(resource => resource.url.includes('client.highlight.worker-')))
      assert.ok(measured.resources.some(resource => resource.url.includes('client.typescript-')))
      measurements.push({
        cpuRate: rate,
        plainMs: measured.plain - measured.started,
        plainFrameMs: measured.plainFrame === undefined ? null : measured.plainFrame - measured.started,
        coloredMs: measured.colored - measured.started,
        ...measured,
      })
      await context.close()
    }
    assert.equal(engineRequests, 2)
    await writeFile(
      path.join(repo, '.artifacts/first-code-worker-loading.json'),
      JSON.stringify(
        {
          scope:
            'Single cold samples on a loopback HTTP fixture using real React, CodeBlock, Shiki and official script transport; unrelated Host primitives seed reduced to the external pointerModality query',
          measurements,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})

for (const kind of ['openui', 'math', 'highlight-code', 'highlight-read']) {
  test(`${kind} preserves the answer on a real chunk failure and user retry loads it again successfully`, async () => {
    await fixture(kind, 'fail-first', async ({ requests, original, transfer, ready, refresh }) => {
      assert.equal(requests.length, 1)
      assert.match(document.querySelector('[role="alert"]').textContent, /client-modules: bundle script .* failed to load/)
      assert.ok(document.body.textContent.includes(original))
      assert.ok(document.body.textContent.includes('Earlier answer'))
      assert.ok(document.body.textContent.includes('Later answer'))
      await act(() => refresh())
      assert.equal(requests.length, 1)
      await act(() =>
        [...document.querySelectorAll('button')]
          .find(button => button.textContent === (kind === 'openui' ? 'Restart view' : kind === 'math' ? 'Retry loading math' : 'Retry highlighting'))
          .click(),
      )
      await act(() => transfer())
      await act(() => ready())
      if (kind.startsWith('highlight-')) {
        for (let attempt = 0; attempt < 400 && !document.querySelector(kind === 'highlight-code' ? '.shiki' : '[data-read] [style*="--shiki-"]'); attempt++)
          await act(() => new Promise(resolve => setTimeout(resolve, 5)))
      }
      assert.equal(requests.length, 2)
      assert.equal(requests[0], requests[1])
      const loaded =
        kind === 'highlight-code'
          ? document.querySelector('.shiki')
          : kind === 'highlight-read'
            ? document.querySelector('[data-read] [style*="--shiki-"]')
            : document.querySelector(`[data-loaded="${kind}"]`)
      assert.ok(loaded)
      if (!kind.startsWith('highlight-')) assert.equal(loaded.textContent, original)
      assert.equal(document.querySelector('[role="alert"]'), null)
    })
  })
  for (const outcome of ['resolve', 'reject']) {
    test(`${kind} ignores a pending ${outcome} after its answer block unmounts`, async () => {
      await fixture(kind, 'pending', async ({ root, pending, flush, tokenizations }) => {
        assert.ok(pending())
        await act(() => root.unmount())
        await act(async () => {
          if (outcome === 'resolve') pending().resolve()
          else pending().reject(new Error(`client-modules: bundle script ${pending().url} failed to load`))
          await flush()
        })
        assert.equal(document.getElementById('root').textContent, '')
        if (kind.startsWith('highlight-')) assert.equal(tokenizations(), 0)
      })
    })
  }
}
