import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, firefox, webkit } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-svg-path-'))
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {Renderer,createLibrary} from '@openuidev/react-lang';
import {Svg,Path} from './packages/modern-ui/src/vendor/openui/components/svg.tsx';
const library=createLibrary({components:[Svg,Path],root:'Svg'});
const root=createRoot(document.getElementById('app'));
window.show=(d,streaming=true)=>{const response='root = Svg([Path('+JSON.stringify(d)+')], "0 0 100 100", null, null, "Path", "Streaming drawing")';
flushSync(()=>root.render(<Renderer library={library} response={response} isStreaming={streaming}/>));};
window.stream=d=>flushSync(()=>root.render(<Renderer library={library} response={'root = Svg([drawing], "0 0 100 100")\\ndrawing = Path('+JSON.stringify(d).slice(0,-1)} isStreaming={true}/>));`,
  },
  outfile: path.join(directory, 'client.js'),
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', request.url === '/client.js' ? 'text/javascript' : 'text/html')
  response.end(
    request.url === '/client.js'
      ? await readFile(path.join(directory, 'client.js'))
      : '<!doctype html><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

for (const engine of [chromium, firefox, webkit]) {
  test(`${engine.name()}: real Renderer keeps incomplete path segments out of the DOM`, async () => {
    const browser = await engine.launch({ headless: true })
    try {
      const page = await browser.newPage()
      const errors = []
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.waitForFunction(() => typeof window.show === 'function')
      for (const [d, expected] of [
        ['M4', null],
        ['M0 0L3', 'M0 0'],
        ['M0 0L3 4 5', 'M0 0L3 4'],
        ['M0 0L3 4A5 5 0 01', 'M0 0L3 4'],
      ]) {
        await page.evaluate(d => window.show(d), d)
        assert.equal(await page.locator('path').getAttribute('d'), expected, d)
      }
      // Actual incomplete OpenUI response, including its still-open string literal.
      await page.evaluate(() => window.stream('M0 0L3'))
      assert.equal(await page.locator('path').getAttribute('d'), 'M0 0')
      await page.evaluate(() => window.stream('M0 0L3 4'))
      assert.equal(await page.locator('path').evaluate(element => element.getTotalLength()), 5)

      const paths = [
        'M0 0L3 4 6 8H10V12h-2v-3zM20 20l5 5Z',
        'm.5-.6 1 2 3 4C1 2 3 4 5 6 7 8 9 10 11 12s1 2 3 4Q1 2 3 4t5 6z',
        'M1e-2+3E+1L.5.6 1.2 2.3',
        'M0 0A5 6 30 0110 20 5 6 30 10-5-.6z',
        'M0 0a-5 +6 -30 01.5.6',
        'M0 0A0 0 0 0,0 3 4ZzL1 2',
      ]
      const result = await page.evaluate(paths => {
        const geometry = element => {
          const length = element.getTotalLength()
          const box = element.getBBox()
          return [
            length,
            box.x,
            box.y,
            box.width,
            box.height,
            ...[0, 0.25, 0.5, 0.75, 1].flatMap(fraction => {
              const point = element.getPointAtLength(length * fraction)
              return [point.x, point.y]
            }),
          ]
        }
        let prefixes = 0
        const completed = []
        for (const d of paths) {
          for (let end = 1; end <= d.length; end++) {
            window.stream(d.slice(0, end))
            const element = document.querySelector('#app path')
            if (!element) throw new Error('Streaming Path must be mounted')
            // Force path parsing while each streamed prefix is current.
            if (element?.getAttribute('d')) element.getTotalLength()
            prefixes++
          }
          window.show(d, false)
          const element = document.querySelector('#app path')
          const reference = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          reference.setAttribute('d', d)
          element.parentElement.append(reference)
          completed.push({ d: element.getAttribute('d'), actual: geometry(element), expected: geometry(reference) })
          reference.remove()
        }
        return { prefixes, completed }
      }, paths)
      assert.equal(
        result.prefixes,
        paths.reduce((total, d) => total + d.length, 0),
      )
      for (const [index, completed] of result.completed.entries()) {
        assert.equal(completed.d, paths[index])
        assert.deepEqual(completed.actual, completed.expected)
        assert.ok(completed.actual.every(Number.isFinite))
      }
      for (const d of ['M0 0L3 4A5 5 0 0210 20L90 90', 'M0 0L3 4,,5 6', 'M0 0L3 4H1e999', 'M0 0L3 4H1e39', 'M0 0L3 4M5', 'M0 0L3 4L5 6.']) {
        await page.evaluate(d => window.show(d), d)
        assert.equal(await page.locator('path').getAttribute('d'), 'M0 0L3 4')
        assert.equal(await page.locator('path').evaluate(element => element.getTotalLength()), 5)
      }
      // A value can round to finite float32 yet exceed the native SVG parser's
      // range. Exercise both signs and the adjacent-double boundary as well.
      for (const value of ['3.40282356e38', '-3.40282356e38', '3.402823466385289e38', '-3.402823466385289e38']) {
        await page.evaluate(value => window.stream(`M0 0L3 4H${value}`), value)
        assert.equal(await page.locator('path').getAttribute('d'), 'M0 0L3 4')
        assert.equal(await page.locator('path').evaluate(element => element.getTotalLength()), 5)
      }
      for (const value of ['3.4028234663852886e38', '-3.4028234663852886e38', '1e38', '-1e38', '1e-999', '-1e-999']) {
        const d = `M0 0H${value}`
        await page.evaluate(d => window.show(d, false), d)
        assert.equal(await page.locator('path').getAttribute('d'), d)
        const lengths = await page.locator('path').evaluate(element => {
          const reference = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          reference.setAttribute('d', element.getAttribute('d'))
          element.parentElement.append(reference)
          const result = [element.getTotalLength(), reference.getTotalLength()]
          reference.remove()
          return result
        })
        assert.equal(lengths[0], lengths[1])
        assert.ok(Number.isFinite(lengths[0]))
      }
      for (const d of ['M0 0<script>', 'M0 0R3 4', `M0 0${' '.repeat(19996)}`]) {
        await page.evaluate(d => window.show(d, false), d)
        assert.equal(await page.locator('path').getAttribute('d'), null)
      }
      await page.evaluate(() => window.show('M0 0L3 4', false))
      assert.equal(await page.getByRole('img', { name: 'Path' }).count(), 1)
      assert.equal(await page.locator('svg desc').textContent(), 'Streaming drawing')
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  })
}
