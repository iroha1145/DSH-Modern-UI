import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { highlightWorkerPlugin } from '../../scripts/highlight-worker.mjs'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
await mkdir(path.join(root, '.artifacts'), { recursive: true })
const directory = await mkdtemp(path.join(root, '.artifacts/highlighting-'))
const measurePlugin = {
  name: 'measure-real-highlighter',
  setup(builder) {
    // The production Host supplies this query; bundling its entire primitives seed would measure the Host's separate highlighter too.
    builder.onLoad({ filter: /[/\\]input-modality\.ts$/ }, () => ({ contents: 'export const pointerModality=()=>false', loader: 'js' }))
    builder.onResolve({ filter: /^shiki\/core$/ }, () => ({ path: 'core', namespace: 'measured-core' }))
    builder.onLoad({ filter: /.*/, namespace: 'measured-core' }, () => ({
      resolveDir: root,
      loader: 'js',
      contents: `self.highlightCalls=[];self.engineBuilds=[];self.firstPosted=false;
export * from ${JSON.stringify(fileURLToPath(import.meta.resolve('shiki/core')))};
import {createHighlighterCoreSync as create} from ${JSON.stringify(fileURLToPath(import.meta.resolve('shiki/core')))};
export function createHighlighterCoreSync(options) {
  const started=performance.now();
  const instance = create(options);
  const timing={duration:performance.now()-started};self.engineBuilds.push(timing);self.postMessage({kind:'measure-engine',timing});
  for (const method of ['codeToHtml', 'codeToTokens', 'codeToTokensBase']) {
    const original = instance[method].bind(instance);
    instance[method] = (code, options) => {
      const start = performance.now();
      if(!self.firstPosted){self.firstPosted=true;self.postMessage({kind:'measure-start'})}
      const result = original(code, options);
      self.highlightCalls.push({method, language: options.lang, chars: code.length, duration: performance.now() - start});
      return result;
    };
  }
  return instance;
}`,
    }))
  },
}
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
  plugins: [highlightWorkerPlugin(build, [measurePlugin]), measurePlugin],
})
const server = createServer(async (req, res) => {
  const file = req.url === '/client.js' ? 'client.js' : req.url === '/client.css' ? 'client.css' : null
  res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html')
  res.end(
    file
      ? await readFile(path.join(directory, file))
      : `<!doctype html><link rel="stylesheet" href="/client.css">
<style>:root{--dsw-font-markdown-code-block:14px/20px monospace}body{font:14px Arial}section{max-height:160px;overflow:auto}input{position:fixed;top:0;right:0}</style>
<input aria-label="Message"><div id="app"></div><script>window.workerTokenizing=false;window.engineBuilds=[];window.workerCreated=0;window.workerTerminated=0;window.workerFrames=[];window.revokedUrls=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.revokedUrls.push(url);revoke(url)};const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){const failed=window.failNextWorker;window.failNextWorker=false;const broken=failed?URL.createObjectURL(new Blob(['throw new Error("Worker execution failed")'],{type:'text/javascript'})):null;super(...(broken?[broken]:args));if(broken)URL.revokeObjectURL(broken);window.workerCreated++;this.addEventListener('message',event=>{if(event.data.kind==='frame')window.workerFrames.push({lines:event.data.frame.appended.length,tailHighlightedLines:event.data.frame.tail.filter(line=>line.some(span=>span.style.color)).length,from:event.data.frame.from,end:event.data.frame.completedLines});if(event.data.kind==='measure-engine')window.engineBuilds.push(event.data.timing);if(event.data.kind==='measure-start'){window.workerTokenizing=true;void window.firstTokenization?.()}})}terminate(){window.workerTerminated++;super.terminate()}};</script><script type="module" src="/client.js"></script>`,
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chromiumOptions = process.env.MODERN_UI_BROWSER
  ? { executablePath: process.env.MODERN_UI_BROWSER, headless: true }
  : existsSync(chromium.executablePath())
    ? { headless: true }
    : { channel: 'msedge', headless: true }
const browser = await chromium.launch(chromiumOptions)
afterAll(async () => {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})
async function fixture(run, warm = true) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => typeof window.show === 'function')
    assert.deepEqual(await page.evaluate(() => window.engineBuilds), [])
    if (warm) {
      await page.evaluate(() => window.show([{ code: 'const ready=1', lang: 'ts' }]))
      await page.waitForFunction(() => document.querySelector('.shiki'))
      await page.workers()[0].evaluate(() => {
        self.highlightCalls = []
        self.firstPosted = false
      })
      await page.evaluate(() => {
        window.workerTokenizing = false
      })
    }
    await run(page)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
}

const calls = page => page.workers()[0].evaluate(() => self.highlightCalls)

test('welcome, plain text and offscreen code do not initialize the engine; first visible code preserves text before coloring', async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      document.getElementById('app').style.marginTop = '3000px'
      window.show([{ code: 'const cold: number = 42', lang: 'ts' }])
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => window.engineBuilds.length), 0)
    assert.equal(await page.locator('pre').textContent(), 'const cold: number = 42')
    const started = await page.evaluate(() => {
      window.coldStarted = performance.now()
      document.querySelector('pre').scrollIntoView()
      return { text: document.querySelector('pre').textContent, engines: window.engineBuilds.length }
    })
    assert.equal(started.engines, 0)
    assert.equal(started.text, 'const cold: number = 42')
    await page.waitForFunction(() => document.querySelector('.shiki'))
    const result = await page.evaluate(() => ({
      elapsed: performance.now() - window.coldStarted,
      engines: window.engineBuilds.length,
      builds: window.engineBuilds,
      shell: window.isGrammarLoaded('shell'),
      json: window.isGrammarLoaded('json'),
    }))
    assert.equal(result.engines, 1)
    assert.equal(result.shell, false)
    assert.equal(result.json, false)
    console.info(
      `Cold visible TypeScript: ${result.elapsed.toFixed(1)}ms to highlighted DOM; engine construction ${result.builds[0].duration.toFixed(1)}ms; plain source visible before initialization`,
    )
  }, false)
})

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
    const before = (await calls(page)).filter(call => call.language === 'typescript').length
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
    assert.equal((await calls(page)).filter(call => call.language === 'typescript').length, before)
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
          window.inputDuringWork = event.isTrusted && window.workerTokenizing && !document.querySelector('.shiki')
        },
        { once: true },
      )
      window.show([{ code: source, lang: 'ts' }])
      return { text: document.querySelector('pre').textContent, calls: window.workerTokenizing ? 1 : 0 }
    }, source)
    assert.equal(initial.text, source)
    assert.equal(initial.calls, 0)
    await page.waitForFunction(() => document.querySelector('.shiki'))
    await typing
    assert.equal(await page.getByRole('textbox').inputValue(), 'still responsive')
    assert.equal(await page.evaluate(() => window.inputDuringWork), true)
    assert.equal(await page.locator('pre').textContent(), source)
    const measuredCalls = await calls(page)
    assert.ok(measuredCalls.length >= 3000)
    assert.ok(measuredCalls.every(call => call.method === 'codeToTokensBase' && call.chars < 100))
    console.info(
      `3000-line browser highlight: ${measuredCalls.length} slices, longest tokenizer call ${Math.max(...measuredCalls.map(call => call.duration)).toFixed(1)} ms`,
    )
  })
})

