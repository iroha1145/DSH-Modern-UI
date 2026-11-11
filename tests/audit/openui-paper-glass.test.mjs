import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-openui-paper-glass-'))
const unsupported = '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
import {onColor} from './packages/modern-ui/src/vendor/openui/components/style.ts';
import blockCss from './packages/modern-ui/src/vendor/intelligent/client/OpenUIBlock.module.css';
const app = createRoot(document.getElementById('app'));
window.actions = [];
window.onColor = onColor;
window.show = (response, scheme = 'light', streaming = false) => {
  document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark');
  app.render(
    <main id="stage" data-scheme={scheme}>
      <div id="underlay" />
      <div id="placeholder" className={blockCss.placeholder}>Preparing OpenUI block…</div>
      <section id="block" className="iui-root" data-theme={scheme}>
        <Renderer library={library} response={response} isStreaming={streaming} onAction={event => window.actions.push(event)} />
      </section>
    </main>
  );
};
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
})

const script = await readFile(path.join(directory, 'client.js'))
const css = await readFile(path.join(directory, 'client.css'), 'utf8')
const simulatedCss = css.replaceAll(unsupported, '@media all')
assert.notEqual(simulatedCss, css)

const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>
body{margin:0;padding:24px;font:14px Arial;--ink:#171717;--page:#ffffff;--dsw-alias-bg-layer-2:#ffffff;--dsw-alias-label-secondary:#555555;color:var(--ink);background:var(--page)}
body[data-ds-dark-theme]{--ink:#eeeeee;--page:#171717;--dsw-alias-bg-layer-2:#232325;--dsw-alias-label-secondary:#a1a1aa}
#stage{position:relative;width:540px;display:flex;flex-direction:column;gap:16px}
#underlay{position:absolute;inset:0;background:rgb(255,0,0);forced-color-adjust:none;pointer-events:none;z-index:0}
#placeholder,#block{position:relative;z-index:1}
</style><div id="app"></div><script type="module" src="/client.js"></script>`

const server = createServer((request, response) => {
  const name = request.url.split('?')[0]
  response.setHeader('Content-Type', name === '/client.js' ? 'text/javascript' : name === '/client.css' ? 'text/css' : 'text/html')
  response.end(
    name === '/client.js'
      ? script
      : name === '/client.css'
        ? request.url.includes('simulate')
          ? simulatedCss
          : css
        : html.replace('/client.css', request.url.includes('simulate') ? '/client.css?simulate' : '/client.css'),
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(async () => {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

const GLASS_SHOWCASE = [
  'root = Col([',
  '  Card([Text("Top glass"), Card([Text("Nested well")], "outline"), Card([Text("Nested glass")], "glass")], "glass"),',
  '  Box([Text("Glass box copy")], "col", null, 3, "glass", "lg"),',
  '  Popover("Inspect overlay", [Text("Floating frosted panel")]),',
  '  Chart("scatter", [{name: "Sample", x: 1, y: 2}], "x", ["y"], "number", null, false, 180),',
  '  Carousel([Card([Text("Slide 1")]), Card([Text("Slide 2")]), Card([Text("Slide 3")]), Card([Text("Slide 4")])], 200)',
  '])',
].join('\n')

async function openShowcase({
  dark = false,
  reducedTransparency = 'no-preference',
  reducedMotion = 'no-preference',
  forcedColors = 'none',
  simulate = false,
  code = GLASS_SHOWCASE,
  contextOptions = {},
} = {}) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 900 },
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion,
    forcedColors,
    ...contextOptions,
  })
  const page = await context.newPage()
  if (reducedTransparency === 'reduce') {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/${simulate ? '?simulate' : ''}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(([code, scheme]) => window.show(code, scheme), [code, dark ? 'dark' : 'light'])
  await page.locator('#block').waitFor({ state: 'attached' })
  return { context, page }
}

async function underlayHiddenUnder(page, selector) {
  await page.locator('#underlay').evaluate(node => {
    node.style.background = 'rgb(255, 0, 0)'
  })
  const box = await page.locator(selector).first().boundingBox()
  const clip = { x: Math.round(box.x + box.width - 18), y: Math.round(box.y + 8), width: 10, height: 10 }
  const red = await page.screenshot({ clip })
  await page.locator('#underlay').evaluate(node => {
    node.style.background = 'rgb(0, 0, 255)'
  })
  const blue = await page.screenshot({ clip })
  return red.equals(blue)
}

for (const dark of [false, true]) {
  const scheme = dark ? 'dark' : 'light'

  test(`frosted glass cards use isolated ::before blur while overlays blur directly (${scheme})`, async () => {
    const { context, page } = await openShowcase({ dark })
    try {
      await page.locator('.iui-popover-trigger').click()
      await page.locator('.iui-popover').waitFor()
      await page.locator('.iui-chart-plot circle').first().dispatchEvent('pointerover')
      await page.locator('.iui-chart-tooltip').waitFor()
      await page.locator('.iui-carousel-nav.is-next').waitFor()

      const metrics = await page.evaluate(() => {
        const card = document.querySelector('.iui-card.iui-card-glass')
        const nestedWell = card.querySelector('.iui-card:not(.iui-card-glass)')
        const nestedGlass = card.querySelector('.iui-card.iui-card-glass')
        const box = document.querySelector('.iui-box.iui-box-glass')
        const boxText = box.querySelector('.iui-text')
        const placeholder = document.getElementById('placeholder')
        const popover = document.querySelector('.iui-popover')
        const tooltip = document.querySelector('.iui-chart-tooltip')
        const nav = document.querySelector('.iui-carousel-nav.is-next')
        return {
          onColorGlass: window.onColor('glass') ?? null,
          cardSelfBlur: getComputedStyle(card).backdropFilter,
          cardIsolation: getComputedStyle(card).isolation,
          cardPosition: getComputedStyle(card).position,
          cardBeforeBlur: getComputedStyle(card, '::before').backdropFilter,
          cardBeforePointer: getComputedStyle(card, '::before').pointerEvents,
          nestedWellBeforeBlur: getComputedStyle(nestedWell, '::before').backdropFilter,
          nestedGlassBeforeBlur: getComputedStyle(nestedGlass, '::before').backdropFilter,
          boxSelfBlur: getComputedStyle(box).backdropFilter,
          boxBeforeBlur: getComputedStyle(box, '::before').backdropFilter,
          boxTextColor: getComputedStyle(boxText).color,
          placeholderSelfBlur: getComputedStyle(placeholder).backdropFilter,
          placeholderBeforeBlur: getComputedStyle(placeholder, '::before').backdropFilter,
          popoverBlur: getComputedStyle(popover).backdropFilter,
          tooltipBlur: getComputedStyle(tooltip).backdropFilter,
          navBlur: getComputedStyle(nav).backdropFilter,
          navRestBg: getComputedStyle(nav).backgroundColor,
        }
      })

      assert.deepEqual(metrics.onColorGlass, {})
      assert.equal(metrics.cardSelfBlur, 'none')
      assert.equal(metrics.cardIsolation, 'isolate')
      assert.equal(metrics.cardPosition, 'relative')
      assert.match(metrics.cardBeforeBlur, /blur/)
      assert.equal(metrics.cardBeforePointer, 'none')
      assert.equal(metrics.nestedWellBeforeBlur, 'none')
      assert.match(metrics.nestedGlassBeforeBlur, /blur/)
      assert.equal(metrics.boxSelfBlur, 'none')
      assert.match(metrics.boxBeforeBlur, /blur/)
      assert.equal(metrics.boxTextColor, dark ? 'rgb(238, 238, 238)' : 'rgb(23, 23, 23)')
      assert.equal(metrics.placeholderSelfBlur, 'none')
      assert.match(metrics.placeholderBeforeBlur, /blur/)
      assert.match(metrics.popoverBlur, /blur/)
      assert.match(metrics.tooltipBlur, /blur/)
      assert.match(metrics.navBlur, /blur/)

      await page.locator('.iui-carousel-nav.is-next').hover()
      await page.waitForTimeout(220)
      const navHoverBg = await page.locator('.iui-carousel-nav.is-next').evaluate(el => getComputedStyle(el).backgroundColor)
      assert.notEqual(navHoverBg, metrics.navRestBg)
      // Verify hover stays high-alpha glass rather than collapsing to 4% surface tint.
      const hoverAlpha = Number(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([0-9.]+))?\)/.exec(navHoverBg)?.[1] ?? '1')
      assert.ok(hoverAlpha >= 0.75, `expected glass hover alpha >= 0.75, received ${navHoverBg}`)

      assert.equal(await underlayHiddenUnder(page, '.iui-card.iui-card-glass'), false)
      assert.equal(await underlayHiddenUnder(page, '#placeholder'), false)
    } finally {
      await context.close()
    }
  })

  for (const [label, extra] of [
    ['prefers-reduced-transparency', { reducedTransparency: 'reduce' }],
    ['simulated @supports fallback', { simulate: true }],
  ]) {
    test(`${label} clears blur and turns frosted surfaces opaque (${scheme})`, async () => {
      const { context, page } = await openShowcase({ dark, ...extra })
      try {
        await page.locator('.iui-popover-trigger').click()
        await page.locator('.iui-popover').waitFor()
        await page.locator('.iui-chart-plot circle').first().dispatchEvent('pointerover')
        await page.locator('.iui-chart-tooltip').waitFor()

        const blurs = await page.evaluate(() => ({
          reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches,
          cardBefore: getComputedStyle(document.querySelector('.iui-card.iui-card-glass'), '::before').backdropFilter,
          boxBefore: getComputedStyle(document.querySelector('.iui-box.iui-box-glass'), '::before').backdropFilter,
          placeholderBefore: getComputedStyle(document.getElementById('placeholder'), '::before').backdropFilter,
          popover: getComputedStyle(document.querySelector('.iui-popover')).backdropFilter,
          tooltip: getComputedStyle(document.querySelector('.iui-chart-tooltip')).backdropFilter,
          nav: getComputedStyle(document.querySelector('.iui-carousel-nav.is-next')).backdropFilter,
        }))
        if (extra.reducedTransparency === 'reduce') assert.equal(blurs.reduced, true)
        assert.equal(blurs.cardBefore, 'none')
        assert.equal(blurs.boxBefore, 'none')
        assert.equal(blurs.placeholderBefore, 'none')
        assert.equal(blurs.popover, 'none')
        assert.equal(blurs.tooltip, 'none')
        assert.equal(blurs.nav, 'none')
        assert.equal(await underlayHiddenUnder(page, '.iui-card.iui-card-glass'), true)
        assert.equal(await underlayHiddenUnder(page, '#placeholder'), true)
      } finally {
        await context.close()
      }
    })
  }
}

test('forced colors clears backdrop blur, hides underlay and draws explicit structural borders', async () => {
  const { context, page } = await openShowcase({
    forcedColors: 'active',
    code: [
      '$seg = "a"',
      'root = Col([',
      '  Card([Text("Outline card")], "outline"),',
      '  Card([Text("Glass card")], "glass"),',
      '  SegmentedControl($seg, ["a", "b"], false, "Mode"),',
      '  Button("Submit", @ToAssistant("go")),',
      '  Popover("More", [Text("Details")])',
      '])',
    ].join('\n'),
  })
  try {
    await page.locator('.iui-popover-trigger').click()
    await page.locator('.iui-popover').waitFor()
    const state = await page.evaluate(() => ({
      forced: matchMedia('(forced-colors: active)').matches,
      glassBlur: getComputedStyle(document.querySelector('.iui-card.iui-card-glass'), '::before').backdropFilter,
      placeholderBlur: getComputedStyle(document.getElementById('placeholder'), '::before').backdropFilter,
      popoverBlur: getComputedStyle(document.querySelector('.iui-popover')).backdropFilter,
      cardBorder: getComputedStyle(document.querySelector('.iui-card:not(.iui-card-glass)')).borderTopWidth,
      glassBorder: getComputedStyle(document.querySelector('.iui-card.iui-card-glass')).borderTopWidth,
      buttonBorder: getComputedStyle(document.querySelector('.iui-button')).borderTopWidth,
      segmentedBorder: getComputedStyle(document.querySelector('.iui-segmented')).borderTopWidth,
    }))
    assert.equal(state.forced, true)
    assert.equal(state.glassBlur, 'none')
    assert.equal(state.placeholderBlur, 'none')
    assert.equal(state.popoverBlur, 'none')
    assert.equal(state.cardBorder, '1px')
    assert.equal(state.glassBorder, '1px')
    assert.equal(state.buttonBorder, '1px')
    assert.equal(state.segmentedBorder, '1px')
    assert.equal(await underlayHiddenUnder(page, '.iui-card.iui-card-glass'), true)
    assert.equal(await underlayHiddenUnder(page, '#placeholder'), true)
  } finally {
    await context.close()
  }
})

test('ordinary OpenUI controls scale around center on press while anchored triggers and card-wrapped Pressables stay clean', async () => {
  const { context, page } = await openShowcase({
    code: [
      'root = Col([',
      '  Row([',
      '    Button("Primary Action", @ToAssistant("run")),',
      '    IconButton("sparkles", @ToAssistant("spark"), "Quick Action"),',
      '    Popover(Button("Menu Trigger"), [Text("Menu panel")]),',
      '    Popover(IconButton("info", null, "Info Trigger"), [Text("Info panel")]),',
      '    Popover(Pressable([Text("Pressable Trigger")], @ToAssistant("noop"), false, 2), [Text("Card panel")])',
      '  ], 3, "center", "start", true),',
      '  Pressable([Card([Text("Card inside Pressable")])], @ToAssistant("open-card"))',
      '])',
    ].join('\n'),
  })
  try {
    const actionBtn = page.getByRole('button', { name: 'Primary Action', exact: true })
    const box = await actionBtn.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(110)
    const pressed = await actionBtn.evaluate(el => {
      const r = el.getBoundingClientRect()
      return { width: r.width, cx: r.x + r.width / 2, cy: r.y + r.height / 2, transform: getComputedStyle(el).transform }
    })
    await page.mouse.up()
    await page.waitForTimeout(190)
    const released = await actionBtn.evaluate(el => {
      const r = el.getBoundingClientRect()
      return { width: r.width, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })
    assert.notEqual(pressed.transform, 'none')
    assert.ok(pressed.width < box.width - 0.5, `expected pressed button width < ${box.width}, got ${pressed.width}`)
    assert.ok(Math.abs(pressed.cx - (box.x + box.width / 2)) < 0.05)
    assert.ok(Math.abs(pressed.cy - (box.y + box.height / 2)) < 0.05)
    assert.ok(Math.abs(released.width - box.width) < 0.05)

    for (const locator of [
      page.getByRole('button', { name: 'Menu Trigger', exact: true }),
      page.getByRole('button', { name: 'Info Trigger', exact: true }),
      page.locator('.iui-popover-trigger .iui-pressable'),
    ]) {
      assert.equal(await locator.getAttribute('aria-haspopup'), 'dialog')
      const rest = await locator.boundingBox()
      await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(90)
      const active = await locator.evaluate(el => {
        const r = el.getBoundingClientRect()
        return { width: r.width, height: r.height, x: r.x, y: r.y, transform: getComputedStyle(el).transform }
      })
      await page.mouse.up()
      await page.keyboard.press('Escape')
      assert.equal(active.transform, 'none')
      assert.ok(Math.abs(active.width - rest.width) < 0.05 && Math.abs(active.x - rest.x) < 0.05)
    }

    const cardPressable = page.locator('.iui-pressable').last()
    const innerCard = cardPressable.locator('.iui-card')
    const beforeCardShadow = await innerCard.evaluate(el => getComputedStyle(el).boxShadow)
    await cardPressable.hover()
    await page.waitForTimeout(200)
    const hoverShadows = await cardPressable.evaluate(el => ({
      wrapper: getComputedStyle(el).boxShadow,
      card: getComputedStyle(el.querySelector('.iui-card')).boxShadow,
    }))
    assert.equal(hoverShadows.wrapper, 'none')
    assert.notEqual(hoverShadows.card, beforeCardShadow)
  } finally {
    await context.close()
  }
})

test('reduced motion disables OpenUI press transforms and makes Carousel navigation instantaneous', async () => {
  const { context, page } = await openShowcase({
    reducedMotion: 'reduce',
    code: [
      'root = Col([',
      '  Button("Quiet Button", @ToAssistant("quiet")),',
      '  Carousel([Card([Text("One")]), Card([Text("Two")]), Card([Text("Three")]), Card([Text("Four")])], 220)',
      '])',
    ].join('\n'),
  })
  try {
    const btn = page.getByRole('button', { name: 'Quiet Button', exact: true })
    const box = await btn.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(60)
    const active = await btn.evaluate(el => ({
      transform: getComputedStyle(el).transform,
      animations: el.getAnimations().length,
      stageAnimation: getComputedStyle(document.getElementById('placeholder')).animationName,
    }))
    await page.mouse.up()
    assert.equal(active.transform, 'none')
    assert.equal(active.animations, 0)

    const scrolled = await page.evaluate(async () => {
      const track = document.querySelector('.iui-carousel-track')
      document.querySelector('.iui-carousel-nav.is-next').click()
      const immediate = track.scrollLeft
      await new Promise(requestAnimationFrame)
      const nextFrame = track.scrollLeft
      return { immediate, nextFrame }
    })
    assert.ok(scrolled.immediate > 100, `expected immediate scroll jump, got ${scrolled.immediate}`)
    assert.equal(scrolled.immediate, scrolled.nextFrame)
  } finally {
    await context.close()
  }
})

test('desktop inputs use 14px type while coarse pointers upgrade to 16px, and radius="full" opts into round corners', async () => {
  const code = [
    '$q = ""',
    'root = Col([',
    '  Input($q, "Filter", "Search…"),',
    '  Box([Text("Capsule")], "row", 2, 2, "glass", "full"),',
    '  Pressable([Text("Chip")], @ToAssistant("chip"), false, 2, "surface", "full")',
    '])',
  ].join('\n')

  const desktop = await openShowcase({ code })
  try {
    const info = await desktop.page.evaluate(() => ({
      inputSize: getComputedStyle(document.querySelector('.iui-input')).fontSize,
      boxRound: document.querySelector('.iui-box').classList.contains('iui-round'),
      pressableRound: document.querySelector('.iui-pressable').classList.contains('iui-round'),
      boxRadius: getComputedStyle(document.querySelector('.iui-box')).borderTopLeftRadius,
      pressableRadius: getComputedStyle(document.querySelector('.iui-pressable')).borderTopLeftRadius,
    }))
    assert.equal(info.inputSize, '14px')
    assert.equal(info.boxRound, true)
    assert.equal(info.pressableRound, true)
    assert.equal(info.boxRadius, '999px')
    assert.equal(info.pressableRadius, '999px')
  } finally {
    await desktop.context.close()
  }

  const mobile = await openShowcase({
    code,
    contextOptions: { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } },
  })
  try {
    const inputSize = await mobile.page.locator('.iui-input').evaluate(el => getComputedStyle(el).fontSize)
    assert.equal(inputSize, '16px')
  } finally {
    await mobile.context.close()
  }
})

const SELECTION_SHOWCASE = [
  '$seg = "a"',
  '$cards = "a"',
  '$pills = "a"',
  'root = Col([',
  '  SegmentedControl($seg, ["a", "b"], false, "Mode"),',
  '  RadioGroup($cards, [{value:"a",label:"Card A",description:"Card details A"},{value:"b",label:"Card B",description:"Card details B"}], "Card choice", "cards"),',
  '  RadioGroup($pills, [{value:"a",label:"Pill A",description:"Pill details A"},{value:"b",label:"Pill B",description:"Pill details B"}], "Pill choice", "pills")',
  '])',
].join('\n')

async function selectionColors(page) {
  return page.evaluate(() => {
    const block = document.querySelector('#block')
    const reference = document.createElement('span')
    reference.style.cssText = 'position:absolute;forced-color-adjust:none;background:Highlight;color:HighlightText'
    block.append(reference)
    const referenceStyle = getComputedStyle(reference)
    const system = { background: referenceStyle.backgroundColor, color: referenceStyle.color }
    reference.remove()
    return {
      forced: matchMedia('(forced-colors:active)').matches,
      system,
      controls: Array.from(block.querySelectorAll('.iui-segmented > button.is-selected, .iui-choice.is-selected'), element => {
        const style = getComputedStyle(element),
          title = element.querySelector('.iui-choice-text > span'),
          description = element.querySelector('.iui-choice-description')
        return {
          text: element.textContent,
          background: style.backgroundColor,
          color: style.color,
          adjustment: style.forcedColorAdjust,
          title: title ? getComputedStyle(title).color : style.color,
          description: description ? getComputedStyle(description).color : style.color,
        }
      }),
    }
  })
}

async function assertForcedSelection(page) {
  const colors = await selectionColors(page)
  assert.equal(colors.forced, true)
  assert.equal(colors.controls.length, 3)
  for (const item of colors.controls) {
    assert.equal(item.background, colors.system.background, JSON.stringify(item))
    assert.equal(item.color, colors.system.color, JSON.stringify(item))
    assert.equal(item.title, colors.system.color, JSON.stringify(item))
    assert.equal(item.description, colors.system.color, JSON.stringify(item))
    assert.equal(item.adjustment, 'none', JSON.stringify(item))
  }
}

for (const dark of [false, true]) {
  for (const matchIdScope of [false, true]) {
    test(`forced-colors selected controls preserve system foreground/background through switching, hover and keyboard focus (${dark ? 'dark' : 'light'}, ${matchIdScope ? 'ID and class scope' : 'class scope'})`, async () => {
      const { context, page } = await openShowcase({ dark, forcedColors: 'active', reducedMotion: 'reduce', code: SELECTION_SHOWCASE })
      try {
        // The ID arm is a specificity sentinel; theme tokens still live on .iui-root.
        if (matchIdScope)
          await page
            .locator('#block .iui-col')
            .first()
            .evaluate(element => {
              element.id = 'iui-scope'
              element.dataset.theme = element.closest('[data-theme]').dataset.theme
            })
        await page.locator('.iui-choice.is-selected').first().waitFor()
        await assertForcedSelection(page)
        await page.locator('.iui-segmented > button').nth(1).click()
        for (const selector of ['.iui-radio-cards', '.iui-radio-pills'])
          await page
            .locator(selector + ' .iui-choice')
            .nth(1)
            .click()
        await assertForcedSelection(page)
        assert.deepEqual(await page.locator('.iui-choice.is-selected input').evaluateAll(inputs => inputs.map(input => input.checked)), [true, true])
        for (const selector of [
          '.iui-segmented > button.is-selected',
          '.iui-radio-cards .iui-choice.is-selected',
          '.iui-radio-pills .iui-choice.is-selected',
        ]) {
          const control = page.locator(selector)
          await control.hover()
          await assertForcedSelection(page)
          await page.keyboard.press('Tab')
          const target = selector.includes('segmented') ? control : control.locator('input')
          await target.focus()
          assert(await target.evaluate(element => element.matches(':focus-visible')))
          const outline = await control.evaluate(element => getComputedStyle(element).outlineWidth)
          assert.equal(outline, '2px')
          await assertForcedSelection(page)
        }
        await page.locator('.iui-segmented > button').first().click()
        for (const selector of ['.iui-radio-cards', '.iui-radio-pills'])
          await page
            .locator(selector + ' .iui-choice')
            .first()
            .click()
        await assertForcedSelection(page)
      } finally {
        await context.close()
      }
    })
  }
  test(`ordinary selection colors retain Paper Widgets design (${dark ? 'dark' : 'light'})`, async () => {
    const { context, page } = await openShowcase({ dark, reducedMotion: 'reduce', code: SELECTION_SHOWCASE })
    try {
      const styles = await page.evaluate(dark => {
        const block = document.querySelector('#block'),
          reference = document.createElement('span')
        reference.style.cssText = 'position:absolute;forced-color-adjust:none'
        block.append(reference)
        const color = declaration => {
          reference.style.cssText = 'position:absolute;' + declaration
          const style = getComputedStyle(reference)
          return { color: style.color, background: style.backgroundColor }
        }
        const expected = {
          segment: color('color:var(--iui-ink);background:' + (dark ? 'color-mix(in srgb, var(--iui-ink) 10%, var(--iui-canvas))' : 'var(--iui-card-bg)')),
          cards: color('color:var(--iui-ink);background:color-mix(in srgb, var(--iui-ink) 3%, var(--iui-card-bg))'),
          pills: color('color:var(--iui-on-ink);background:var(--iui-ink)'),
          description: color('color:var(--iui-muted)').color,
        }
        const actual = ['.iui-segmented > button.is-selected', '.iui-radio-cards .iui-choice.is-selected', '.iui-radio-pills .iui-choice.is-selected'].map(
          selector => {
            const element = block.querySelector(selector),
              style = getComputedStyle(element),
              description = element.querySelector('.iui-choice-description')
            return {
              color: style.color,
              background: style.backgroundColor,
              description: description ? getComputedStyle(description).color : null,
              shadow: style.boxShadow,
            }
          },
        )
        reference.remove()
        return { expected, actual, forced: matchMedia('(forced-colors:active)').matches }
      }, dark)
      assert.equal(styles.forced, false)
      for (const [index, key] of ['segment', 'cards', 'pills'].entries()) {
        assert.equal(styles.actual[index].color, styles.expected[key].color)
        assert.equal(styles.actual[index].background, styles.expected[key].background)
        assert.notEqual(styles.actual[index].shadow, 'none')
        if (index > 0) assert.equal(styles.actual[index].description, styles.expected.description)
      }
    } finally {
      await context.close()
    }
  })
}
