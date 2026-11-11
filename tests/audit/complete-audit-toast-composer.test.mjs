import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {createEditor} from 'lexical';import {registerPlainText} from '@lexical/plain-text';
import {InputBar} from './packages/modern-ui/src/vendor/conversation/client/skeleton/InputBar.tsx';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
const editor=createEditor({namespace:'toast-composer',onError:error=>{throw error}});registerPlainText(editor);
const store=value=>select=>select(value), empty=store({}),nothing=store(undefined),input=store({draft:'',attachmentIds:[],queue:[],phase:'plain'}),keys=store([]),busy=store('queue');
const keyboard={editor,bindFilePicker:()=>()=>{}},actions={pruneAttachments:()=>{}},translate=key=>key,access=()=>true,project=(name,select)=>select?.(undefined),renderSlot=()=>null;
function Demo(){
 const [notice,setNotice]=useState(undefined),[promptError,setPromptError]=useState(null);
 window.reportNotice=text=>setNotice({level:'error',text});window.reportPrompt=text=>setPromptError({error:{code:'session/test-failure',message:text}});
 return <InputBar sessionId="fixture" variant="composer" useSession={store({running:false,removed:false,promptError})} useInput={input} inputActions={actions} keyboard={keyboard}
 useBusyEnter={busy} useFileUploads={empty} useNotices={store(notice)} useLexicon={nothing} useMenuLauncher={nothing} useStopShortcut={keys} useAccess={access}
 useProjection={project} t={translate} renderSlot={renderSlot}/>;
}
createRoot(document.getElementById('composer-column')).render(<Demo/>);`,
  },
  bundle: true,
  write: false,
  outfile: 'client.js',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  plugins: [
    {
      name: 'unrelated-composer-integrations',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onResolve({ filter: /(?:\.\/runtime\.ts|\.\/keymap\.ts)$/ }, args =>
          args.importer.endsWith('view-binding.ts') ? { path: args.path, namespace: 'fixture' } : undefined,
        )
        builder.onResolve({ filter: /(?:ContextMeter\.tsx|original-image-drop\.ts)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          resolveDir: root,
          loader: 'tsx',
          contents:
            args.path === 'primitives'
              ? "export {Toast} from './packages/modern-ui/src/vendor/primitives/Toast.tsx';export const isMobileDevice=()=>false;export const focusWithoutRing=(el,options)=>el.focus(options);export const IconPlusOutlineMedium=()=>null;export const IconWarningOutlineRegular=()=>null;export const Tooltip=({children})=>children;export const HoverCardGroup=({children})=>children;"
              : args.path.endsWith('runtime.ts')
                ? "export const DRAFT_SUBMITTED_TAG='draft-submitted';"
                : args.path.endsWith('keymap.ts')
                  ? 'export const registerComposerKeymap=()=>()=>{};'
                  : args.path.endsWith('ContextMeter.tsx')
                    ? 'export const ContextMeter=()=>null;'
                    : 'export const useOriginalImageDrop=()=>{};',
        }))
      },
    },
  ],
})
const browser = await chromium.launch(
  process.env.MODERN_UI_BROWSER
    ? { executablePath: process.env.MODERN_UI_BROWSER, headless: true }
    : existsSync(chromium.executablePath())
      ? { headless: true }
      : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())
async function fixture(width) {
  const page = await browser.newPage({ viewport: { width, height: 700 }, reducedMotion: 'reduce' })
  await page.setContent(
    '<style>body{margin:0;font:14px Arial}#composer-column{position:absolute;left:0;top:440px;width:280px;transform:translateZ(0);--dsh-composer-side-clearance:8px;--dsh-composer-card-max-width:720px}</style><div id="composer-column"></div>',
  )
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith('.css')) await page.addStyleTag({ content: file.text })
    else await page.addScriptTag({ content: file.text })
  }
  await page.locator('[data-composer-card]').waitFor()
  return page
}
async function assertVisible(page, text) {
  await page.waitForFunction(text => document.querySelector('[role=alert]')?.textContent === text, text)
  await page.waitForFunction(() => {
    const element = document.querySelector('[role=alert]'),
      box = element.getBoundingClientRect()
    return box.left >= 23.5 && box.right <= innerWidth - 23.5 && element.scrollWidth <= element.clientWidth + 1
  })
  const result = await page.locator('[role=alert]').evaluate(element => {
    const box = element.getBoundingClientRect(),
      range = document.createRange()
    range.selectNodeContents(element)
    return {
      portal: element.parentElement === document.body,
      outsideComposer: !document.querySelector('#composer-column').contains(element),
      contained: Array.from(range.getClientRects()).every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1),
    }
  })
  assert.deepEqual(result, { portal: true, outsideComposer: true, contained: true })
}

test('actual InputBar notice and prompt-error paths portal long Toast content safely at 320px and 800px', async () => {
  for (const width of [320, 800]) {
    const page = await fixture(width)
    try {
      const notice = 'Long composer notice '.repeat(12) + '完整错误通知'.repeat(12)
      await page.evaluate(text => window.reportNotice(text), notice)
      await assertVisible(page, notice)
      const failure = 'Provider rejected the prompt with detailed translated information '.repeat(8)
      await page.evaluate(text => window.reportPrompt(text), failure)
      await assertVisible(page, failure + ' (session/test-failure)')
      await page.locator('#composer-column').evaluate((el, width) => {
        el.style.left = width === 800 ? '480px' : '24px'
        el.style.width = width === 800 ? '300px' : '270px'
      }, width)
      await assertVisible(page, failure + ' (session/test-failure)')
    } finally {
      await page.close()
    }
  }
})

test('actual composer Toast follows position-only split movement and width/viewport resizing', async () => {
  const page = await fixture(800)
  try {
    await page.evaluate(() => window.reportNotice('Composer saved'))
    await assertVisible(page, 'Composer saved')
    const centered = () =>
      page.waitForFunction(() => {
        const toast = document.querySelector('[role=alert]').getBoundingClientRect(),
          card = document.querySelector('[data-composer-card]').getBoundingClientRect()
        return Math.abs((toast.left + toast.right - card.left - card.right) / 2) < 1
      })
    await centered()
    await page.locator('#composer-column').evaluate(el => {
      el.style.left = '480px'
    })
    await centered()
    await page.locator('#composer-column').evaluate(el => {
      el.style.left = '300px'
      el.style.width = '380px'
    })
    await centered()
    await page.setViewportSize({ width: 320, height: 700 })
    await page.locator('#composer-column').evaluate(el => {
      el.style.left = '0px'
      el.style.width = '320px'
    })
    await assertVisible(page, 'Composer saved')
    await centered()
  } finally {
    await page.close()
  }
})
