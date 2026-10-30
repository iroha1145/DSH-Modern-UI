import { test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const source = name => path.join(root, 'packages/modern-ui/src', name)
const production = JSON.parse(await readFile(path.join(root, 'packages/modern-ui/lib/build-inputs.json'), 'utf8'))
async function load(name) {
  const directory = await mkdtemp(path.join(tmpdir(), 'modern-performance-'))
  try {
    const outfile = path.join(directory, 'module.mjs')
    await build({ entryPoints: [source(name)], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
    return await import(pathToFileURL(outfile).href)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('production conditions select Lexical production artifacts', async () => {
  assert.ok(production.inputs.some(name => name.endsWith('Lexical.prod.mjs')))
  assert.ok(!production.inputs.some(name => /(?:lexical|@lexical).*\.dev\.mjs$/.test(name)))
  console.info(`Actual production client bundle: ${production.outputs['client.js'].bytes} bytes`)
})

test('site glyph barrel retains only referenced icon paths in output', async () => {
  const inputs = production.outputs['client.js'].inputs
  const icon = Object.entries(inputs).find(([name]) => name.endsWith('simple-icons/index.mjs'))
  assert.ok(icon)
  assert.ok(icon[1].bytesInOutput < 200_000, `retained icon bytes: ${icon[1].bytesInOutput}`)
  console.info(`simple-icons bytes retained in the full production bundle: ${icon[1].bytesInOutput}`)
})

test('chat builder keeps the node store stable across updates and replaces it with the builder', async () => {
  const { ChatSnapshotBuilder } = await load('vendor/chat/client/conversation-nodes/chat-snapshot-builder.ts')
  const builder = new ChatSnapshotBuilder()
  const timeline = { turnOrder: [], turns: new Map() }
  const store = builder.replace({ nodes: [], timeline }).nodes
  for (let index = 0; index < 100; index++) assert.equal(builder.apply({ upserts: [], timeline }).nodes, store)
  assert.equal(builder.replace({ nodes: [], timeline }).nodes, store)
  assert.notEqual(new ChatSnapshotBuilder().empty.nodes, store)
})

test('sprite parses once and preserves every symbol attribute and child', async () => {
  const { createIconSprite } = await load('vendor/theme/client/icon-sprite.ts')
  const { ICON_SYMBOLS } = await load('vendor/primitives/icons/artwork.ts')
  const dom = new JSDOM('<!doctype html><body></body>')
  try {
    let parses = 0
    const original = dom.window.DOMParser.prototype.parseFromString
    dom.window.DOMParser.prototype.parseFromString = function (...args) {
      parses++
      return original.apply(this, args)
    }
    const sprite = createIconSprite(dom.window.document)
    assert.equal(parses, 1)
    assert.equal(sprite.children.length, Object.keys(ICON_SYMBOLS).length)
    const parser = new dom.window.DOMParser()
    for (const [id, svg] of Object.entries(ICON_SYMBOLS)) {
      const expected = parser.parseFromString(svg, 'image/svg+xml').documentElement
      const symbol = [...sprite.children].find(element => element.id === id)
      assert.ok(symbol, id)
      for (const attribute of expected.attributes) {
        if (!attribute.name.startsWith('xmlns')) assert.equal(symbol.getAttribute(attribute.name), attribute.value, id)
      }
      assert.equal(symbol.childNodes.length, expected.childNodes.length, id)
      for (let index = 0; index < symbol.childNodes.length; index++) {
        assert.ok(symbol.childNodes[index].isEqualNode(expected.childNodes[index]), id)
      }
    }
    console.info(`${sprite.children.length} symbols retained with one XML parse`)
  } finally {
    dom.window.close()
  }
})

test('community folds avoid rescanning unchanged ancestors and preserve replacement and removal', async () => {
  const { installCommunityMarkdown } = await load('community-markdown.ts')
  const dom = new JSDOM('<!doctype html><body><section data-dsh-better-sidebar><div class="nArs4W_editorMd"></div></section><div id="chat"></div></body>')
  const previousDocument = globalThis.document
  globalThis.document = dom.window.document
  const cleanups = []
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  try {
    installCommunityMarkdown({ effect: callback => cleanups.push(callback()), locale: { bind: () => key => key, subscribe: () => () => {} } })
    const document = dom.window.document
    const preview = document.querySelector('.nArs4W_editorMd')
    const markup = '<div class="md-code-block"><div data-code-block-banner></div><pre data-code-block-content>code</pre></div>'
    preview.innerHTML = markup
    await tick()
    const block = preview.firstElementChild
    let button = block.querySelector('button')
    assert.ok(button)
    button.click()
    assert.equal(block.querySelector('pre').hidden, true)
    let previewScans = 0
    const query = preview.querySelectorAll.bind(preview)
    preview.querySelectorAll = (...args) => {
      previewScans++
      return query(...args)
    }
    for (let index = 0; index < 20; index++) preview.append('token')
    await tick()
    assert.equal(previewScans, 0)
    console.info('20 streamed text additions cause zero scans of the existing preview subtree')
    block.querySelector('pre').replaceWith(document.createElement('pre'))
    block.querySelector('pre').setAttribute('data-code-block-content', '')
    await tick()
    button = block.querySelector('button')
    assert.equal(block.querySelectorAll('button').length, 1)
    assert.equal(button.getAttribute('aria-expanded'), 'false')
    const outside = document.createElement('div')
    document.body.append(outside)
    outside.append(block)
    await tick()
    assert.equal(block.querySelector('button'), null)
    preview.append(block)
    await tick()
    assert.ok(block.querySelector('button'))
    block.setAttribute('data-mermaid-processed', '')
    await tick()
    assert.equal(block.querySelector('button'), null)
  } finally {
    cleanups.reverse().forEach(cleanup => cleanup?.())
    globalThis.document = previousDocument
    dom.window.close()
  }
})
