import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
await mkdir(path.join(root, '.artifacts/frontend-audit-20261111'), { recursive: true })
const directory = await mkdtemp(path.join(root, '.artifacts/frontend-audit-20261111/overlay-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React,{useState,useRef} from 'react'; import {createRoot} from 'react-dom/client';
import {Menu} from './packages/modern-ui/src/vendor/primitives/Menu.tsx';
import {Modal} from './packages/modern-ui/src/vendor/primitives/Modal.tsx';
import {Switch} from './packages/modern-ui/src/vendor/primitives/Switch.tsx';
import {Button} from './packages/modern-ui/src/vendor/primitives/Button.tsx';
import {ModelSelect} from './packages/modern-ui/src/vendor/model/client/ModelSelect.tsx';
import {DiscoverSection} from './packages/modern-ui/src/vendor/plugin-market/DiscoverSection.tsx';
import {useTextInteraction} from './packages/modern-ui/src/vendor/chat/client/chat/text-interaction.ts';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
import './packages/modern-ui/src/vendor/theme/styles/beautiful-ui.css';
import './packages/modern-ui/src/vendor/theme/styles/focus.css';
import './packages/modern-ui/src/vendor/theme/styles/scrollbar.css';
const app=createRoot(document.getElementById('app'));
const translate=(key,values)=>key+(values ? ' '+Object.values(values).join(' ') : '');
const dispatch=()=> 'quote',registered=['quote'];
function QuoteFixture({inset=60,padding=60}) {
 const root=useRef(null),surface=useRef(null),binding=useTextInteraction(root,surface,dispatch,registered);
 return <div style={{position:'relative',width:600}}><div style={{position:'absolute',top:0,left:0,right:0,height:inset,zIndex:8,background:'#eeeeeeaa'}} id="header">Header</div>
 <div data-conversation-scroll id="scrollport" style={{height:280,overflowY:'auto',paddingTop:padding,boxSizing:'border-box','--dsh-scrollport-top-inset':inset+'px'}}>
 <div ref={root} style={{position:'relative',height:1000}}><div id="source" data-text-interaction-source style={{fontSize:16,lineHeight:'24px',marginTop:0,paddingTop:30}}>Quoted text on the first line</div>
 <div ref={surface} id="quote" style={{position:'absolute',visibility:'hidden',zIndex:5}}>{binding.active&&<button style={{height:32,width:100}}>Quote</button>}</div></div></div></div>
}
function MenuFixture({x=600,y=540,count=3,side='bottom'}) {
 const [open,setOpen]=useState(false),[rows,setRows]=useState(count); window.resizeMenu=setRows;
 return <><div id="stream"/><div id="moving" style={{position:'absolute',left:x,top:y}}><Menu open={open} side={side} portal autoFocus onClose={()=>setOpen(false)} onSelect={id=>{window.selected=id;setOpen(false)}} anchor={<Button id="trigger" onClick={()=>setOpen(v=>!v)}>Open</Button>}
 items={[{id:'first',label:'First'},{id:'parent',label:'Parent',submenu:[{id:'child1',label:'Child 1'},{id:'child2',label:'Child 2'}]},{id:'sibling',label:'Sibling',submenu:[{id:'other',label:'Other child'}]},...Array.from({length:rows},(_,i)=>({id:'row'+i,label:'Row '+i}))]}/></div><button id="outside">Outside</button><Switch checked={false} label="Off" onChange={()=>{}}/><Switch checked label="On" onChange={()=>{}}/></>
}
function ModalFixture() { const [open,setOpen]=useState(false);return <><button id="trigger" onClick={()=>setOpen(true)}>Open dialog</button><Modal open={open} onClose={()=>setOpen(false)} title="Tall dialog" closeLabel="Close" footer={<><button onClick={()=>setOpen(false)}>Cancel</button><button>Confirm</button></>}><button data-modal-autofocus>First field</button><div style={{height:900}}>Tall content</div><button id="last-field">Last field</button></Modal></> }
function PickerFixture({x=600,y=540,count=50}) {
 const [state,setState]=useState({groups:[{id:'provider',name:'Provider',models:Array.from({length:count},(_,i)=>({id:'model-'+i,name:'Model '+i}))}],current:{provider:'provider',model:'model-0'},pending:null,status:'ready',error:null,failures:[]});
 window.resizePicker = count => setState(value => ({...value, groups:[{...value.groups[0], models:Array.from({length:count},(_,i)=>({id:'model-'+i,name:'Model '+i}))}]}));
 return <><div id="moving" style={{position:'absolute',left:x,top:y}}><ModelSelect available locked={false} useModelDirectory={f=>f(state)} useModelPicker={f=>f(undefined)} t={translate} renderSlot={(name,props,options)=>options.fallback} load={()=>{}} select={async selection=>{window.selected=selection;setState(v=>({...v,current:selection}));return {ok:true}}}/></div><button id="outside">Outside</button></>
}
function DiscoverFixture({unsafe=false,inline=false}) {
 const version={version:'1.0.0',publishTimestamp:1700000000,source:{type:'npm'},install:{},compatibility:{compatible:true,exempted:false,runtimeVersion:'1.0.0',requirements:{}}};
 const entry={name:'example',title:'Example plugin',homepage:unsafe?'javascript:alert(1)':'https://example.com',repository:{url:unsafe?'data:text/html,test':'https://example.com/repo'},icon:inline?'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36"/></svg>'):'https://example.com/icon.png',defaultVersion:'1.0.0',versions:[version],installation:{status:'not-installed'},metadata:{labels:[]}};
 const query={text:'',category:null,labels:[],sort:{kind:'index'}};
 const value={url:'https://example.com/market',title:'A market with a long name',metadata:{categories:{},labels:{label:{title:'Useful'}},sortKeys:{}},entries:[entry],total:1};
 const state={status:'ready',indexes:[{url:value.url,title:value.title}],selected:value.url,listing:{url:value.url,query,status:'ready',value,answered:query,failure:null},editing:false,draft:'',saving:false,sourceFailure:null};
 const noop=()=>{};
 return <div style={{width:'100%'}}><DiscoverSection useDiscover={f=>f(state)} useLocale={f=>f({active:'en'})} t={translate} resolveText={v=>typeof v==='string'?v:v.en} ensure={noop} reload={noop} select={noop} search={noop} more={noop} refresh={noop} retry={noop} toggleSources={noop} editDraft={noop} addSource={noop} removeSource={noop} install={noop} openPackage={noop} translateDocument={translate}/></div>
}
function NestedModalFixture(){const [open,setOpen]=useState(true);return <Modal open={open} onClose={()=>setOpen(false)} title="Nested modal" closeLabel="Close"><div style={{height:220}}><MenuFixture x={20} y={80}/></div></Modal>}
window.show=({kind='menu',...props}={})=>app.render(kind==='nested'?<NestedModalFixture/>:kind==='modal'?<ModalFixture/>:kind==='picker'?<PickerFixture {...props}/>:kind==='discover'?<DiscoverFixture {...props}/>:kind==='quote'?<QuoteFixture {...props}/>:<MenuFixture {...props}/>);
`,
  },
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  plugins: [
    {
      name: 'overlay-resources',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          resolveDir: path.join(root, 'packages/modern-ui/src/vendor/primitives'),
          loader: 'tsx',
          contents:
            "export * from './icons/index.tsx'; export {Button} from './Button.tsx'; export {Input} from './Input.tsx'; export {isMobileDevice} from './focus.ts'; export {MenuGroup,observeStickyMenuGroups} from './MenuGroup.tsx'; export {MenuSurface} from './MenuSurface.tsx'; export {rankByName} from './rank-by-name.ts'; export {StateDot} from './StateDot.tsx'; export {Switch} from './Switch.tsx'; export {Toast} from './Toast.tsx'; export {Menu} from './Menu.tsx'; export {Modal} from './Modal.tsx'; export {Tag} from './Tag.tsx'; export {Tooltip} from './Tooltip.tsx';",
        }))
        builder.onResolve({ filter: /PluginDocument\.tsx$/ }, () => ({ path: 'document', namespace: 'document' }))
        builder.onLoad({ filter: /.*/, namespace: 'document' }, () => ({ contents: 'export const PluginDocument=()=>null', loader: 'tsx' }))
        if (process.env.AUDIT_OVERLAY_BASELINE)
          builder.onLoad({ filter: /(?:Menu|Modal|Switch|ModelSelect|DiscoverSection)(?:\.module)?\.(?:tsx|css)$|text-interaction\.ts$/ }, args => {
            if (!args.path.startsWith(path.join(root, 'packages/modern-ui/src/vendor') + path.sep)) return
            return {
              contents: execFileSync('git', ['show', process.env.AUDIT_OVERLAY_BASELINE + ':' + path.relative(root, args.path).split(path.sep).join('/')], {
                cwd: root,
                encoding: 'utf8',
              }),
              resolveDir: path.dirname(args.path),
              loader: args.path.endsWith('.module.css') ? 'local-css' : 'tsx',
            }
          })
      },
    },
  ],
})
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(
    name
      ? await readFile(path.join(directory, name))
      : '<!doctype html><link rel="stylesheet" href="/client.css"><style>body{margin:0}button{font-family:Arial}</style><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch(
  process.env.MODERN_UI_BROWSER
    ? { executablePath: process.env.MODERN_UI_BROWSER, headless: true }
    : existsSync(chromium.executablePath())
      ? { headless: true }
      : { channel: 'msedge', headless: true },
)
afterAll(async () => {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

async function fixture(props = {}, contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...contextOptions })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  await page.route('https://example.com/icon.png', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="blue"/></svg>',
    }),
  )
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(props => window.show(props), props)
  await page
    .locator(props.kind === 'nested' ? '[role="dialog"]' : '#app > *')
    .first()
    .waitFor({ state: 'attached' })
  return { context, page }
}

test('model list exposes its active option on mobile and desktop, including empty filters and catalog threshold changes', async () => {
  for (const mobile of [false, true]) {
    const { context, page } = await fixture(
      { kind: 'picker', count: 12, x: 300, y: 450 },
      mobile
        ? {
            isMobile: true,
            hasTouch: true,
            userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/150.0 Mobile Safari/537.36',
          }
        : {},
    )
    try {
      await page.getByRole('button', { name: /trigger/ }).click()
      const list = page.locator('[role="listbox"]'),
        search = page.getByRole('combobox')
      await page.waitForFunction(mobile => document.activeElement?.getAttribute('role') === (mobile ? 'listbox' : 'combobox'), mobile)
      const check = async () => {
        const result = await list.evaluate(el => {
          const id = el.getAttribute('aria-activedescendant')
          const active = id === null ? null : document.getElementById(id)
          return {
            id,
            valid: active !== null && el.contains(active) && active.getAttribute('role') === 'option',
            highlighted: active?.hasAttribute('data-active'),
          }
        })
        assert.equal(result.valid, true, JSON.stringify(result))
        assert.equal(result.highlighted, true)
        assert.equal(await search.getAttribute('aria-activedescendant'), result.id)
      }
      await check()
      for (const key of ['ArrowDown', 'End', 'Home', 'ArrowUp']) {
        await page.keyboard.press(key)
        await check()
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), mobile ? 'listbox' : 'combobox')
      }
      await search.fill('not-a-model-zzzz')
      assert.equal(await list.getAttribute('aria-activedescendant'), null)
      assert.equal(await search.getAttribute('aria-activedescendant'), null)
      await search.fill('Model 1')
      await check()
      await page.evaluate(() => window.resizePicker(8))
      assert.equal(await page.getByRole('combobox').count(), 0)
      assert.equal(await list.evaluate(el => el.contains(document.getElementById(el.getAttribute('aria-activedescendant')))), true)
      await page.evaluate(() => window.resizePicker(12))
      await check()
      await list.focus()
      await page.keyboard.press('End')
      const expected = await list.evaluate(
        el => document.getElementById(el.getAttribute('aria-activedescendant')).querySelector('[data-model-id]').dataset.modelId,
      )
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => window.selected !== undefined)
      assert.equal(await page.evaluate(() => window.selected.model), expected)
    } finally {
      await context.close()
    }
  }
})
test('root menus flip above near the bottom instead of covering their trigger', async () => {
  const { context, page } = await fixture({ x: 600, y: 540 })
  try {
    await page.locator('#trigger').click()
    await page.waitForTimeout(250)
    const box = await page.locator('[role="menu"]').boundingBox(),
      anchor = await page.locator('#trigger').boundingBox()
    assert.ok(box.y + box.height <= anchor.y - 3, JSON.stringify({ box, anchor }))
    assert.equal(await page.locator('[role="menu"]').getAttribute('data-menu-side'), 'top')
  } finally {
    await context.close()
  }
})
test('a flipped portaled child owns its keys and clicks while the long parent remains scrollable', async () => {
  const { context, page } = await fixture({ x: 760, y: 360, count: 70 })
  try {
    await page.locator('#trigger').click()
    const parent = page.getByRole('menuitem', { name: 'Parent', exact: true })
    await parent.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.getByRole('menuitem', { name: 'Child 1', exact: true }).evaluate(el => el === document.activeElement), true)
    const child = page.locator('[role="menu"]').last(),
      bounds = await child.boundingBox(),
      anchor = await parent.boundingBox()
    assert.ok(bounds.x >= 12 && bounds.x + bounds.width <= 788)
    assert.ok(bounds.x + bounds.width <= anchor.x, JSON.stringify({ bounds, anchor }))
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.getByRole('menuitem', { name: 'Child 2' }).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('ArrowLeft')
    assert.equal(await page.locator('[role="menu"]').count(), 1)
    assert.equal(await parent.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 1)
    await page.keyboard.press('End')
    const last = page.getByRole('menuitem', { name: 'Row 69', exact: true })
    const menu = page.locator('[role="menu"]')
    const mb = await menu.boundingBox(),
      lb = await last.boundingBox()
    assert.ok(lb.y >= mb.y && lb.y + lb.height <= mb.y + mb.height, JSON.stringify({ mb, lb }))
    assert.ok((await last.evaluate(el => el.parentElement.parentElement.scrollTop)) > 0)
    await parent.focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('menuitem', { name: 'Child 1', exact: true }).click()
    assert.equal(await page.evaluate(() => window.selected), 'child1')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
  } finally {
    await context.close()
  }
})
test('submenu hover crosses its gap, switches siblings, closes outside, and retains macOS backings', async () => {
  const { context, page } = await fixture({ x: 760, y: 260 })
  try {
    await page.evaluate(() => (document.documentElement.dataset.platform = 'darwin'))
    await page.locator('#trigger').click()
    const parent = page.getByRole('menuitem', { name: 'Parent', exact: true })
    await parent.hover()
    await page.waitForTimeout(200)
    const p = await parent.boundingBox(),
      child = page.getByRole('menuitem', { name: 'Child 1', exact: true }),
      c = await child.boundingBox()
    await page.mouse.move(p.x + 2, p.y + p.height / 2)
    await page.mouse.move((p.x + c.x + c.width) / 2, p.y + p.height / 2, { steps: 3 })
    await page.mouse.move(c.x + c.width - 2, c.y + c.height / 2, { steps: 5 })
    assert.equal(await child.isVisible(), true)
    assert.equal(await page.locator('[data-menu-backing]').count(), 2)
    const matching = await page.locator('[data-menu-backing]').evaluateAll(nodes =>
      nodes.every(node => {
        const p = getComputedStyle(node),
          r = node.getBoundingClientRect()
        return p.display !== 'none' && r.width > 100 && r.height > 30
      }),
    )
    assert.equal(matching, true)
    await page.getByRole('menuitem', { name: 'Sibling', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Other child' }).waitFor()
    assert.equal(await child.count(), 0)
    await page.locator('#outside').click()
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('[data-menu-backing]').count(), 0)
  } finally {
    await context.close()
  }
})
test('menu idle frames cache dimensions, streaming still measures layout, and position-only movement stays anchored', async () => {
  const { context, page } = await fixture({ x: 400, y: 400 })
  try {
    await page.locator('#trigger').click()
    await page.waitForTimeout(300)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const records = {}
    for (const stream of [false, true]) {
      const before = await cdp.send('Performance.getMetrics')
      const counts = await page.evaluate(async stream => {
        const anchor = document.getElementById('trigger').parentElement,
          panel = document.querySelector('[role="menu"]')
        let rects = 0,
          dimensions = 0,
          frames = 0
        const read = anchor.getBoundingClientRect.bind(anchor)
        anchor.getBoundingClientRect = () => {
          rects++
          return read()
        }
        for (const key of ['offsetWidth', 'offsetHeight']) {
          const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)
          Object.defineProperty(panel, key, {
            configurable: true,
            get() {
              dimensions++
              return desc.get.call(this)
            },
          })
        }
        const start = performance.now()
        while (performance.now() - start < 300) {
          await new Promise(requestAnimationFrame)
          frames++
          if (stream) document.getElementById('stream').append(document.createTextNode('Streamed tokens ' + frames + ' '))
        }
        return { rects, dimensions, frames }
      }, stream)
      const after = await cdp.send('Performance.getMetrics')
      counts.layouts = after.metrics.find(m => m.name === 'LayoutCount').value - before.metrics.find(m => m.name === 'LayoutCount').value
      records[stream ? 'streaming' : 'idle'] = counts
    }
    const lag = await page.evaluate(async () => {
      const moving = document.getElementById('moving'),
        anchor = document.getElementById('trigger').parentElement,
        panel = document.querySelector('[role="menu"]')
      let max = 0,
        samples = 0
      const a = moving.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100px)' }], { duration: 350, fill: 'forwards' })
      while (a.playState !== 'finished') {
        await new Promise(requestAnimationFrame)
        max = Math.max(max, Math.abs(anchor.getBoundingClientRect().left - panel.getBoundingClientRect().left))
        samples++
      }
      return { max, samples }
    })
    assert.ok(lag.max < 18, JSON.stringify(lag))
    assert.ok(lag.samples > 5)
    await writeFile(
      path.join(
        root,
        '.artifacts/frontend-audit-20261111/' +
          (process.env.AUDIT_OVERLAY_BASELINE ? 'menu-position-baseline-measurements.json' : 'menu-position-measurements.json'),
      ),
      JSON.stringify({ ...records, positionOnly: lag }),
    )
    assert.equal(records.idle.dimensions, 0)
    assert.equal(records.idle.layouts, 0)
    assert.equal(records.streaming.dimensions, 0)
  } finally {
    await context.close()
  }
})
test('short modals keep footer actions visible and all body controls reachable at normal and simulated 200% CSS zoom', async () => {
  for (const zoom of [1, 2]) {
    const { context, page } = await fixture({ kind: 'modal' }, { viewport: { width: 640, height: 320 } })
    try {
      await page.evaluate(zoom => (document.documentElement.style.zoom = zoom), zoom)
      await page.locator('#trigger').click()
      const dialog = page.getByRole('dialog'),
        box = await dialog.boundingBox()
      assert.ok(box.y >= 0 && box.y + box.height <= 320, JSON.stringify({ zoom, box }))
      for (const label of ['Cancel', 'Confirm']) {
        const b = await page.getByRole('button', { name: label, exact: true }).boundingBox()
        assert.ok(b.y >= 0 && b.y + b.height <= 320)
      }
      await page.locator('#last-field').focus()
      const last = await page.locator('#last-field').boundingBox()
      assert.ok(last.y >= box.y && last.y + last.height <= box.y + box.height)
      await page.keyboard.press('Escape')
      assert.equal(await dialog.count(), 0)
      assert.equal(await page.locator('#trigger').evaluate(el => el === document.activeElement), true)
    } finally {
      await context.close()
    }
  }
})
test('picker uses simulated visual viewport offsets and keyboard height while coarse search keeps a 16px font', async () => {
  const { context, page } = await fixture({ kind: 'picker', count: 80 }, { viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true })
  try {
    await page.locator('[aria-haspopup="dialog"]').click()
    await page.evaluate(() => {
      Object.defineProperties(visualViewport, {
        height: { configurable: true, get: () => 340 },
        width: { configurable: true, get: () => 320 },
        offsetTop: { configurable: true, get: () => 90 },
        offsetLeft: { configurable: true, get: () => 30 },
      })
      visualViewport.dispatchEvent(new Event('resize'))
      visualViewport.dispatchEvent(new Event('scroll'))
    })
    await page.waitForTimeout(250)
    const box = await page.getByRole('dialog').boundingBox()
    assert.ok(box.y >= 102 && box.y + box.height <= 418, JSON.stringify(box))
    assert.ok(box.x >= 42 && box.x + box.width <= 338, JSON.stringify(box))
    assert.ok(box.height > 150)
    assert.equal(await page.locator('input').evaluate(el => getComputedStyle(el).fontSize), '16px')
  } finally {
    await context.close()
  }
})
test('picker ignores 229 and the post-composition key, then accepts a normal selection', async () => {
  const { context, page } = await fixture({ kind: 'picker' })
  try {
    await page.locator('[aria-haspopup="dialog"]').click()
    const search = page.locator('input')
    await search.focus()
    for (const type of ['229', 'composing', 'ended']) {
      await search.evaluate((el, type) => {
        if (type === 'ended') el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            keyCode: type === '229' ? 229 : 13,
            isComposing: type === 'composing',
            bubbles: true,
            cancelable: true,
          }),
        )
      }, type)
      assert.equal(await page.getByRole('dialog').count(), 1)
      assert.equal(await page.evaluate(() => window.selected), undefined)
    }
    await search.evaluate(el => el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })))
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    assert.ok(await page.evaluate(() => window.selected))
    assert.equal(await page.getByRole('dialog').count(), 0)
  } finally {
    await context.close()
  }
})
test('picker scrollbar pointer and drag keep it open, while an external focus change closes', async () => {
  const { context, page } = await fixture({ kind: 'picker', count: 80 })
  try {
    await page.locator('[aria-haspopup="dialog"]').click()
    await page.locator('input').focus()
    const list = page.getByRole('listbox'),
      b = await list.boundingBox()
    await page.mouse.move(b.x + b.width - 3, b.y + 15)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width - 3, b.y + b.height - 15, { steps: 8 })
    await page.mouse.up()
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.locator('#outside').focus()
    assert.equal(await page.getByRole('dialog').count(), 0)
  } finally {
    await context.close()
  }
})
test('Discover wraps its toolbar at 320px and restores focus after install confirmation', async () => {
  const { context, page } = await fixture({ kind: 'discover' }, { viewport: { width: 320, height: 640 } })
  try {
    const section = page.locator('[data-plugin-tab] > div').first()
    assert.ok(
      await section.evaluate(el => el.scrollWidth <= el.clientWidth),
      JSON.stringify(
        await section.evaluate(el => ({
          scroll: el.scrollWidth,
          client: el.clientWidth,
          overflow: [...el.querySelectorAll('*')]
            .filter(n => n.getBoundingClientRect().right > 321)
            .slice(0, 10)
            .map(n => ({
              class: n.className,
              right: n.getBoundingClientRect().right,
              width: n.getBoundingClientRect().width,
              text: n.textContent.slice(0, 30),
            })),
        })),
      ),
    )
    const install = page.getByRole('button', { name: 'installTitle Example plugin', exact: true })
    await install.focus()
    await install.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'install', exact: true }).evaluate(el => el === document.activeElement), true)
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click()
    assert.equal(await install.evaluate(el => el === document.activeElement), true)
  } finally {
    await context.close()
  }
})
test('Discover external metadata accepts only HTTP links and preserves existing lazy images', async () => {
  for (const unsafe of [false, true]) {
    const { context, page } = await fixture({ kind: 'discover', unsafe })
    try {
      await page.getByRole('button', { name: 'openEntry Example plugin', exact: true }).click()
      const links = page.locator('[data-market-detail] a')
      assert.equal(await links.count(), 2)
      const hrefs = await links.evaluateAll(nodes => nodes.map(n => n.getAttribute('href')))
      assert.equal(
        hrefs.every(h => (unsafe ? h === null : h.startsWith('https:'))),
        true,
      )
      if (!unsafe) {
        const image = page.locator('[data-market-detail] img')
        assert.equal(await image.count(), 1)
        assert.equal(await image.getAttribute('loading'), 'lazy')
      }
    } finally {
      await context.close()
    }
  }
})
test('quote surface respects the overlaid scrollport inset once, independently of content padding', async () => {
  for (const padding of [60, 90]) {
    const { context, page } = await fixture({ kind: 'quote', inset: 60, padding })
    try {
      await page.locator('#source').evaluate(el => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const selection = document.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
      await page.locator('#quote button').waitFor()
      await page.waitForTimeout(100)
      const quote = await page.locator('#quote').boundingBox()
      assert.ok(quote.y >= 60, JSON.stringify({ padding, quote }))
      if (padding === 90) assert.ok(quote.y < 100, JSON.stringify(quote))
    } finally {
      await context.close()
    }
  }
})
test('forced colors retain a focused menu row and both switch track/thumb boundaries', async () => {
  const { context, page } = await fixture({ x: 400, y: 400 }, { forcedColors: 'active' })
  try {
    await page.locator('#trigger').click()
    await page.keyboard.press('ArrowDown')
    const row = page.getByRole('menuitem', { name: 'Parent', exact: true })
    const style = await row.evaluate(el => {
      const s = getComputedStyle(el)
      return { outline: s.outlineStyle, bg: s.backgroundColor, color: s.color }
    })
    assert.notEqual(style.outline, 'none')
    assert.notEqual(style.bg, style.color)
    for (const name of ['On', 'Off']) {
      const styles = await page.getByRole('switch', { name, exact: true }).evaluate(el => ({
        border: getComputedStyle(el).borderTopStyle,
        bg: getComputedStyle(el).backgroundColor,
        thumb: getComputedStyle(el.firstElementChild).backgroundColor,
      }))
      assert.equal(styles.border, 'solid')
      assert.notEqual(styles.bg, styles.thumb)
    }
  } finally {
    await context.close()
  }
})
test('right-facing root menus flip left at the viewport edge', async () => {
  const { context, page } = await fixture({ x: 760, y: 220, side: 'right' })
  try {
    await page.locator('#trigger').click()
    await page.waitForTimeout(250)
    const menu = page.locator('[role="menu"]'),
      b = await menu.boundingBox(),
      a = await page.locator('#trigger').boundingBox()
    assert.ok(b.x + b.width <= a.x - 3, JSON.stringify({ b, a }))
    assert.equal(await menu.getAttribute('data-menu-side'), 'left')
  } finally {
    await context.close()
  }
})
test('submenu geometry stays inside the viewport and parent overflow scrolls without relying on arrow support', async () => {
  const { context, page } = await fixture({ x: 760, y: 300, count: 70 })
  try {
    await page.locator('#trigger').click()
    await page.getByRole('menuitem', { name: 'Parent', exact: true }).focus()
    await page.waitForTimeout(250)
    const menus = page.locator('[role="menu"]'),
      child = await menus.last().boundingBox(),
      parent = await menus.first().boundingBox()
    assert.ok(child.x >= 12 && child.x + child.width <= 788, JSON.stringify(child))
    assert.ok(parent.y >= 12 && parent.y + parent.height <= 588, JSON.stringify(parent))
    const overflow = await page.getByRole('menuitem', { name: 'Row 69', exact: true }).evaluate(el => {
      const p = el.parentElement.parentElement
      return { scroll: p.scrollHeight, height: p.clientHeight, overflow: getComputedStyle(p).overflowY }
    })
    assert.ok(overflow.scroll > overflow.height)
    assert.equal(overflow.overflow, 'auto')
  } finally {
    await context.close()
  }
})
test('Discover installation confirmation restores its trigger independently of toolbar width', async () => {
  const { context, page } = await fixture({ kind: 'discover' })
  try {
    const trigger = page.getByRole('button', { name: 'installTitle Example plugin', exact: true })
    await trigger.focus()
    await trigger.click()
    await page.getByRole('dialog').getByRole('button', { name: 'cancel', exact: true }).click()
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
  } finally {
    await context.close()
  }
})
test('coarse-pointer model search uses a 16px font independently of viewport placement', async () => {
  const { context, page } = await fixture({ kind: 'picker', x: 100, y: 450 }, { hasTouch: true, isMobile: true })
  try {
    await page.locator('[aria-haspopup="dialog"]').click()
    assert.equal(await page.locator('input').evaluate(el => getComputedStyle(el).fontSize), '16px')
  } finally {
    await context.close()
  }
})
test('both switch states retain distinct forced-color track and thumb boundaries', async () => {
  const { context, page } = await fixture({ x: 400, y: 400 }, { forcedColors: 'active' })
  try {
    const values = []
    for (const name of ['On', 'Off']) {
      const control = page.getByRole('switch', { name, exact: true })
      await control.focus()
      values.push(
        await control.evaluate(el => ({
          checked: el.getAttribute('aria-checked'),
          border: getComputedStyle(el).borderTopStyle,
          track: getComputedStyle(el).backgroundColor,
          thumb: getComputedStyle(el.firstElementChild).backgroundColor,
          focusOutline: getComputedStyle(el).outlineStyle,
        })),
      )
    }
    await writeFile(
      path.join(root, '.artifacts/frontend-audit-20261111/' + (process.env.AUDIT_OVERLAY_BASELINE ? 'switch-colors-baseline.json' : 'switch-colors.json')),
      JSON.stringify(values),
    )
    for (const state of values) {
      assert.equal(state.border, 'solid', JSON.stringify(state))
      assert.notEqual(state.track, state.thumb, JSON.stringify(state))
      assert.equal(state.focusOutline, 'solid', JSON.stringify(state))
    }
  } finally {
    await context.close()
  }
})
test('model search preserves its panel during composition and the post-composition Escape, then closes normally', async () => {
  const { context, page } = await fixture({ kind: 'picker' })
  try {
    await page.locator('[aria-haspopup="dialog"]').click()
    const search = page.locator('input')
    await search.focus()
    await search.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 1)
    await search.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    assert.equal(await page.getByRole('dialog').count(), 1)
    await search.evaluate(el => el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })))
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
  } finally {
    await context.close()
  }
})
test('Discover preserves host-supported base64 data icons with lazy no-referrer loading', async () => {
  const { context, page } = await fixture({ kind: 'discover', inline: true })
  try {
    const image = page.locator('img')
    await image.waitFor()
    assert.ok((await image.getAttribute('src')).startsWith('data:image/svg+xml;base64,'))
    assert.equal(await image.getAttribute('loading'), 'lazy')
    assert.equal(await image.getAttribute('referrerpolicy'), 'no-referrer')
    assert.equal(await image.evaluate(el => el.complete && el.naturalWidth > 0), true)
  } finally {
    await context.close()
  }
})
test('portaled submenu Escape closes one layer at a time inside a real modal', async () => {
  const { context, page } = await fixture({ kind: 'nested' })
  try {
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Parent', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 1)
    assert.equal(await dialog.count(), 1)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await dialog.count(), 1)
    assert.equal(await dialog.getByRole('button', { name: 'Open', exact: true }).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Escape')
    assert.equal(await dialog.count(), 0)
  } finally {
    await context.close()
  }
})
