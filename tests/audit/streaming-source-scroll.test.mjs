import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { build } from './helpers/client-build.mjs'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const markdownRoot = path.join(repo, 'packages/modern-ui/src/vendor/primitives/markdown')
const baseline = process.env.AUDIT_STREAMING_BASELINE
const result = await build({
  absWorkingDir: repo,
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `import React,{useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MarkdownText} from './packages/modern-ui/src/vendor/primitives/markdown/MarkdownText.tsx';
import {ChatViewport} from './packages/modern-ui/src/vendor/chat/client/chat/use-chat-viewport.ts';
import {ChatReading} from './packages/modern-ui/src/vendor/chat/client/chat/use-chat-reading.ts';
import {ScrollFollow} from './packages/modern-ui/src/vendor/chat/client/chat/use-scroll-follow.ts';
import conversation from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationRoot.module.css';
import chat from './packages/modern-ui/src/vendor/chat/client/chat/ChatView.module.css';
const labels={code:{copyLabel:'Copy',copiedLabel:'Copied'},footnotes:'Footnotes',citations:{sources:'Sources',source:'Source'}};
function Demo({text,streaming,citations}) {
  const list=useRef(null),column=useRef(null);
  useLayoutEffect(()=>{
    const viewport=new ChatViewport();
    viewport.attach(list.current,column.current);
    const follow=new ScrollFollow(true,25);
    const reading=new ChatReading(viewport,{read:()=>null,save:()=>{}},
      {initialized:false,followingTail:true,activeTurn:null},
      state=>list.current.toggleAttribute('data-chat-following-tail',state.followingTail),follow);
    const unbind=follow.bind(list.current.closest('[data-conversation-scroll]'));
    const folds=reading.bindFolds();
    const disconnect=viewport.connect({scroll:reading.onScroll,scrollEnd:reading.onScrollEnd,
      resize:()=>reading.onResize(),interact:()=>{},intent:()=>reading.interruptFollow()});
    window.streamFixture.reading=reading;
    reading.restore();
    return ()=>{disconnect();folds();unbind();reading.dispose();viewport.detach();};
  },[]);
  return <div className={conversation.root} data-phase="active">
    <div className={conversation.body}><div className={conversation.scrollBody} data-conversation-scroll>
      <div ref={list} className={chat.root} data-chat-following-tail>
        <div className={chat.scroll}><div ref={column} className={chat.column}>
          <div style={{height:800,paddingTop:316,boxSizing:'border-box'}}><span id="history-anchor">Earlier history</span></div>
          <article id="message"><MarkdownText text={text} streaming={streaming} citations={citations} labels={labels}/></article>
        </div></div><div data-chat-turn-spacer/>
      </div>
      <div className={conversation.composerSeat} data-composer-seat style={{height:100,background:'white'}}>Composer</div>
    </div></div>
  </div>;
}
const root=createRoot(document.getElementById('app'));
window.streamFixture={render(text,streaming=true,citations=true){
  flushSync(()=>root.render(<Demo text={text} streaming={streaming} citations={citations}/>));
}};`,
  },
  outfile: 'streaming-scroll.js',
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  plugins: baseline
    ? [
        {
          name: 'markdown-baseline',
          setup(builder) {
            builder.onLoad({ filter: /\.[jt]sx?$/ }, args => {
              if (!args.path.startsWith(markdownRoot + path.sep)) return
              const relative = path.relative(repo, args.path).replaceAll('\\', '/')
              return {
                contents: execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: repo, encoding: 'utf8' }),
                loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
                resolveDir: path.dirname(args.path),
              }
            })
          },
        },
      ]
    : [],
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

async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: 600 }, isMobile: width === 390, hasTouch: width === 390 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#app{height:100%;margin:0}body{font:14px Arial;--dsw-font-markdown-base:14px/1.6 Arial;--dsw-font-family:Arial;--dsw-alias-label-primary:#111;--dsw-alias-label-secondary:#555;--dsw-alias-bg-base:white}</style><div id="app"></div>',
  )
  await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
  return { page, errors }
}

