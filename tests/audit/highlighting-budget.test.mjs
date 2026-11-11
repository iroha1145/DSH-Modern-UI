import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
await mkdir(path.join(root, '.artifacts'), { recursive: true })
const directory = await mkdtemp(path.join(root, '.artifacts/highlighting-'))
await build({
  absWorkingDir: root,
  entryPoints: ['tests/fixtures/highlighting-budget.tsx'],
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  plugins: [
    {
      name: 'measure-real-highlighter',
      setup(builder) {
        builder.onResolve({ filter: /^shiki\/core$/ }, () => ({ path: 'core', namespace: 'measured-core' }))
        builder.onLoad({ filter: /.*/, namespace: 'measured-core' }, () => ({
          resolveDir: root,
          loader: 'js',
          contents: `export * from ${JSON.stringify(fileURLToPath(import.meta.resolve('shiki/core')))};
import {createHighlighterCoreSync as create} from ${JSON.stringify(fileURLToPath(import.meta.resolve('shiki/core')))};
export function createHighlighterCoreSync(options) {
  const instance = create(options);
  for (const method of ['codeToHtml', 'codeToTokens', 'codeToTokensBase']) {
    const original = instance[method].bind(instance);
    instance[method] = (code, options) => {
      const start = performance.now();
      if (window.highlightCalls.length === 0) void window.firstTokenization?.();
      const result = original(code, options);
      window.highlightCalls.push({method, language: options.lang, chars: code.length, duration: performance.now() - start});
      return result;
    };
  }
  return instance;
}`,
        }))
      },
    },
  ],
})
const server = createServer(async (req, res) => {
  const file = req.url === '/client.js' ? 'client.js' : req.url === '/client.css' ? 'client.css' : null
  res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html')
  res.end(
    file
      ? await readFile(path.join(directory, file))
      : `<!doctype html><link rel="stylesheet" href="/client.css">
<style>:root{--dsw-font-markdown-code-block:14px/20px monospace}body{font:14px Arial}section{max-height:160px;overflow:auto}input{position:fixed;top:0;right:0}</style>
<input aria-label="Message"><div id="app"></div><script>window.highlightCalls=[];</script><script type="module" src="/client.js"></script>`,
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
async function fixture(run) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => window.highlightCalls.length >= 3 && typeof window.show === 'function')
    await page.evaluate(() => {
      window.highlightCalls = []
    })
    await run(page)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
}

test('loading Python leaves mounted completed TypeScript fences and read cards untouched', async () => {
  await fixture(async page => {
    const code = 'const answer: number = 42\n'.repeat(15)
    await page.evaluate(
      code =>
        window.show([
          { code, lang: 'TS' },
          { code, lang: 'typescript' },
          { code, lang: 'js' },
          { code, lang: 'ts', read: true },
        ]),
      code,
    )
    await page.waitForFunction(() => document.querySelectorAll('.shiki').length === 3 && document.querySelector('[data-read] [style*="--shiki-"]'))
    const before = await page.evaluate(() => window.highlightCalls.filter(call => call.language === 'typescript').length)
    await page.evaluate(
      code =>
        window.show([
          { code, lang: 'TS' },
          { code, lang: 'typescript' },
          { code, lang: 'js' },
          { code, lang: 'ts', read: true },
          { code: 'print("ready")', lang: 'PY' },
        ]),
      code,
    )
    await page.waitForFunction(() => document.querySelector('[data-block="4"] .shiki'))
    assert.equal(await page.evaluate(() => window.highlightCalls.filter(call => call.language === 'typescript').length), before)
    const color = await page
      .locator('.shiki span[style]')
      .first()
      .evaluate(span => {
        document.documentElement.style.setProperty('--shiki-token-keyword', 'rgb(11, 22, 33)')
        return getComputedStyle(span).color
      })
    assert.equal(color, 'rgb(11, 22, 33)')
  })
})

test('large completed fences are readable before tokenization and allow input while work yields', async () => {
  await fixture(async page => {
    let typing
    await page.exposeBinding('firstTokenization', () => {
      typing ??= page.keyboard.type('still responsive')
    })
    await page.getByRole('textbox', { name: 'Message' }).focus()
    const source = Array.from({ length: 3000 }, (_, index) => `const item${index}: string = "value"; // some normal source text`).join('\n')
    const initial = await page.evaluate(source => {
      document.querySelector('input').addEventListener(
        'input',
        event => {
          window.inputDuringWork = event.isTrusted && window.highlightCalls.length > 0 && !document.querySelector('.shiki')
        },
        { once: true },
      )
      window.show([{ code: source, lang: 'ts' }])
      return { text: document.querySelector('pre').textContent, calls: window.highlightCalls.length }
    }, source)
    assert.equal(initial.text, source)
    assert.equal(initial.calls, 0)
    await page.waitForFunction(() => document.querySelector('.shiki'))
    await typing
    assert.equal(await page.getByRole('textbox').inputValue(), 'still responsive')
    assert.equal(await page.evaluate(() => window.inputDuringWork), true)
    assert.equal(await page.locator('pre').textContent(), source)
    const calls = await page.evaluate(() => window.highlightCalls)
    assert.ok(calls.length >= 3000)
    assert.ok(calls.every(call => call.method === 'codeToTokensBase' && call.chars < 100))
    console.info(`3000-line browser highlight: ${calls.length} slices, longest tokenizer call ${Math.max(...calls.map(call => call.duration)).toFixed(1)} ms`)
  })
})

test('superseded and unmounted jobs cannot publish old source; collapsed reads retain multiline context', async () => {
  await fixture(async page => {
    const source = ['/*', ...Array.from({ length: 1000 }, (_, index) => `comment ${index}`), '*/', 'const result = 42'].join('\n')
    await page.evaluate(source => window.show([{ code: source, lang: 'ts' }]), source)
    await page.waitForFunction(() => window.highlightCalls.some(call => call.method === 'codeToTokensBase'))
    await page.evaluate(() => window.show([{ code: 'const replacement = 7', lang: 'ts' }]))
    await page.waitForFunction(() => document.querySelector('.shiki'))
    assert.equal(await page.locator('pre').textContent(), 'const replacement = 7')
    await page.evaluate(source => window.show([{ code: source, lang: 'ts', read: true }]), source)
    await page.waitForFunction(() => [...document.querySelectorAll('[data-read] [style*="--shiki-"]')].at(-1)?.textContent === ' 42')
    const tail = page.locator('[data-read] [style*="--shiki-"]').last()
    assert.equal(await tail.textContent(), ' 42')
    assert.ok((await tail.getAttribute('style')).includes('--shiki-token-constant'))
    await page.evaluate(source => {
      window.show([{ code: source.repeat(10), lang: 'ts' }])
      window.show([])
    }, source)
    const count = await page.evaluate(() => window.highlightCalls.length)
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => window.highlightCalls.length), count)
    assert.equal(await page.locator('pre').count(), 0)
  })
})

