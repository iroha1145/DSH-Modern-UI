import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { chromium, firefox, webkit } from 'playwright-core'
import { afterAll, test } from 'vitest'

const repo = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const officialAttachmentClient = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-attachment/client'), 'utf8')
const result = await build({
  absWorkingDir: repo,
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import * as ReactDOM from 'react-dom'; import * as JSXRuntime from 'react/jsx-runtime';
      import * as OfficialPrimitives from '@deepseek-ai/dsh-client-ui-primitives';
      window.__ModuleLoader__={load(registration){const plugin=registration.factory(name=>({'react':React,'react-dom':ReactDOM,'react/jsx-runtime':JSXRuntime,'@deepseek-ai/dsh-client-ui-primitives':OfficialPrimitives})[name]);plugin.apply({slots:{registerFactory(){},inject(_name,install){install()},register(options,component){if(options.name==='conversation.input.attachments')window.OfficialComposer=component}}})}};
      import {UserContent} from './packages/modern-ui/src/vendor/chat/client/chat/UserContent.tsx';
      import {QueueDock} from './packages/modern-ui/src/vendor/conversation/client/queue/QueueDock.tsx';
      import {ComposerAttachments} from './packages/modern-ui/src/composer-attachments.tsx';
      const composerRoot=createRoot(document.getElementById('composer'));
      window.events=[];
      window.renderComposer=(config={})=>{
        const names=config.names??['long quarterly financial report '.repeat(12)+'.pdf','photo.png','failed financial report '.repeat(10)+'.xlsx'];
        const attachments=names.map((name,index)=>({id:'file'+index,kind:index===1?'image':'file',file:new File(['test'],name),previewUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>')}));
        const Component=config.official?window.OfficialComposer:ComposerAttachments;
        composerRoot.render(config.unmount?null:<Component attachments={attachments}
          uploads={config.uploads??{file0:{status:'uploading',loaded:25,total:100},file2:{status:'error',message:'failed'}}}
          canAcceptDrop={config.canAcceptDrop??true}
          onAddFiles={(files,directories)=>window.events.push({type:'add',names:files.map(file=>file.name),directories:[...(directories??[])].map(file=>file.name)})}
          onRetryFile={id=>window.events.push({type:'retry',id})}
          onRemoveAttachment={id=>window.events.push({type:'remove',id})}
          imageZoomT={key=>key}
          t={(key,params)=>params?.name?key+':'+params.name:key} />)
      };
      window.renderNames=(names)=>{ createRoot(document.getElementById('root')).render(<>{names.map((name,index)=>{
        const attachment={name,bytes:1024,attachmentId:'file'+index};
        const shared={updateQueue:async()=>{},notify:()=>{},loadImage:async()=>'',renderFactorySlot:()=>null,t:key=>key==='queue.sending'?'Sending':key};
        const state={pendingSubmissions:[],running:false,subagent:null};
        const pending={requestId:'pending',placement:'queued',attachments:[{type:'file',value:attachment}],text:''};
        return <section key={name} data-case={index}>
          <div data-history><UserContent content={{text:'',attachments:[{type:'file',file:attachment}],extraBlocks:[]}} {...shared}/></div>
          <div data-queue><QueueDock {...shared} useSession={fn=>fn(state)} useProjection={()=>({'next-turn':[{id:'row',source:{kind:'user'},content:[{type:'file',attachment}]}]})}/></div>
          <div data-pending><QueueDock {...shared} useSession={fn=>fn({...state,pendingSubmissions:[pending]})} useProjection={()=>({'next-turn':[]})}/></div>
        </section>
      })}</>)};`,
  },
  outfile: 'fixture.js',
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'local-css', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'filename-surroundings',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'tsx',
          resolveDir: repo,
          contents: `export {fileExtension} from './packages/modern-ui/src/vendor/primitives/FileTypeIcon.tsx';
          export const FileTypeIcon=()=>null, fileSizeText=()=> '1 KB', JsonBlock=()=>null, UserMessageBubble=({children})=>children;
          export const IconCheckOutlineRegular=()=>null,IconChevronDownOutlineRegular=()=>null,IconChevronUpOutlineRegular=()=>null,IconCloseOutlineRegular=()=>null,IconEditOutlineRegular=()=>null,IconQueueOutlineRegular=()=>null,IconSendOutlineRegular=()=>null,IconTrashOutlineRegular=()=>null,InlineEditor=()=>null,Tooltip=({children})=>children;`,
        }))
      },
    },
  ],
})
const engine = { chromium, firefox, webkit }[process.env.MODERN_UI_TEST_ENGINE ?? 'chromium']
const browser = await engine.launch({ headless: true })
afterAll(() => browser.close())

async function composerFixture(options = {}) {
  const page = await browser.newPage({ viewport: { width: 480, height: 700 }, reducedMotion: 'reduce', ...options })
  page.setDefaultTimeout(4000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><div id="composer"></div>')
  await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.evaluate(() => window.renderComposer())
  await page.waitForTimeout(50)
  assert.deepEqual(errors, [])
  await page.waitForSelector('[data-composer-attachments]')
  return page
}

test('composer retains mixed attachment order, Host progress/error/retry/remove, exact filename copy and original-image preview', async () => {
  const page = await composerFixture()
  try {
    const rail = page.getByRole('group', { name: 'attachment.pending' })
    assert.deepEqual(
      await rail.locator(':scope > *').evaluateAll(cards => cards.map(card => (card.querySelector('img') ? 'image' : card.getAttribute('data-state')))),
      ['uploading', 'image', 'error'],
    )
    const uploading = page.locator('[data-state="uploading"]')
    assert.deepEqual(await uploading.evaluate(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height })), {
      width: 240,
      height: 64,
    })
    assert.equal(
      await uploading
        .locator('span[style]')
        .last()
        .evaluate(element => element.style.width),
      '25%',
    )
    const filename = uploading.locator('span[title]')
    const full = await filename.getAttribute('title')
    assert.equal(await filename.textContent(), full)
    assert.equal(
      await filename.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        getSelection().removeAllRanges()
        getSelection().addRange(range)
        return getSelection().toString()
      }),
      full,
    )
    await page.getByRole('button', { name: /^file.retry:/ }).click()
    await uploading.getByRole('button', { name: /^file.remove:/ }).click()
    assert.deepEqual(await page.evaluate(() => window.events), [
      { type: 'retry', id: 'file2' },
      { type: 'remove', id: 'file0' },
    ])
    await page.locator('button[title="image.openOriginal"]').click()
    await page.getByRole('dialog', { name: 'image.preview' }).waitFor()
    assert.match(await page.getByRole('dialog').locator('img').getAttribute('src'), /^data:image\/svg\+xml,/)
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() =>
      window.renderComposer({
        uploads: { file0: { status: 'ready', file: {}, receiptId: 'ready' }, file2: { status: 'ready', file: {}, receiptId: 'ready' } },
      }),
    )
    await page.locator('[data-state="ready"]').first().waitFor()
    assert.equal(await page.locator('[data-state="uploading"]').count(), 0)
    assert.equal(await page.getByRole('button', { name: /^file.retry:/ }).count(), 0)
  } finally {
    await page.close()
  }
}, 30_000)

test('composer rail pages, wheels, exposes removal on touch, observes resizing and reveals new attachments', async () => {
  const page = await composerFixture({ hasTouch: true, isMobile: true })
  try {
    const rail = page.getByRole('group', { name: 'attachment.pending' })
    await page.getByRole('button', { name: 'attachment.scrollRight' }).click()
    assert.ok(await rail.evaluate(element => element.scrollLeft > 0))
    await page.getByRole('button', { name: 'attachment.scrollLeft' }).click()
    await page.waitForFunction(() => document.querySelector('[role="group"]').scrollLeft === 0)
    await rail.dispatchEvent('wheel', { deltaY: 40, deltaMode: 0 })
    assert.ok(await rail.evaluate(element => element.scrollLeft > 0))
    assert.equal(
      await page
        .locator('[data-state]')
        .first()
        .getByRole('button', { name: /^file.remove:/ })
        .evaluate(element => getComputedStyle(element).opacity),
      '1',
    )
    const padding = await page
      .locator('[data-state]')
      .first()
      .locator('span[title]')
      .evaluate(element => getComputedStyle(element).paddingRight)
    assert.equal(padding, '32px')
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.getByRole('button', { name: 'attachment.scrollRight' }).waitFor({ state: 'detached' })
    await page.setViewportSize({ width: 320, height: 700 })
    await page.getByRole('button', { name: 'attachment.scrollRight' }).waitFor()
    await page.evaluate(() => window.renderComposer({ names: ['first.pdf', 'image.png', 'third.pdf', 'added.pdf'] }))
    await page.waitForFunction(() => {
      const rail = document.querySelector('[role="group"]')
      return rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 1
    })
  } finally {
    await page.close()
  }
}, 30_000)

test('composer document drops keep directory validation, blocked drops and listener cleanup, and reset at viewport exit', async () => {
  const page = await composerFixture()
  try {
    const transfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['one'], 'one.txt'))
      transfer.items.add(new File([], 'folder'))
      Object.defineProperty(DataTransferItem.prototype, 'webkitGetAsEntry', {
        configurable: true,
        value() {
          return { isDirectory: this.getAsFile()?.name === 'folder' }
        },
      })
      return transfer
    })
    for (let count = 0; count < 2; count++) await page.locator('body').dispatchEvent('dragenter', { dataTransfer: transfer, clientX: 50, clientY: 50 })
    await page.getByRole('status').waitFor()
    await page.locator('body').dispatchEvent('dragleave', { dataTransfer: transfer, clientX: 0, clientY: 0 })
    await page.getByRole('status').waitFor({ state: 'detached' })
    await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer })
    assert.deepEqual(await page.evaluate(() => window.events), [{ type: 'add', names: ['one.txt', 'folder'], directories: ['folder'] }])
    await page.evaluate(() => window.renderComposer({ canAcceptDrop: false }))
    await page.waitForTimeout(20)
    await page.locator('body').dispatchEvent('dragenter', { dataTransfer: transfer })
    assert.equal(await page.getByRole('status').textContent(), 'attachment.dropBlocked')
    assert.equal(
      await page.evaluate(transfer => {
        const event = new DragEvent('drop', { dataTransfer: transfer, cancelable: true, bubbles: true })
        document.body.dispatchEvent(event)
        return event.defaultPrevented
      }, transfer),
      true,
    )
    assert.equal(await page.evaluate(() => window.events.length), 1)
    await page.evaluate(() => window.renderComposer({ unmount: true }))
    await page.locator('[data-composer-attachments]').waitFor({ state: 'detached' })
    await page.locator('body').dispatchEvent('dragenter', { dataTransfer: transfer })
    assert.equal(
      await page.evaluate(transfer => {
        const event = new DragEvent('drop', { dataTransfer: transfer, cancelable: true, bubbles: true })
        document.body.dispatchEvent(event)
        return event.defaultPrevented
      }, transfer),
      false,
    )
    assert.equal(await page.getByRole('status').count(), 0)
    assert.equal(await page.evaluate(() => window.events.length), 1)
    await transfer.dispose()
  } finally {
    await page.close()
  }
}, 30_000)

test('composer keeps nested drag depth across acceptance and callback updates', async () => {
  const page = await composerFixture()
  try {
    const transfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['one'], 'one.txt'))
      return transfer
    })
    const enterTwice = async () => {
      for (let count = 0; count < 2; count++) await page.locator('#composer').dispatchEvent('dragenter', { dataTransfer: transfer, clientX: 50, clientY: 50 })
      await page.getByRole('status').waitFor()
    }
    const rerender = config =>
      page.evaluate(async config => {
        window.renderComposer(config)
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, config)
    for (const canAcceptDrop of [false, true]) {
      await enterTwice()
      await rerender({ canAcceptDrop })
      await page.locator('#composer').dispatchEvent('dragleave', { dataTransfer: transfer, clientX: 50, clientY: 50 })
      assert.equal(await page.getByRole('status').count(), 1)
      assert.equal(await page.getByRole('status').textContent(), canAcceptDrop ? 'attachment.dropTitle' : 'attachment.dropBlocked')
      await page.locator('#composer').dispatchEvent('dragleave', { dataTransfer: transfer, clientX: 50, clientY: 50 })
      await page.getByRole('status').waitFor({ state: 'detached' })
    }
    await enterTwice()
    // The fixture creates a fresh onAddFiles callback while acceptance stays unchanged.
    await rerender({ canAcceptDrop: true })
    await page.locator('#composer').dispatchEvent('dragleave', { dataTransfer: transfer, clientX: 50, clientY: 50 })
    assert.equal(await page.getByRole('status').count(), 1)
    await page.locator('#composer').dispatchEvent('drop', { dataTransfer: transfer })
    await page.getByRole('status').waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => window.events), [{ type: 'add', names: ['one.txt'], directories: [] }])
    await transfer.dispose()
  } finally {
    await page.close()
  }
}, 30_000)

test('composer keeps official attachment rail and card geometry', async () => {
  const page = await composerFixture()
  try {
    await page.addStyleTag({
      content:
        ':root{--dsw-radius-lg:12px;--dsw-radius-xl:16px;--dsw-specific-input-major:rgb(240,240,240);--dsw-alias-border-l2:rgb(100,100,100);--dsw-alias-border-l2-darkmode-thin:rgb(100,100,100)}',
    })
    const geometry = () =>
      page.getByRole('group', { name: 'attachment.pending' }).evaluate(rail => {
        const first = rail.children[0].matches('[data-state]') ? rail.children[0] : rail.children[0].firstElementChild
        const image = rail.children[1].querySelector('button')
        const style = getComputedStyle(first),
          rootStyle = getComputedStyle(rail.closest('[data-composer-attachments]') ?? rail.parentElement.parentElement)
        return {
          width: first.getBoundingClientRect().width,
          height: first.getBoundingClientRect().height,
          radius: style.borderRadius,
          fill: style.backgroundColor,
          border: style.borderTopWidth,
          gap: getComputedStyle(rail).gap,
          rootPadding: rootStyle.padding,
          rootMargin: rootStyle.marginBottom,
          imageWidth: image.getBoundingClientRect().width,
          imageHeight: image.getBoundingClientRect().height,
          imageRadius: getComputedStyle(image).borderRadius,
        }
      })
    const modern = await geometry()
    await page.addScriptTag({ content: officialAttachmentClient })
    await page.evaluate(() => window.renderComposer({ official: true }))
    await page.locator('[data-composer-attachments]').waitFor({ state: 'detached' })
    assert.deepEqual(await geometry(), modern)
    assert.deepEqual(
      { width: modern.width, height: modern.height, gap: modern.gap, imageWidth: modern.imageWidth, imageHeight: modern.imageHeight },
      { width: 240, height: 64, gap: '10px', imageWidth: 64, imageHeight: 64 },
    )
  } finally {
    await page.close()
  }
}, 30_000)

test('history and both queue cards preserve extensions, complete selectable names and bounds at desktop/mobile widths', async () => {
  const names = [
    `${'Quarterly annual report '.repeat(12)}.pdf`,
    `${'研究資料😀é'.repeat(12)}.文書`,
    'archive.backup.tar.gz',
    '.env',
    'README',
    'trailing.',
    `report.${'unusuallylongextension'.repeat(8)}`,
  ]
  const page = await browser.newPage()
  try {
    for (const width of [680, 320]) {
      await page.goto('about:blank')
      await page.setViewportSize({ width, height: 900 })
      await page.setContent('<div id="root"></div><div id="composer"></div>')
      await page.addStyleTag({
        content:
          result.outputFiles.find(file => file.path.endsWith('.css')).text +
          '\nsection{margin-bottom:8px} [data-history],[data-queue],[data-pending]{width:100%;font:13px Arial} body{margin:8px;--dsw-font-xs-13:13px Arial}',
      })
      await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
      await page.evaluate(names => window.renderNames(names), names)
      await page.waitForSelector('[data-case="6"] [title]')
      for (const [index, name] of names.entries()) {
        for (const surface of ['history', 'queue', 'pending']) {
          const filename = page
            .locator(`[data-case="${index}"] [data-${surface}] span[title]`)
            .filter({ has: page.locator('span[title]') })
            .locator('span[title]')
          assert.equal(await filename.textContent(), name)
          assert.equal(await filename.getAttribute('title'), name)
          const info = await filename.evaluate(element => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const selection = window.getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
            const children = [...element.children]
            return {
              copied: selection.toString(),
              children: children.map(child => ({ text: child.textContent, width: child.clientWidth, scroll: child.scrollWidth })),
              width: element.getBoundingClientRect().width,
              parentWidth: element.parentElement.getBoundingClientRect().width,
              aria: element.getAttribute('aria-label'),
            }
          })
          assert.equal(info.copied, name, `${surface} at ${width}px`)
          assert.equal(info.aria, null)
          assert.ok(info.width <= info.parentWidth + 1)
          assert.ok(info.width > 0)
          if (index < 3) {
            assert.equal(info.children.length, 2)
            assert.ok(info.children[1].text.startsWith('.'))
            if (info.width >= info.children[1].scroll) assert.ok(info.children[1].width >= info.children[1].scroll - 1, `${surface}: extension remains visible`)
          } else if (index < 6) {
            assert.equal(info.children.length, 1)
          }
          if (index < 2) assert.ok(info.children[0].scroll > info.children[0].width, `${surface}: long prefix truncates`)
        }
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    }
  } finally {
    await page.close()
  }
}, 30_000)
for (const hasTouch of [false, true]) {
  test(`audit failed filenames avoid removal target before hover (${hasTouch ? 'touch' : 'mouse'})`, async () => {
    const page = await composerFixture({ hasTouch })
    try {
      const name = 'failed-report.' + 'verylongextension'.repeat(12)
      await page.evaluate(name => window.renderComposer({ names: [name], uploads: { file0: { status: 'error', message: 'failed' } } }), name)
      await page.waitForFunction(
        name => document.querySelectorAll('[data-state]').length === 1 && document.querySelector('[data-state] span[title]')?.textContent === name,
        name,
      )
      const card = page.locator('[data-state="error"]')
      await card.waitFor()
      const geometry = await card.evaluate(el => {
        const name = el.querySelector('span[title]'),
          button = el.querySelector('button:last-of-type')
        const extension = name.lastElementChild.getBoundingClientRect(),
          remove = button.getBoundingClientRect()
        const selection = getSelection(),
          range = document.createRange()
        range.selectNodeContents(name)
        selection.removeAllRanges()
        selection.addRange(range)
        return {
          extension: extension.toJSON(),
          remove: remove.toJSON(),
          coarse: matchMedia('(pointer: coarse)').matches,
          opacity: getComputedStyle(button).opacity,
          copy: selection.toString(),
        }
      })
      assert.equal(geometry.copy, name)
      assert.equal(geometry.opacity, '1')
      assert.ok(geometry.extension.right <= geometry.remove.x, JSON.stringify(geometry))
      assert.equal(geometry.remove.width, geometry.coarse ? 32 : 24, JSON.stringify(geometry))
      assert.equal(geometry.remove.height, geometry.coarse ? 32 : 24, JSON.stringify(geometry))
      await card.getByRole('button', { name: /^file.retry:/ }).click()
      // Hit the expanded left edge inside the circular button, outside its old 18px footprint.
      await card.getByRole('button', { name: /^file.remove:/ }).click({ position: { x: 1, y: geometry.remove.height / 2 } })
      assert.deepEqual(await page.evaluate(() => window.events), [
        { type: 'retry', id: 'file0' },
        { type: 'remove', id: 'file0' },
      ])
    } finally {
      await page.close()
    }
  })
}
