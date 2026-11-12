import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
// Exercise InputBar's actual effect and the real React/Lexical DOM binding.
// Only unrelated toolbar decoration, upload integration and key commands are
// replaced; no selection/reveal/resize behavior is supplied by the fixture.
const result = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: String.raw`
import React, {useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createEditor,$getRoot,$createParagraphNode,$createTextNode,$createRangeSelection,$setSelection} from 'lexical';
import {registerPlainText} from '@lexical/plain-text';
import {InputBar} from './packages/modern-ui/src/vendor/conversation/client/skeleton/InputBar.tsx';
import css from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationRoot.module.css';
const text = Array.from({length:60},(_,i)=>'Draft line '+String(i+1).padStart(2,'0')).join('\n');
const editors = [0,1].map(index => {
  const editor=createEditor({namespace:'resize-'+index,onError:error=>{throw error}});
  registerPlainText(editor);
  editor.update(()=>{$getRoot().clear().append(...text.split('\n').map(line=>$createParagraphNode().append($createTextNode(line))))},{discrete:true});
  return editor;
});
const store = value => select => select(value);
const session = store({running:false,removed:false});
const input = store({draft:text,attachmentIds:[],queue:[],phase:'plain'});
const empty = store({});
const nothing = store(undefined);
const keyboard = editors.map(editor=>({editor,bindFilePicker:()=>()=>{}}));
function Demo({index}) {
  const scroll=useRef(null);
  useLayoutEffect(()=>{
    const el=scroll.current;
    const update=()=>el.style.setProperty('--dsh-conversation-viewport-height',el.clientHeight+'px');
    const observer=new ResizeObserver(update); observer.observe(el); update();
    return ()=>observer.disconnect();
  },[]);
  return <div className={css.root} data-phase="active" style={{height:'calc(100dvh - 122px)',marginTop:122}}>
    <div className={css.body}><div ref={scroll} className={css.scrollBody} data-conversation-scroll>
      <div className={css.viewArea}><div style={{height:1200}}>History anchor</div></div>
      <div className={css.composerSeat}><InputBar sessionId="fixture" variant="composer" useSession={session} useInput={input}
        inputActions={{pruneAttachments:()=>{}}} keyboard={keyboard[index]} useBusyEnter={store('queue')} useFileUploads={empty}
        useNotices={nothing} useLexicon={nothing} useMenuLauncher={nothing} useStopShortcut={store([])} useAccess={()=>true}
        useProjection={(name,select)=>select?.(undefined)} t={key=>key} renderSlot={name=>name==='conversation.composer.dock'?<span style={{height:24}}>Stats</span>:null}/>
      </div>
    </div></div>
  </div>;
}
const reactRoot=createRoot(document.getElementById('app'));
let current=0;
window.draftFixture={
  mount(index=0){current=index;flushSync(()=>reactRoot.render(<Demo index={index}/>));},
  unmount(){flushSync(()=>reactRoot.render(null));},
  select(line){
    const editor=editors[current]; editor.getRootElement().focus({preventScroll:true});
    editor.update(()=>{$getRoot().getChildAtIndex(line).getFirstChild().selectEnd()},{discrete:true});
  },
  selectRange(anchorLine,focusLine){
    const editor=editors[current]; editor.getRootElement().focus({preventScroll:true});
    editor.update(()=>{
      const selection=$createRangeSelection();
      selection.anchor.set($getRoot().getChildAtIndex(anchorLine).getFirstChild().getKey(),3,'text');
      selection.focus.set($getRoot().getChildAtIndex(focusLine).getFirstChild().getKey(),3,'text');
      $setSelection(selection);
    },{discrete:true});
  },
  selectMultiline(anchor,focus,blank){
    const editor=editors[current]; editor.getRootElement().focus({preventScroll:true});
    editor.update(()=>{
      const lines=text.split('\n'); if(blank===true) lines[22]=''; if(blank==='trailing') lines.push('');
      const node=$createTextNode(lines.join('\n'));
      $getRoot().clear().append($createParagraphNode().append(node));
      node.select(anchor,focus);
    },{discrete:true});
  },
  text(){return editors[current].getEditorState().read(()=>$getRoot().getTextContent());},
  root(index){return editors[index].getRootElement();},
};
window.draftFixture.mount();`,
  },
  bundle: true,
  write: false,
  outfile: 'client.js',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'draft-surroundings',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onResolve({ filter: /(?:\.\/runtime\.ts|\.\/keymap\.ts)$/ }, args =>
          args.importer.endsWith('view-binding.ts') ? { path: args.path, namespace: 'fixture' } : undefined,
        )
        builder.onResolve({ filter: /(?:ContextMeter\.tsx|original-image-drop\.ts)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents:
            args.path === 'primitives'
              ? `import React from 'react'; export const isMobileDevice=()=>true; export const focusWithoutRing=(el,options)=>el.focus(options); export const IconPlusOutlineMedium=()=>null; export const IconWarningOutlineRegular=()=>null; export const Toast=()=>null; export const Tooltip=({children})=>children; export const HoverCardGroup=({children,...props})=><div {...props}>{children}</div>;`
              : args.path.endsWith('runtime.ts')
                ? `export const DRAFT_SUBMITTED_TAG='draft-submitted';`
                : args.path.endsWith('keymap.ts')
                  ? 'export const registerComposerKeymap=()=>()=>{};'
                  : args.path.endsWith('ContextMeter.tsx')
                    ? 'export const ContextMeter=()=>null;'
                    : 'export const useOriginalImageDrop=()=>{};',
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
  logLevel: 'silent',
})
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
}