test('numbered chunk upgrades preserve text, line spacing and source-copy newlines', async () => {
  await fixture(async page => {
    const source = `${Array.from({ length: 100 }, (_, index) => `const item${index} = ${index}`).join('\r\n')}\r\n`
    const initial = await page.evaluate(source => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async text => {
            window.copiedText = text
          },
        },
      })
      window.show([{ code: source, lang: 'ts', lineNumbers: true }])
      document.querySelector('button').click()
      return { height: document.querySelector('pre').getBoundingClientRect().height, text: document.querySelector('pre').textContent }
    }, source)
    await page.waitForFunction(() => document.querySelector('.shiki'))
    assert.equal(await page.evaluate(() => window.copiedText), source.slice(0, -1))
    assert.equal(await page.locator('pre').textContent(), initial.text)
    const lines = await page
      .locator('pre .line')
      .evaluateAll(nodes => nodes.map(node => ({ y: node.getBoundingClientRect().top, display: getComputedStyle(node).display })))
    assert.equal(lines.length, 100)
    assert.ok(lines.every(line => line.display === 'block'))
    for (let index = 1; index < lines.length; index++) assert.equal(lines[index].y - lines[index - 1].y, 20)
    assert.equal(await page.locator('pre').evaluate(pre => pre.getBoundingClientRect().height), initial.height)
  })
})

test('contained chunks preserve nowrap scrolling and reflow when wrapping changes', async () => {
  await fixture(async page => {
    const code = Array.from({ length: 65 }, (_, index) => `const item${index} = "${'a'.repeat(280)}"`).join('\n')
    const toolbarLabels = { codeLabel: 'Code', wrapLabel: 'Wrap', unwrapLabel: 'Unwrap' }
    for (const lineNumbers of [false, true]) {
      const block = { code, lang: 'ts', lineNumbers, wrap: false, toolbarLabels }
      await page.evaluate(block => {
        document.getElementById('app').style.width = '320px'
        window.show([block])
      }, block)
      await page.waitForFunction(() => document.querySelector('.shiki'))
      const overflow = await page.locator('pre').evaluate(pre => {
        pre.scrollLeft = 100
        return { scrollLeft: pre.scrollLeft, width: pre.clientWidth, scrollWidth: pre.scrollWidth }
      })
      assert.ok(overflow.scrollWidth > overflow.width)
      assert.equal(overflow.scrollLeft, 100)
      await page.evaluate(block => window.show([{ ...block, wrap: true }]), block)
      assert.equal(await page.locator('pre').evaluate(pre => pre.scrollWidth <= pre.clientWidth + 1), true)
      assert.equal(await page.locator('pre').textContent(), code)
    }
  })
})
