import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(rootDir, 'package.json'))
const { buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const { Context } = require('@deepseek-ai/cordis')
const source = buildSync({
  absWorkingDir: rootDir,
  stdin: { contents: `
    export * from './packages/modern-ui/src/file-drag.ts';
    export * from './packages/modern-ui/src/vendor/file-drag/transfers.ts';
    export { ImageGallery } from './packages/modern-ui/src/vendor/file-drag/MessageImage.tsx';
    export { installOriginalImageDrop } from './packages/modern-ui/src/vendor/conversation/client/input/original-image-drop.ts';
    export { MarkdownScope } from './packages/modern-ui/src/markdown-scope.tsx';
    export { MarkdownDelegateProvider, useMarkdownDelegate } from './packages/modern-ui/src/vendor/primitives/markdown/MarkdownDelegate.tsx';`, resolveDir: rootDir },
  bundle: true, write: false, platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(rootDir, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
}).outputFiles[0].text
const primitiveSource = buildSync({
  absWorkingDir: rootDir, entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')],
  bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react', 'react/jsx-runtime', 'react-dom'],
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl' },
}).outputFiles[0].text
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOskAAAAASUVORK5CYII=', 'base64')

function transfer() {
  const values = new Map()
  return { types: [], items: { clear() { values.clear() } }, effectAllowed: '', dropEffect: '',
    files: [], setData(type, value) { values.set(type, value); this.types = [...values.keys()] }, getData(type) { return values.get(type) ?? '' } }
}

async function fixture(t, customFetch) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="composer" data-composer-card></div></body></html>', { url: 'http://localhost/' })
  const { window } = dom
  const previous = new Map(), revoked = [], fetched = []
  class BrowserURL extends URL {
    static createObjectURL(blob) { return URL.createObjectURL(blob) }
    static revokeObjectURL(url) { revoked.push(url); URL.revokeObjectURL(url) }
  }
  const globals = { window, document: window.document, navigator: window.navigator, location: window.location,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, HTMLIFrameElement: window.HTMLIFrameElement,
    MutationObserver: window.MutationObserver, ResizeObserver: class { observe() {} disconnect() {} },
    IS_REACT_ACT_ENVIRONMENT: true }
  for (const [name, value] of Object.entries(globals)) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }) }
  const fetchOriginal = async (url, options) => {
    fetched.push([url, options])
    if (customFetch) return customFetch(url, options)
    if (url === 'http://localhost/original.png') return new Response(bytes, { headers: { 'content-type': 'image/png' } })
    return fetch(url, options)
  }
  const runtime = { ...globals, URL: BrowserURL, TextEncoder, TextDecoder, File, Blob, crypto,
    AbortController: window.AbortController, AbortSignal: window.AbortSignal,
    fetch: fetchOriginal, console, setTimeout, clearTimeout, queueMicrotask }
  const primitives = { exports: {} }
  vm.runInNewContext(primitiveSource, { ...runtime, module: primitives, exports: primitives.exports, require })
  const imports = id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives.exports : require(id)
  const clientModule = { exports: {} }
  vm.runInNewContext(source, { ...runtime, module: clientModule, exports: clientModule.exports, require: imports })
  const client = clientModule.exports
  let descriptor
  window.__ModuleLoader__ = { load: value => { descriptor = value } }
  vm.runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'), { window, document: window.document, console })
  const renderer = descriptor.factory(require)
  const ctx = new Context()
  await ctx.plugin(renderer.SlotRegistry).await()
  await ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.provide('locale', { register: () => () => {}, bind: () => key => key })
    scope.slots.register({ name: 'root', children: {
      'conversation.chat.message.images': { kind: 'single', scope: 'session' },
      'conversation.chat.user.images': { kind: 'single', scope: 'session' },
      'conversation.trajectory.images': { kind: 'single', scope: 'session' },
      'tool.call.images': { kind: 'single', scope: 'session' }, 'shell.overlay': { kind: 'list', scope: 'root' },
    } }, () => null)
  } }).await()
  let owner = ctx.plugin({ apply: client.installFileDrag }); await owner.await()
  const view = createRoot(window.document.getElementById('app'))
  t.after(async () => {
    await act(async () => { view.unmount(); await ctx.fiber.dispose() })
    window.close()
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
  })
  return { ...client, window, ctx, view, revoked, fetched,
    dispose: () => act(async () => { await owner.dispose() }),
    restart: () => act(async () => { owner = ctx.plugin({ apply: client.installFileDrag }); await owner.await() }) }
}