async function render(page, text, streaming, citations) {
  await page.evaluate(({ text, streaming, citations }) => window.streamFixture.render(text, streaming, citations), { text, streaming, citations })
  await settle(page)
}

async function geometry(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-conversation-scroll]')
    return {
      height: document.getElementById('message').getBoundingClientRect().height,
      top: scroller.scrollTop,
      floor: scroller.scrollHeight - scroller.clientHeight,
      historyY: document.getElementById('history-anchor').getBoundingClientRect().y,
      composerBottom: document.querySelector('[data-composer-seat]').getBoundingClientRect().bottom,
      spacer: document.querySelector('[data-chat-turn-spacer]').getBoundingClientRect().height,
      documentHeight: document.scrollingElement.scrollHeight,
      windowY: scrollY,
      following: window.streamFixture.reading.followingTail,
      pending: window.streamFixture.reading.pending,
      links: [...document.querySelectorAll('#message a[href]')].map(link => link.getAttribute('href')),
    }
  })
}

const paragraphs = [
  'A conclusion supported by the source[1].',
  'Previously rendered explanation about the result. '.repeat(8),
  'The final paragraph stays above the source metadata.',
]
const url = 'https://example.com/research/' + 'long-address-segment/'.repeat(14) + 'report'

for (const width of [390, 960])
  for (const mode of ['tail', 'history'])
    for (const syntax of ['inline', 'definition']) {
      test(`${width}px ${mode} reading remains stable while a ${syntax} source completes`, async () => {
        const { page, errors } = await open(width)
        try {
          let text = ''
          for (const paragraph of paragraphs) {
            text += (text ? '\n\n' : '') + paragraph
            await render(page, text, true, syntax === 'definition')
          }
          if (mode === 'history') {
            await page.locator('[data-conversation-scroll]').evaluate(element => {
              element.scrollTop = 220
            })
            await settle(page)
            await page.locator('[data-conversation-scroll]').dispatchEvent('scrollend')
            await settle(page)
          }
          const initial = await geometry(page)
          assert.equal(initial.following, mode === 'tail')
          assert.equal(initial.pending, false)
          if (syntax === 'definition') {
            await render(page, text + '\n\n[1]: https://e', true, true)
            assert.deepEqual((await geometry(page)).links, [], 'a partial destination must not become clickable')
            text += '\n\n[1]: ' + url + ' "Source title'
          } else text += '\n\n- [Research comparison](' + url
          await render(page, text, true, syntax === 'definition')
          const pending = await geometry(page)
          text += syntax === 'definition' ? '"' : ')'
          await render(page, text, true, syntax === 'definition')
          const complete = await geometry(page)
          assert.ok(complete.height >= pending.height - 1, JSON.stringify({ pending, complete }))
          assert.deepEqual(pending.links, [])
          assert.ok(complete.links.length > 0)
          assert.ok(
            complete.links.every(href => href === url),
            JSON.stringify(complete.links),
          )
          await render(page, text, false, syntax === 'definition')
          const settled = await geometry(page)
          assert.ok(Math.abs(settled.height - complete.height) <= 1, JSON.stringify({ complete, settled }))
          for (const state of [pending, complete, settled]) {
            assert.equal(state.documentHeight, 600)
            assert.equal(state.windowY, 0)
            assert.equal(state.spacer, 0)
            assert.ok(Math.abs(state.composerBottom - 600) <= 1, JSON.stringify(state))
            if (mode === 'tail') assert.ok(Math.abs(state.top - state.floor) <= 1, JSON.stringify(state))
            else {
              assert.equal(state.top, initial.top)
              assert.equal(state.historyY, initial.historyY)
            }
          }
          assert.deepEqual(errors, [])
        } finally {
          await page.close()
        }
      })
    }
