import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { build } from './helpers/client-build.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workspaceSource = readFileSync(new URL('../../packages/modern-ui/src/vendor/workspace/client/rows/WorkspaceBrowser.tsx', import.meta.url), 'utf8')
const primitiveNames = workspaceSource.match(/import \{\s*(AnimatedRows,[\s\S]*?)\} from '@iroha1145\/dsh-modern-ui\/primitives'/)[1].match(/\w+/g)
const result = await build({
  absWorkingDir: root,
  tsconfigRaw: {},
  bundle: true,
  write: false,
  outfile: 'fixture.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {DetailDocument} from './packages/modern-ui/src/vendor/primitives/DetailDocument.tsx';
      import {SearchResults} from './packages/modern-ui/src/vendor/workspace/client/rows/WorkspaceBrowser.tsx';
      const root=createRoot(document.getElementById('app'));
      const labels={title:'Document',loading:'Loading document',retry:'Retry',markdown:{}};
      const list={phase:'ready',ids:[],byId:{},projectionsBySession:{}};
      let mode='detail',query='first';
      const render=state=>flushSync(()=>root.render(mode==='detail'
        ? <DetailDocument state={state} labels={labels} onRetry={()=>{}}/>
        : <SearchResults useSessions={select=>select(list)} useSessionStatus={select=>select(new Map())}
            usePanelInfo={select=>select({activePanelId:null})} useSessionAccess={()=>true}
            open={()=>{}} onUnarchive={()=>{}} workspaces={[]} archivedSessionIds={[]} archivedFilter="default"
            query={query} remote={{query,status:state.status,items:[],hasMore:false}} resultLimit={50} t={key=>key}/>));
      window.fixture={
        local(enabled) {
          list.ids=enabled?['local']:[];
          list.byId=enabled?{local:{id:'local',title:'first second',blank:false,running:false,retainedBy:{},updatedAt:1,cwd:'/workspace'}}:{};
        },
        start(nextMode,nextQuery='first') {mode=nextMode;query=nextQuery;render({status:'loading'});},
        settle() {render(mode==='detail'?{status:'found',markdown:'Ready document'}:{status:'ready'});},
        fail() {render({status:'error',message:'Read failed'});},
        clear() {flushSync(()=>root.render(null));}
      };
    `,
  },
  plugins: [
    {
      name: 'loading-surroundings',
      setup(builder) {
        builder.onLoad({ filter: /WorkspaceBrowser\.tsx$/ }, args => ({
          contents: `${readFileSync(args.path, 'utf8')}\nexport {SearchResults}`,
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'loading' }))
        builder.onLoad({ filter: /.*/, namespace: 'loading' }, () => ({ contents: primitiveNames.map(name => `export const ${name}=()=>null;`).join('\n') }))
        builder.onResolve({ filter: /\/Rows\.tsx$/ }, () => ({ path: 'rows', namespace: 'rows' }))
        builder.onLoad({ filter: /.*/, namespace: 'rows' }, () => ({
          contents:
            'export const ProjectRowItem=()=>null,SessionNodeItem=()=>null; export const SearchResultItem=({result})=><div role="treeitem" tabIndex={0}>{result.title}</div>;',
          loader: 'tsx',
          resolveDir: root,
        }))
        builder.onResolve({ filter: /WorkspacePicker\.tsx$/ }, () => ({ path: 'picker', namespace: 'picker' }))
        builder.onLoad({ filter: /.*/, namespace: 'picker' }, () => ({ contents: 'export const WorkspacePickFlow=()=>null;' }))
        builder.onResolve({ filter: /\/markdown\/MarkdownText\.tsx$/ }, () => ({ path: 'markdown', namespace: 'markdown' }))
        builder.onLoad({ filter: /.*/, namespace: 'markdown' }, () => ({ contents: 'export const MarkdownText=({text})=>text;' }))
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

async function pageFixture(reducedMotion) {
  const page = await browser.newPage({ reducedMotion, viewport: { width: 800, height: 600 } })
  await page.setContent(
    '<style>body{margin:0}#app{width:320px;height:400px;display:flex;flex-direction:column;--dsh-session-list-edge-inset:8px;--dsh-session-list-scrollbar-width:5px;--dsh-session-list-scrollbar-offset:2px;--dsw-alias-bg-skeleton:#ccc}#after{height:20px}</style><div id="app"></div><div id="after">After</div>',
  )
  await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.addScriptTag({ content: `window.measure=${measure.toString()}` })
  return page
}

function measure() {
  const status = document.querySelector('[role="status"]')
  const bars = [...(status?.querySelectorAll('span') ?? [])].filter(node => getComputedStyle(node).backgroundColor === 'rgb(204, 204, 204)')
  const rect = status?.getBoundingClientRect()
  return {
    status: status?.getAttribute('aria-label'),
    busy: status?.getAttribute('aria-busy'),
    painted: bars.some(node => getComputedStyle(node).visibility === 'visible'),
    height: rect?.height,
    width: rect?.width,
    after: document.querySelector('#after').getBoundingClientRect().top,
  }
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`loading placeholders reserve space and avoid quick/repeated flashes (${reducedMotion})`, async () => {
    const page = await pageFixture(reducedMotion)
    try {
      for (const mode of ['detail', 'search']) {
        await page.evaluate(() => fixture.clear())
        const first = await page.evaluate(mode => {
          fixture.start(mode)
          return measure()
        }, mode)
        assert.equal(first.status, mode === 'detail' ? 'Loading document' : 'search.pending')
        assert.equal(first.busy, 'true')
        assert.equal(first.painted, false)
        assert.equal(first.height, mode === 'detail' ? 56 : 96)
        // Search pending includes its existing 250ms request debounce.
        await page.waitForTimeout(mode === 'search' ? 300 : 50)
        assert.equal((await page.evaluate(measure)).painted, false)
        await page.evaluate(() => fixture.settle())
        assert.equal(await page.locator('[role="status"]').count(), 0)
        assert.equal(await page.locator(mode === 'detail' ? '[role="region"]' : 'text=search.noMatches').count(), 1)
        await page.waitForTimeout(200)
        assert.equal(await page.locator('[role="status"]').count(), 0)

        const second = await page.evaluate(mode => {
          fixture.start(mode, 'second')
          return measure()
        }, mode)
        assert.equal(second.painted, false)
        await page.waitForFunction(() => measure().painted)
        const slow = await page.evaluate(measure)
        assert.equal(slow.height, second.height)
        assert.equal(slow.width, second.width)
        assert.equal(slow.after, second.after)
        if (reducedMotion === 'reduce') {
          const opacity = await page
            .locator('[role="status"] span')
            .first()
            .evaluate(node => getComputedStyle(node).opacity)
          await page.waitForTimeout(100)
          assert.equal(
            await page
              .locator('[role="status"] span')
              .first()
              .evaluate(node => getComputedStyle(node).opacity),
            opacity,
          )
        }
        if (mode === 'search') {
          const replacement = await page.evaluate(() => {
            fixture.start('search', 'third')
            return measure()
          })
          assert.equal(replacement.painted, false, 'a new query restarts the decorative delay while the prior query was still pending')
          assert.equal(replacement.height, slow.height)
        }
        await page.evaluate(() => fixture.settle())
        assert.equal(await page.locator('[role="status"]').count(), 0)
      }
      await page.evaluate(() => {
        fixture.start('detail')
        fixture.fail()
      })
      assert.equal(await page.locator('[role="alert"]').textContent(), 'Read failed')
      assert.equal(await page.getByRole('button', { name: 'Retry' }).count(), 1)
      await page.waitForTimeout(200)
      assert.equal(await page.locator('[role="status"]').count(), 0)

      await page.evaluate(() => {
        fixture.local(true)
        fixture.start('search', 'first')
      })
      assert.equal((await page.evaluate(measure)).height, 48, 'local matches reserve only one pending row')
      await page.waitForFunction(() => measure().painted)
      await page.getByRole('treeitem').focus()
      const replacement = await page.evaluate(() => {
        const tree = document.querySelector('[role="tree"]')
        const row = document.activeElement
        fixture.start('search', 'second')
        return { ...measure(), sameTree: tree === document.querySelector('[role="tree"]'), sameFocus: row === document.activeElement }
      })
      assert.equal(replacement.painted, false)
      assert.equal(replacement.height, 48)
      assert.equal(replacement.sameTree, true)
      assert.equal(replacement.sameFocus, true)
      const rapidQueries = await page.evaluate(async () => {
        const painted = []
        for (const query of ['none-1', 'none-2', 'none-3']) {
          fixture.start('search', query)
          await new Promise(resolve => setTimeout(resolve, 40))
          painted.push(measure().painted)
        }
        fixture.settle()
        return painted
      })
      assert.deepEqual(rapidQueries, [false, false, false])
      await page.waitForTimeout(450)
      assert.equal(await page.locator('[role="status"]').count(), 0, 'settled quick queries never reveal a late placeholder')
    } finally {
      await page.close()
    }
  })
}
