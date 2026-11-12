import { Context } from '@deepseek-ai/cordis'
import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { installPluginStyles, registerStyle } from '../../packages/modern-ui/src/styles.ts'

test('late styles belong to every active owner, update in place, and disappear with their owner', async () => {
  const dom = new JSDOM('<!doctype html><head></head><body></body>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  const first = new Context(),
    second = new Context()
  try {
    registerStyle('initial-test', '.initial{color:red}')
    installPluginStyles(first)
    installPluginStyles(second)
    registerStyle('late-test', '.late{color:blue}')
    expect(document.querySelectorAll('[data-plugin-css="late-test"]')).toHaveLength(2)
    registerStyle('late-test', '.late{color:green}')
    expect([...document.querySelectorAll('[data-plugin-css="late-test"]')].map(tag => tag.textContent)).toEqual(['.late{color:green}', '.late{color:green}'])
    await first.fiber.dispose()
    expect(document.querySelectorAll('[data-plugin-css="late-test"]')).toHaveLength(1)
    await second.fiber.dispose()
    expect(document.querySelectorAll('style')).toHaveLength(0)
    registerStyle('after-dispose-test', '.after{color:red}')
    expect(document.querySelectorAll('style')).toHaveLength(0)
  } finally {
    await first.fiber.dispose()
    await second.fiber.dispose()
    globalThis.document = previous
    dom.window.close()
  }
})