async function open() {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px Arial}p{margin:0}</style><div id="app"></div><button id="outside" style="position:fixed;top:0">Other control</button><span id="foreign" style="position:fixed;top:40px">Foreign text</span>',
  )
  await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
  // Observe native observer lifetimes without replacing delivery or geometry.
  await page.evaluate(() => {
    const NativeObserver = window.ResizeObserver
    const observations = new Map()
    window.inputResizeObservers = () => [...observations.values()].filter(targets => [...targets].some(target => target.matches('[data-input-scroll]'))).length
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback) {
        super(callback)
        observations.set(this, new Set())
      }
      observe(target, options) {
        observations.get(this).add(target)
        super.observe(target, options)
      }
      unobserve(target) {
        observations.get(this).delete(target)
        super.unobserve(target)
      }
      disconnect() {
        observations.get(this).clear()
        super.disconnect()
      }
    }
  })
  await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.locator('[data-composer-input] p').first().waitFor()
  await settle(page)
  return { page, errors }
}

async function state(page) {
  return page.evaluate(() => {
    const input = document.querySelector('[data-composer-input]')
    const scroll = document.querySelector('[data-input-scroll]')
    const selection = getSelection()
    const caret = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
    const focus = document.createRange()
    if (selection.focusNode !== null) focus.setStart(selection.focusNode, selection.focusOffset)
    focus.collapse(true)
    let activeEnd = focus.getBoundingClientRect()
    if (activeEnd.height === 0 && selection.focusNode instanceof Text && selection.focusOffset < selection.focusNode.length) {
      // Measure the empty line's newline glyph when Chromium exposes no caret rect.
      focus.setEnd(selection.focusNode, selection.focusOffset + 1)
      activeEnd = focus.getBoundingClientRect()
    }
    const box = scroll.getBoundingClientRect()
    return {
      caretTop: caret?.top,
      caretBottom: caret?.bottom,
      focusTop: activeEnd.top,
      focusBottom: activeEnd.bottom,
      selection: {
        anchor: selection.anchorNode?.textContent,
        anchorOffset: selection.anchorOffset,
        focus: selection.focusNode?.textContent,
        focusOffset: selection.focusOffset,
        text: selection.toString(),
      },
      top: box.top,
      bottom: box.bottom,
      height: scroll.clientHeight,
      scrollTop: scroll.scrollTop,
      maxScroll: scroll.scrollHeight - scroll.clientHeight,
      focused: document.activeElement === input,
      anchorInside: input.contains(selection.anchorNode),
      focusInside: input.contains(selection.focusNode),
      text: window.draftFixture.text(),
      outerScroll: document.querySelector('[data-conversation-scroll]').scrollTop,
      documentY: scrollY,
    }
  })
}

