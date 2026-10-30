import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { schemaFor } from '../../scripts/distribution/profile-settings.mjs'

const requireHost = createRequire(
  process.env.COMPAT_BACKEND_PACKAGE ? path.resolve(process.env.COMPAT_BACKEND_PACKAGE) : new URL('../../package.json', import.meta.url),
)
const yaml = requireHost('js-yaml')
const schema = schemaFor(yaml)
const { applyEntryPatches } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/cordis-plugin-include')).href)
// The bundles every web and Desktop profile composes before community bundles.
const official = await Promise.all(
  ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].map(async name =>
    yaml.load(await readFile(requireHost.resolve(`${name}/cordis.patch.yml`), 'utf8'), { schema }),
  ),
)
const modern = yaml.load(await readFile(new URL('../../packages/modern-ui/cordis.patch.yml', import.meta.url), 'utf8'), { schema })
/** A volatile field resolves to a reference; read through it. */
const read = value => (typeof value?.get === 'function' ? value.get() : value)
const find = (rows, id) => {
  for (const row of rows) {
    if (row?.id === id) return row
    const nested = row?.group && Array.isArray(row.config) ? find(row.config, id) : undefined
    if (nested) return nested
  }
}

test('the Desktop onboarding is composed as skipped exactly where ui-chat is disabled', () => {
  const warnings = []
  const base = official.reduce((rows, patch) => applyEntryPatches(rows, patch, (...args) => warnings.push(args)), [])
  const before = find(base, 'ui-settings-account')
  // The bundle replaces this row's config outright; an official composition here would be lost.
  assert.equal(before?.config, undefined, 'the official bundle now composes ui-settings-account; merge it instead of replacing it')
  const composed = applyEntryPatches(base, modern, (...args) => warnings.push(args))
  assert.deepEqual(warnings, [])
  assert.equal(find(composed, 'ui-chat').disabled, true)
  assert.deepEqual(find(composed, 'ui-settings-account').config, {
    version: 1,
    step: 'done',
    purpose: null,
    process: 'standard',
    completion: 'skipped',
    usage: 'compact',
    developerTools: false,
  })
  assert.equal(find(composed, 'ui-settings-account').disabled, undefined)
})

test('the composed progress is valid for the account plugin schema', async () => {
  const { Config } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-client-ui-settings-account')).href)
  const config = find(modern, 'ui-settings-account').config
  const resolved = Config(config)
  for (const [field, value] of Object.entries(config)) assert.deepEqual(read(resolved[field]), value, field)
})