test('browser drag exports original bytes in a real download Blob and resolves only its current application token', async t => {
  const f = await fixture(t)
  const service = f.ctx.fileDrag
  const prepared = await service.actions.prepare({ kind: 'url', url: 'http://localhost/original.png', name: 'original.jpg', mediaType: '' }, new f.window.AbortController().signal)
  const payload = transfer(), image = f.window.document.createElement('img')
  assert.equal(prepared.start(payload, image), true)
  assert.equal(f.fetched[0][1].referrerPolicy, 'no-referrer')
  const file = service.read(payload)
  assert.equal(file.name, 'original.png')
  assert.equal(file.type, 'image/png')
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes)
  assert.equal(service.read(transfer()), undefined)
  const download = payload.getData('DownloadURL').match(/^image\/png:original\.png:(blob:.*)$/)
  assert.ok(download, 'a File-backed download URL is exported, not the original HTTP URL')
  assert.deepEqual(Buffer.from(await (await fetch(download[1])).arrayBuffer()), bytes)
  prepared.release()
  assert.equal(f.revoked.includes(download[1]), false, 'releasing a preparation preserves an active drag')
  image.dispatchEvent(new f.window.Event('dragend'))
  assert.equal(service.read(payload), undefined)
  assert.ok(f.revoked.includes(download[1]))
  await assert.rejects(fetch(download[1]))
})

test('owned image tokens enter the existing composer file callback once; external files and stale tokens stay untouched', async t => {
  const f = await fixture(t)
  const service = f.ctx.fileDrag, received = []
  const prepared = await service.actions.prepare({ kind: 'blob', blob: new Blob([bytes], { type: 'image/png' }), name: 'copy.png', mediaType: 'image/png' }, new f.window.AbortController().signal)
  const payload = transfer(), source = f.window.document.createElement('img')
  prepared.start(payload, source)
  const card = f.window.document.getElementById('composer')
  const cleanup = f.installOriginalImageDrop(card, true, files => received.push(files), service.read)
  const drop = data => { const event = new f.window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: data }); card.dispatchEvent(event); return event }
  assert.equal(drop(payload).defaultPrevented, true)
  assert.equal(received.length, 1)
  assert.deepEqual(Buffer.from(await received[0][0].arrayBuffer()), bytes)
  const ordinary = transfer(); ordinary.types = ['Files']; ordinary.files = [new File(['external'], 'external.txt')]
  assert.equal(drop(ordinary).defaultPrevented, false)
  assert.equal(received.length, 1)
  const stale = transfer(); stale.setData(f.FILE_DRAG_TOKEN_TYPE, 'not-the-active-token')
  assert.equal(drop(stale).defaultPrevented, false)
  cleanup()
  const blocked = f.installOriginalImageDrop(card, false, files => received.push(files), service.read)
  assert.equal(drop(payload).defaultPrevented, true)
  assert.equal(received.length, 1)
  blocked(); prepared.release(); source.dispatchEvent(new f.window.Event('dragend'))
})

test('gallery gestures prepare the authorized original and nested Markdown keeps image transfer capabilities', async t => {
  const f = await fixture(t)
  const service = f.ctx.fileDrag
  const labels = { image: 'Image', open: 'Open', openNamed: name => `Open ${name}`, loading: 'Loading', loadFailed: 'Failed', lightbox: { dialog: 'Preview', close: 'Close' } }
  const attachment = { attachmentId: 'image-1', name: 'original.png', width: 1, height: 1, mediaType: 'image/png' }
  const load = Object.assign(async () => 'http://localhost/original.png', { peek: () => 'http://localhost/original.png' })
  await act(async () => { f.view.render(React.createElement(f.ImageGallery, { images: [{ attachment }], load, labels, fileDrag: service.actions, align: 'start' })) })
  const image = f.window.document.querySelector('#app img')
  assert.equal(image.draggable, true)
  await act(async () => { image.dispatchEvent(new f.window.MouseEvent('pointerdown', { button: 0, bubbles: true })); await new Promise(setImmediate) })
  const payload = transfer(), start = new f.window.Event('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(start, 'dataTransfer', { value: payload })
  await act(async () => { image.dispatchEvent(start) })
  assert.equal(start.defaultPrevented, false)
  assert.deepEqual(Buffer.from(await service.read(payload).arrayBuffer()), bytes)
  let delegate
  const resourceAddress = path => `dsh-resource://file/session/one/${path}`
  function Probe() { delegate = f.useMarkdownDelegate(); return null }
  await act(async () => { f.view.render(React.createElement(f.MarkdownDelegateProvider,
    { fileImages: { fileDrag: service.actions, resourceAddress, resolve: path => path, labels: { dialog: '', close: '' } } },
    React.createElement(f.MarkdownScope, { cwd: '/workspace', openFile() {}, openExternalLink() {}, t: key => key }, React.createElement(Probe)))) })
  assert.equal(delegate.fileImages.fileDrag, service.actions)
  assert.equal(delegate.fileImages.resourceAddress, resourceAddress)
})

test('disposal cancels pending preparation and removes image seats; a fresh activation owns a fresh service', async t => {
  let finish, signal
  const f = await fixture(t, (_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve }) })
  const old = f.ctx.fileDrag
  const pending = old.actions.prepare({ kind: 'url', url: 'http://localhost/original.png', mediaType: '' }, new f.window.AbortController().signal)
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.user.images').length, 1)
  await f.dispose()
  assert.equal(signal.aborted, true)
  finish(new Response(bytes, { headers: { 'content-type': 'image/png' } }))
  await assert.rejects(pending, /disposed/)
  assert.equal(f.ctx.get('fileDrag'), undefined)
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.user.images').length, 0)
  await f.restart()
  assert.notEqual(f.ctx.fileDrag, old)
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.user.images').length, 1)
})