async function select(page, line) {
  await page.evaluate(line => window.draftFixture.select(line), line)
  await settle(page)
  await page.evaluate(() => {
    const scroll = document.querySelector('[data-input-scroll]')
    const rect = getSelection().getRangeAt(0).getBoundingClientRect()
    scroll.scrollTop += rect.bottom - scroll.getBoundingClientRect().bottom
    document.querySelector('[data-conversation-scroll]').scrollTop = 300
  })
  await settle(page)
}

function visible(snapshot) {
  const geometry = { ...snapshot, text: undefined, selection: undefined }
  assert.ok(snapshot.caretTop >= snapshot.top - 1 && snapshot.caretBottom <= snapshot.bottom + 1, JSON.stringify(geometry))
  assert.equal(snapshot.focused, true)
  assert.equal(snapshot.anchorInside && snapshot.focusInside, true)
}

for (const [name, line] of [
  ['last line', 59],
  ['middle line', 29],
]) {
  test(`focused ${name} remains visible through viewport shrink and restore without typing`, async () => {
    const { page, errors } = await open()
    try {
      await select(page, line)
      const before = await state(page)
      visible(before)
      for (const height of [570, 550, 900]) {
        await page.setViewportSize({ width: 390, height })
        await settle(page)
        const after = await state(page)
        visible(after)
        assert.equal(after.text, before.text)
        assert.equal(after.outerScroll, before.outerScroll)
        assert.equal(after.documentY, 0)
        if (line === 29) assert.ok(after.scrollTop < after.maxScroll - 100, JSON.stringify(after))
      }
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  })
}

for (const [name, anchor, focus, oversized] of [
  ['oversized forward', 20, 40, true],
  ['oversized backward', 40, 20, true],
  ['short forward', 29, 31, false],
  ['short backward', 31, 29, false],
]) {
  test(`${name} selection remains visible without changing its endpoints or direction`, async () => {
    const { page, errors } = await open()
    try {
      await page.evaluate(([anchor, focus]) => window.draftFixture.selectRange(anchor, focus), [anchor, focus])
      await settle(page)
      await page.evaluate(
        ({ forward, oversized }) => {
          const scroll = document.querySelector('[data-input-scroll]')
          const selection = getSelection()
          const range = selection.getRangeAt(0).cloneRange()
          if (oversized) {
            range.setStart(selection.focusNode, selection.focusOffset)
            range.collapse(true)
          }
          const rect = range.getBoundingClientRect()
          const box = scroll.getBoundingClientRect()
          // A forward selection's active end sits just above the bottom edge, so any shrink hides it without the fix.
          scroll.scrollTop += !oversized ? rect.bottom - box.bottom : forward ? rect.bottom - (box.bottom - 4) : rect.top - (box.top + 4)
          document.querySelector('[data-conversation-scroll]').scrollTop = 300
        },
        { forward: anchor < focus, oversized },
      )
      await settle(page)
      const before = await state(page)
      assert.equal(before.caretBottom - before.caretTop > before.height, oversized)
      visible(oversized ? { ...before, caretTop: before.focusTop, caretBottom: before.focusBottom } : before)
      for (const height of [570, 550, 900]) {
        await page.setViewportSize({ width: 390, height })
        await settle(page)
        const after = await state(page)
        visible(oversized ? { ...after, caretTop: after.focusTop, caretBottom: after.focusBottom } : after)
        assert.deepEqual(after.selection, before.selection)
        assert.equal(after.text, before.text)
        assert.equal(after.outerScroll, before.outerScroll)
        assert.equal(after.documentY, 0)
      }
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  })
}

for (const [name, anchor, focus, blank] of [
  ['forward line-start', 280, 308, false],
  ['backward line-start', 308, 280, false],
  ['forward empty-line', 280, 308, true],
  ['backward empty-line', 309, 308, true],
]) {
  test(`${name} active end remains visible in a single multiline Lexical text node`, async () => {
    const { page, errors } = await open()
    try {
      await page.evaluate(({ anchor, focus, blank }) => window.draftFixture.selectMultiline(anchor, focus, blank), { anchor, focus, blank })
      await settle(page)
      await page.evaluate(() => {
        const scroll = document.querySelector('[data-input-scroll]')
        const selection = getSelection()
        const range = selection.getRangeAt(0).cloneRange()
        range.setStart(selection.focusNode, selection.focusOffset)
        range.collapse(true)
        if (range.getBoundingClientRect().height === 0 && selection.focusOffset < selection.focusNode.length) {
          range.setEnd(selection.focusNode, selection.focusOffset + 1)
        }
        scroll.scrollTop += range.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom
        document.querySelector('[data-conversation-scroll]').scrollTop = 300
      })
      await settle(page)
      const before = await state(page)
      visible({ ...before, caretTop: before.focusTop, caretBottom: before.focusBottom })
      assert.ok(before.caretBottom - before.caretTop < before.height)
      for (const height of [570, 550, 900]) {
        await page.setViewportSize({ width: 390, height })
        await settle(page)
        const after = await state(page)
        visible({ ...after, caretTop: after.focusTop, caretBottom: after.focusBottom })
        assert.deepEqual(after.selection, before.selection)
        assert.equal(after.text, before.text)
        assert.equal(after.outerScroll, before.outerScroll)
        assert.equal(after.documentY, 0)
      }
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  })
}

test('a terminal newline with no rendered caret box preserves the last existing line', async () => {
  const { page, errors } = await open()
  try {
    // Chromium does not lay out a new line after this terminal newline. This
    // asserts visibility of its last existing glyph, not an invented caret box.
    await page.evaluate(() => window.draftFixture.selectMultiline(826, 840, 'trailing'))
    await settle(page)
    await page.evaluate(() => {
      const scroll = document.querySelector('[data-input-scroll]')
      scroll.scrollTop = scroll.scrollHeight
      document.querySelector('[data-conversation-scroll]').scrollTop = 300
    })
    const before = await state(page)
    assert.equal(before.focusTop, 0)
    assert.equal(before.focusBottom, 0)
    for (const height of [570, 550, 900]) {
      await page.setViewportSize({ width: 390, height })
      await settle(page)
      const after = await state(page)
      const glyph = await page.evaluate(() => {
        const selection = getSelection()
        const range = selection.getRangeAt(0).cloneRange()
        range.setStart(selection.focusNode, selection.focusOffset - 1)
        range.setEnd(selection.focusNode, selection.focusOffset)
        const rect = range.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom }
      })
      visible({ ...after, caretTop: glyph.top, caretBottom: glyph.bottom })
      assert.ok(after.scrollTop > after.maxScroll - 24)
      assert.deepEqual(after.selection, before.selection)
      assert.equal(after.text, before.text)
      assert.equal(after.outerScroll, before.outerScroll)
      assert.equal(after.documentY, 0)
    }
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('native Shift+Enter empty line stays visible when the viewport shrinks and restores', async () => {
  const { page, errors } = await open()
  try {
    const draft = Array.from({ length: 60 }, (_, index) => `Draft line ${String(index + 1).padStart(2, '0')}`).join('\n')
    await page.locator('[data-composer-input]').fill(draft)
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Shift+Enter')
    await settle(page)
    await page.evaluate(() => {
      document.querySelector('[data-conversation-scroll]').scrollTop = 300
    })
    const before = await state(page)
    assert.equal(before.focusTop, 0)
    assert.equal(before.focusBottom, 0)
    for (const height of [570, 550, 900]) {
      await page.setViewportSize({ width: 390, height })
      await settle(page)
      const after = await state(page)
      const emptyLine = await page.evaluate(() => {
        const selection = getSelection()
        const node = selection.focusNode.childNodes[selection.focusOffset]
        const rect = node.getBoundingClientRect()
        return {
          parent: selection.focusNode.nodeName,
          node: node.nodeName,
          managed: node.hasAttribute('data-lexical-managed-linebreak'),
          top: rect.top,
          bottom: rect.bottom,
        }
      })
      assert.equal(emptyLine.parent, 'P')
      assert.equal(emptyLine.node, 'BR')
      assert.equal(emptyLine.managed, true)
      visible({ ...after, caretTop: emptyLine.top, caretBottom: emptyLine.bottom })
      assert.deepEqual(after.selection, before.selection)
      assert.equal(after.text, before.text)
      assert.equal(after.outerScroll, before.outerScroll)
      assert.equal(after.documentY, 0)
    }
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('a width-only resize leaves the draft where the reader scrolled it', async () => {
  // A wider window, a toggled side panel or a dragged split pane changes only the width; the budget did not shrink,
  // so the focused draft keeps its reading position instead of jumping back to the caret.
  const { page, errors } = await open()
  try {
    await select(page, 59)
    await page.evaluate(() => {
      document.querySelector('[data-input-scroll]').scrollTop = 0
    })
    await settle(page)
    const before = await state(page)
    assert.equal(before.scrollTop, 0)
    assert.equal(before.focused, true)
    for (const width of [360, 420]) {
      await page.setViewportSize({ width, height: 900 })
      await settle(page)
      const after = await state(page)
      assert.equal(after.height, before.height)
      assert.equal(after.scrollTop, 0)
      assert.deepEqual(after.selection, before.selection)
    }
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('unfocused draft and foreign or crossing DOM selections retain their reading position', async () => {
  const { page, errors } = await open()
  try {
    for (const mode of ['blurred', 'foreign', 'crossing', 'reverse-crossing']) {
      await page.setViewportSize({ width: 390, height: 900 })
      await settle(page)
      await select(page, 29)
      await page.evaluate(mode => {
        const input = document.querySelector('[data-composer-input]')
        if (mode === 'blurred') document.getElementById('outside').focus({ preventScroll: true })
        else {
          const foreign = document.getElementById('foreign').firstChild
          const selection = getSelection()
          const own = document.createTreeWalker(input.querySelector('p'), NodeFilter.SHOW_TEXT).nextNode()
          selection.setBaseAndExtent(mode === 'crossing' ? own : foreign, 0, mode === 'reverse-crossing' ? own : foreign, 3)
        }
      }, mode)
      const before = await state(page)
      if (mode !== 'blurred') {
        assert.equal(before.focused, true)
        assert.equal(before.anchorInside && before.focusInside, false)
      }
      await page.setViewportSize({ width: 390, height: 550 })
      await settle(page)
      const after = await state(page)
      assert.equal(after.scrollTop, before.scrollTop, mode)
      assert.equal(after.text, before.text)
      assert.equal(after.outerScroll, before.outerScroll)
      assert.equal(after.documentY, 0)
    }
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('InputBar disconnects the observer on editor replacement and unmount', async () => {
  const { page, errors } = await open()
  try {
    assert.equal(await page.evaluate(() => window.inputResizeObservers()), 1)
    await select(page, 59)
    await page.evaluate(() => window.draftFixture.mount(1))
    await settle(page)
    assert.equal(await page.evaluate(() => window.draftFixture.root(0)), null)
    assert.equal(await page.evaluate(() => window.inputResizeObservers()), 1)
    await select(page, 29)
    await page.setViewportSize({ width: 390, height: 550 })
    await settle(page)
    visible(await state(page))
    await page.evaluate(() => window.draftFixture.unmount())
    await settle(page)
    assert.equal(await page.evaluate(() => window.inputResizeObservers()), 0)
    assert.equal(await page.evaluate(() => window.draftFixture.root(1)), null)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