test('superseded and unmounted jobs cannot publish old source; collapsed reads retain multiline context', async () => {
  await fixture(async page => {
    const source = ['/*', ...Array.from({ length: 1000 }, (_, index) => `comment ${index}`), '*/', 'const result = 42'].join('\n')
    await page.evaluate(source => window.show([{ code: source, lang: 'ts' }]), source)
    await page.waitForFunction(() => window.workerTokenizing)
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
    const stopped = new Promise(resolve => page.workers()[0].on('close', resolve))
    await page.evaluate(() => window.releaseHighlightOwner())
    await stopped
    assert.equal(page.workers().length, 0)
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

for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  test(`${name}: real worker keeps streaming source, bounds upgrades and rebuilds both grammars after owner disposal`, async () => {
    const instance = await engine.launch(engine === chromium ? chromiumOptions : { headless: true })
    const page = await instance.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.waitForFunction(() => typeof window.show === 'function')
      await page.evaluate(() => {
        window.notifications = { alias: 0, removed: 0 }
        window.subscribeGrammarLoaded('typescript', () => window.notifications.alias++)
        const stop = window.subscribeGrammarLoaded('ts', () => window.notifications.removed++)
        stop()
        window.show([
          { code: 'const value0: number = 0', lang: 'ts', streaming: true },
          { code: '{"value":1}', lang: 'json' },
        ])
      })
      await page.waitForFunction(() => document.querySelectorAll('.shiki').length === 2)
      assert.deepEqual(await page.evaluate(() => window.notifications), { alias: 1, removed: 0 })
      await page.evaluate(() =>
        window.show([
          { code: 'const value0: number = 0\nconst value1: number = 1', lang: 'ts', streaming: true },
          { code: '{"value":1}', lang: 'json' },
        ]),
      )
      await page.waitForFunction(() => window.workerFrames.some(frame => frame.end === 1))
      await page.evaluate(() => {
        window.firstRetainedLine = document.querySelector('[data-block="0"] .line')
        for (let count = 3; count <= 220; count += 1)
          window.show([
            { code: Array.from({ length: count }, (_, i) => `const value${i}: number = ${i}`).join('\n'), lang: 'ts', streaming: true },
            { code: '{"value":1}', lang: 'json' },
          ])
      })
      await page.waitForFunction(() => document.querySelector('[data-block="0"] pre').textContent.split('\n').length === 220)
      const source = await page.locator('[data-block="0"] pre').textContent()
      assert.equal(source, Array.from({ length: 220 }, (_, i) => `const value${i}: number = ${i}`).join('\n'))
      assert.equal(await page.evaluate(() => window.firstRetainedLine === document.querySelector('[data-block="0"] .line')), true)
      await page.evaluate(() =>
        window.show([
          { code: 'let replaced = true', lang: 'javascript', streaming: true },
          { code: '{"value":2}', lang: 'json' },
        ]),
      )
      await page.waitForFunction(
        () => document.querySelector('[data-block="0"] pre')?.textContent === 'let replaced = true' && document.querySelectorAll('.shiki').length === 2,
      )
      await page.evaluate(() => {
        window.show([])
        window.releaseHighlightOwner()
      })
      await page.waitForFunction(() => window.workerTerminated === 1)
      assert.equal(await page.evaluate(() => window.revokedUrls.length), 1)
      await page.evaluate(() => {
        window.mountHighlightOwner()
        window.show([
          { code: 'const rebuilt: number = 2', lang: 'ts' },
          { code: '{"rebuilt":true}', lang: 'json' },
        ])
      })
      await page.waitForFunction(() => document.querySelectorAll('.shiki').length === 2)
      assert.equal(await page.evaluate(() => window.workerCreated), 2)
      assert.ok((await page.evaluate(() => window.workerFrames)).every(frame => frame.lines + frame.tailHighlightedLines <= 32))
      for (const count of [32, 33, 64, 65, 120]) {
        const code = Array.from({ length: count }, () => 'let a=1').join('\n')
        await page.evaluate(code => {
          window.show([])
          window.workerFrames = []
          window.show([{ code, lang: 'ts', streaming: true }])
        }, code)
        await page.waitForFunction(completed => window.workerFrames.some(frame => frame.end === completed), Math.min(count - 1, 80))
        const expectedColored = count === 120 ? 80 : count
        await page.waitForFunction(
          expected => [...document.querySelectorAll('pre .line')].filter(line => line.querySelector('[style*="--shiki-"]')).length === expected,
          expectedColored,
        )
        assert.equal(await page.locator('pre').textContent(), code)
        const frames = await page.evaluate(() => window.workerFrames)
        assert.ok(
          frames.every(frame => frame.lines + frame.tailHighlightedLines <= 32),
          JSON.stringify(frames),
        )
        if (count === 120) assert.equal(frames.at(-1).tailHighlightedLines, 0)
        await page.evaluate(code => window.show([{ code, lang: 'ts', streaming: false }]), code)
        await page.waitForFunction(
          expected => [...document.querySelectorAll('pre .line')].filter(line => line.querySelector('[style*="--shiki-"]')).length === expected,
          count,
        )
        assert.equal(await page.locator('pre').textContent(), code)
      }
      await page.evaluate(() => {
        for (const language of window.languages) window.requestGrammar(language)
      })
      await page.waitForFunction(() => window.languages.every(window.isGrammarLoaded))
      assert.equal(await page.evaluate(() => window.languages.length), 60)
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
      await instance.close()
    }
  }, 120000)
}

test('actual worker execution failure preserves source and requires explicit retry', async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      window.failNextWorker = true
      window.show([{ code: 'const recover: number = 42', lang: 'ts' }])
    })
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(), /Worker execution failed/)
    assert.equal(await page.locator('pre').textContent(), 'const recover: number = 42')
    await page.evaluate(() => window.show([{ code: 'const recover: number = 42', lang: 'ts' }]))
    assert.equal(await page.evaluate(() => window.workerCreated), 1)
    await page.getByRole('button', { name: 'Retry highlighting' }).click()
    await page.locator('.shiki').waitFor()
    assert.equal(await page.evaluate(() => window.workerCreated), 2)
    assert.equal(await page.getByRole('alert').count(), 0)
  }, false)
})