test('image export naming preserves compatible suffixes and bounds safe Windows filenames by UTF-8 bytes', async t => {
  const f = await fixture(t)
  assert.equal(f.imageFileName('picture.jpeg', 'image/jpeg'), 'picture.jpeg')
  assert.equal(f.imageFileName('CON.jpg', 'image/png'), '_CON.png')
  assert.equal(f.imageFileName('../bad:name?.jpg', 'image/webp'), '_bad_name_.webp')
  const long = f.imageFileName('图'.repeat(200) + '.png', 'image/png')
  assert.ok(Buffer.byteLength(long) <= 255)
  assert.ok(long.endsWith('.png'))
})

const browserExecutable = process.env.MODERN_UI_BROWSER
  ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
test('Chromium mouse drag retains the exact PNG bytes and its File-backed DownloadURL', {
  skip: !browserExecutable || !existsSync(browserExecutable) ? 'Set MODERN_UI_BROWSER to run the real browser transfer check' : false,
  timeout: 30000,
}, async () => {
  const contents = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {FileTransfers} from './packages/modern-ui/src/vendor/file-drag/transfers.ts';
    import {ImageGallery} from './packages/modern-ui/src/vendor/file-drag/MessageImage.tsx';
    import {installOriginalImageDrop} from './packages/modern-ui/src/vendor/conversation/client/input/original-image-drop.ts';
    const transfers=new FileTransfers();window.received=[];window.prepared=0;
    const actions={prepare:async(source,signal)=>{const value=await transfers.prepare(source,signal);window.prepared++;return value},reportFailure:()=>{throw Error('Image drag failed')}};
    window.addEventListener('dragstart',event=>{const download=event.dataTransfer.getData('DownloadURL');window.download=download;
      const url=download.match(/^image\\/png:original\\.png:(.*)$/)?.[1];window.downloadBytes=url?fetch(url).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b))):null});
    function Demo(){const card=React.useRef(null);React.useEffect(()=>installOriginalImageDrop(card.current,true,files=>window.received.push(...files),transfer=>transfers.read(transfer)),[]);
      return React.createElement('main',null,
        React.createElement(ImageGallery,{images:[{preview:{url:'/original.png',name:'original.png',width:128,height:128}}],load:async()=>'/original.png',align:'start',fileDrag:actions,
          labels:{image:'Image',open:'Open',openNamed:n=>n,loading:'Loading',loadFailed:'Failed',lightbox:{dialog:'Preview',close:'Close'}}}),
        React.createElement('div',{ref:card,'data-composer-card':'',style:{width:'500px',height:'150px',marginTop:'40px',border:'1px solid gray'}},'Drop original here'))}
    createRoot(document.getElementById('app')).render(React.createElement(Demo));`
  const code = buildSync({ absWorkingDir: rootDir, stdin: { contents, resolveDir: rootDir, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(rootDir, 'packages/modern-ui/src/vendor/primitives/index.ts') },
    loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text
  const server = createServer((request, response) => {
    if (request.url === '/original.png') { response.writeHead(200, { 'content-type': 'image/png' }); response.end(bytes) }
    else if (request.url === '/bundle.js') { response.writeHead(200, { 'content-type': 'application/javascript' }); response.end(code) }
    else { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><html><body><div id="app"></div><script src="/bundle.js"></script></body></html>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await require('playwright-core').chromium.launch({ executablePath: browserExecutable, headless: true })
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.locator('img').hover()
    await page.waitForFunction(() => window.prepared > 0)
    await page.locator('img').dragTo(page.locator('[data-composer-card]'))
    const result = await page.evaluate(async () => ({ count: window.received.length,
      name: window.received[0]?.name, type: window.received[0]?.type,
      bytes: window.received[0] ? Array.from(new Uint8Array(await window.received[0].arrayBuffer())) : [],
      download: window.download, downloadBytes: await window.downloadBytes }))
    assert.equal(result.count, 1)
    assert.equal(result.name, 'original.png'); assert.equal(result.type, 'image/png')
    assert.deepEqual(Buffer.from(result.bytes), bytes)
    assert.match(result.download, /^image\/png:original\.png:blob:/)
    assert.deepEqual(Buffer.from(result.downloadBytes), bytes)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
})
