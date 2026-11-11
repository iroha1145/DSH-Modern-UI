import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
// Optional directory of unpacked published packages lets the same geometry checks run on older hosts.
const packages = process.env.MODERN_UI_SETTINGS_PACKAGES ?? path.join(repo, 'node_modules/@deepseek-ai')
const published = name => {
  const directory = path.join(packages, 'dsh-client-ui-' + name)
  const root = existsSync(path.join(directory, 'package')) ? path.join(directory, 'package') : directory
  return readFileSync(path.join(root, 'lib/client.js'), 'utf8')
}
const sources = ['theme', 'settings-models', 'settings-general'].map(published)
const officialCss = sources.flatMap(source => [...source.matchAll(/const css(?:\$\d+)? = ("(?:\\.|[^"\\])*");/g)].map(match => JSON.parse(match[1]))).join('\n')
const shell = readFileSync(path.join(repo, 'packages/modern-ui/src/vendor/settings-shell/settings-shell.css'), 'utf8')
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

// Structure follows the published FontFamilyRow, ModelRow and SettingsRoot components;
// all layout declarations under test come from their actual published CSS and Modern's shell.
async function fixture(width, content = '', error = false) {
  const page = await browser.newPage({ viewport: { width, height: 812 }, isMobile: width <= 640, hasTouch: width <= 640 })
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    :root { --dsw-alias-border-l2: #ddd; --dsw-alias-border-l4: #ddd; }
    body { margin: 0; font-family: Arial, sans-serif; }
    input { box-sizing: border-box; width: 100%; height: 36px; }
  </style><div class="VOzbGW_overlay"><div role="dialog" data-shortcut-modal="settings" class="VOzbGW_panel">
    <nav class="VOzbGW_nav"><div tabindex="-1" class="VOzbGW_navTitle">Settings</div><div class="VOzbGW_navList"><button>General</button><button>Models</button></div></nav>
    <div class="VOzbGW_content"><div class="VOzbGW_header"><div class="VOzbGW_actions"><div class="me01iq_action">
      ${error ? '<span class="me01iq_error" role="alert">Could not open configuration file. Please try opening the configuration file again.</span>' : ''}
      <button id="open">Open configuration file</button></div></div><button class="VOzbGW_close" aria-label="Close">×</button></div>
      <div class="VOzbGW_options">${content}</div></div></div></div>`)
  await page.addStyleTag({ content: officialCss })
  await page.addStyleTag({ content: shell })
  return page
}
async function box(page, selector) {
  return page.locator(selector).boundingBox()
}

test('published settings hooks still match the exact supported owner classes', () => {
  for (const [index, names] of [
    [0, ['bVCLcG_row', 'bVCLcG_rowText', 'vnGTiq_field']],
    [1, ['zGbnIq_modelRow', 'zGbnIq_input', 'zGbnIq_iconButton']],
    [2, ['VOzbGW_close', 'VOzbGW_actions', 'me01iq_action', 'me01iq_error']],
  ])
    for (const name of names) {
      assert.ok(sources[index].includes(`"${name}"`), name + ' must exist in the published module mapping')
      assert.ok(officialCss.includes('.' + name + '{'), name + ' must have its published CSS')
    }
})

for (const width of [360, 375, 390, 430]) {
  test(`font family text and input each receive the full settings width at ${width}px`, async () => {
    const page = await fixture(
      width,
      `<div class="bVCLcG_row"><div class="bVCLcG_rowText"><div>Body font family</div><div>Font families used to display the main interface and conversation text.</div></div><div class="vnGTiq_field"><input aria-label="Body font family" value="Inter, Microsoft YaHei, sans-serif"></div></div><div id="foreign" style="display:flex"><div class="unrelated_rowText">Plugin text</div><input style="width:80px"></div>`,
    )
    try {
      const text = await box(page, '.bVCLcG_rowText')
      const field = await box(page, '.vnGTiq_field')
      const padding = await page.locator('.bVCLcG_rowText').evaluate(node => parseFloat(getComputedStyle(node).paddingRight))
      assert.ok(text.width - padding >= width - 34, `description width ${text.width - padding}`)
      assert.ok(field.width >= width - 34, `field width ${field.width}`)
      assert.ok(field.y >= text.y + text.height, 'input belongs below its description')
      assert.equal(await page.locator('#foreign').evaluate(node => getComputedStyle(node).flexDirection), 'row')
      await page.getByRole('textbox').first().fill('A longer custom font family, monospace')
      assert.equal(await page.getByRole('textbox').first().inputValue(), 'A longer custom font family, monospace')
    } finally {
      await page.close()
    }
  })

  test(`model identity fields and their actions stay editable without narrow columns at ${width}px`, async () => {
    const page = await fixture(
      width,
      `<div class="zGbnIq_section"><div class="zGbnIq_rowCard"><div class="zGbnIq_editor"><div class="zGbnIq_modelEntry"><div class="zGbnIq_modelRow"><input class="zGbnIq_input" aria-label="Model ID" value="a-long-model-identifier"><input class="zGbnIq_input" aria-label="Display name" value="A longer display name"><button class="zGbnIq_iconButton" aria-label="Model options" aria-expanded="false">⌄</button><button class="zGbnIq_iconButton" aria-label="Remove model">×</button></div></div></div></div></div>`,
    )
    try {
      const row = await box(page, '.zGbnIq_modelRow')
      const id = await box(page, '[aria-label="Model ID"]')
      const name = await box(page, '[aria-label="Display name"]')
      const options = await box(page, '[aria-label="Model options"]')
      const remove = await box(page, '[aria-label="Remove model"]')
      assert.ok(id.width >= row.width - 1, `ID width ${id.width}, row ${row.width}`)
      assert.ok(name.width >= row.width - 1, `name width ${name.width}, row ${row.width}`)
      assert.ok(name.y >= id.y + id.height)
      assert.ok(options.y >= name.y + name.height)
      assert.ok(Math.abs(options.y - remove.y) < 1)
      assert.ok(remove.x + remove.width <= row.x + row.width + 1)
      await page.getByRole('textbox', { name: 'Display name' }).fill('Edited model display name')
      assert.equal(await page.getByRole('textbox', { name: 'Display name' }).inputValue(), 'Edited model display name')
    } finally {
      await page.close()
    }
  })

  test(`configuration failure wraps below the title and leaves close accessible at ${width}px`, async () => {
    const page = await fixture(width, '<p>General settings content</p>', true)
    try {
      const title = await page.locator('.VOzbGW_navTitle').evaluate(node => {
        const range = document.createRange()
        range.selectNodeContents(node)
        const bounds = range.getBoundingClientRect()
        return { x: bounds.x, width: bounds.width }
      })
      const tabs = await box(page, '.VOzbGW_navList')
      const error = await box(page, '[role="alert"]')
      const close = await box(page, '[aria-label="Close"]')
      const open = await box(page, '#open')
      const content = await box(page, '.VOzbGW_options')
      assert.ok(error.y >= tabs.y + tabs.height, 'failure has its own space after navigation')
      assert.ok(error.x >= 0 && error.x + error.width <= width)
      assert.ok(close.x >= title.x + title.width - 1, 'title reserves the close button space')
      assert.ok(close.x + close.width <= width)
      assert.ok(open.x >= 0 && open.x + open.width <= width)
      assert.ok(content.y >= error.y + error.height, 'error cannot overlay the settings content')
      assert.equal(await page.locator('[role="alert"]').evaluate(node => node.scrollWidth > node.clientWidth), false)
      await page.getByRole('button', { name: 'Close', exact: true }).click()
    } finally {
      await page.close()
    }
  })
}

test('desktop keeps the official horizontal font row and title action layout', async () => {
  const page = await fixture(
    1024,
    '<div class="bVCLcG_row"><div class="bVCLcG_rowText">Body font family</div><div class="vnGTiq_field"><input aria-label="Body font family"></div></div>',
  )
  try {
    assert.equal(await page.locator('.bVCLcG_row').evaluate(node => getComputedStyle(node).flexDirection), 'row')
    assert.equal(await page.locator('.VOzbGW_header').evaluate(node => getComputedStyle(node).position), 'static')
    assert.equal(await page.locator('.VOzbGW_close').evaluate(node => getComputedStyle(node).position), 'static')
    assert.equal((await box(page, '.vnGTiq_field')).width, 240)
  } finally {
    await page.close()
  }
})
