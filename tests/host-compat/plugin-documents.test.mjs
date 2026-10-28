import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import * as documents from '../../packages/modern-ui/lib/plugin-documents.js'

const require = createRequire(import.meta.url)
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fV8AAAAASUVORK5CYII=', 'base64')
const defaults = { maxDocumentBytes: 1024 * 1024, maxImageBytes: 1024, fetchTimeoutMs: 1000, cacheTtlMs: 600000 }

async function fixture(t, config = {}, sources = {}) {
  const temporary = await realpath(tmpdir())
  const directory = await mkdtemp(path.join(temporary, 'modern-plugin-documents-'))
  const profile = path.join(directory, 'profile')
  const pkg = path.join(profile, 'node_modules', 'fixture-document-bundle')
  await mkdir(path.join(pkg, 'locale'), { recursive: true })
  await mkdir(path.join(pkg, 'docs'), { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'fixture-profile', private: true }))
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'fixture-document-bundle', version: '1.0.0' }))
  await writeFile(path.join(pkg, 'README.md'), '# Default README\n\n![Pixel](docs/pixel.png)\n')
  await writeFile(path.join(pkg, 'docs', 'zh.md'), '---\nprivate: frontmatter\n---\n# 中文说明\n\n![图](pixel.png)\n\n```js\nconst parity = true\n```\n')
  await writeFile(path.join(pkg, 'docs', 'pixel.png'), image)
  await writeFile(path.join(pkg, 'locale', 'zh.json'), JSON.stringify({ meta: { detail: 'docs/zh.md' } }))
  const ctx = new Context()
  let reads = 0
  await ctx.plugin({ apply(scope) {
    new HostConnectionService(scope, [], {})
    scope.provide('profileContext', { dir: profile, installAnchor: require.resolve('@deepseek-ai/dsh/package.json') })
    scope.provide('pluginManager', { listBundles: async () => {
      reads++
      return sources.bundles ?? [{ name: 'fixture-document-bundle', version: '1.0.0', availability: 'profile' }]
    } })
    scope.provide('pluginMarket', { entry: async (url, name) => {
      assert.equal(url, 'https://fixture.invalid/index.json')
      if (sources.marketEntry) return sources.marketEntry(name)
      return name === 'listed' ? { name, versions: [{ version: '1.0.0', source: { type: 'npm', registry: 'https://private.invalid' } }] } : undefined
    } })
  } }).await()
  const fiber = ctx.plugin(documents, { ...defaults, ...config })
  await fiber.await()
  const dispatch = ctx.connection.createSharedFetchHandler('/api')
  const request = (params, peer = ctx.connection.browserPeer) => {
    const url = new URL(documents.DOCUMENT_PATH, 'http://localhost')
    url.search = new URLSearchParams({ kind: 'bundle', name: 'fixture-document-bundle', language: 'zh-CN', ...params }).toString()
    return dispatch.fetch(new Request(url), peer)
  }
  const getImage = (document, file, peer = ctx.connection.browserPeer) => {
    const url = new URL(documents.IMAGE_PATH, 'http://localhost')
    url.search = new URLSearchParams({ document, path: file }).toString()
    return dispatch.fetch(new Request(url), peer)
  }
  t.after(async () => {
    await ctx.fiber.dispose()
    assert.equal(path.dirname(await realpath(directory)), temporary)
    await rm(directory, { recursive: true, force: true })
  })
  return { ctx, fiber, directory, pkg, request, getImage, reads: () => reads }
}

test('authenticated document routes retain locale fallback, README and original image bytes, then withdraw', async t => {
  const f = await fixture(t)
  const response = await f.request({})
  assert.equal(response.status, 200)
  const zh = await response.json()
  assert.equal(zh.origin, 'locale')
  assert.match(zh.markdown, /^# 中文说明/)
  assert.doesNotMatch(zh.markdown, /private: frontmatter/)
  const media = await f.getImage(zh.document, 'pixel.png')
  assert.equal(media.status, 200)
  assert.equal(media.headers.get('content-type'), 'image/png')
  assert.match(media.headers.get('content-security-policy'), /^sandbox;/)
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), image)
  assert.equal((await f.getImage(zh.document, '../../outside.png')).status, 404)
  assert.equal((await f.getImage(zh.document, 'other.txt')).status, 404)
  const en = await (await f.request({ language: 'fr-CA' })).json()
  assert.equal(en.origin, 'readme')
  assert.match(en.markdown, /^# Default README/)
  const foreign = f.ctx.connection.createPeer({ principal: { kind: 'fixture-reader' } })
  const before = f.reads()
  assert.equal((await f.request({}, foreign)).status, 403)
  assert.equal((await f.getImage(zh.document, 'pixel.png', foreign)).status, 403)
  assert.equal(f.reads(), before, 'non-owner requests never reach the package inventory')
  await f.fiber.dispose()
  assert.equal((await f.request({})).status, 404)
  assert.equal((await f.getImage(zh.document, 'pixel.png')).status, 404)
})

test('local document failures and same-version edits are re-read without an explicit retry', async t => {
  const f = await fixture(t, { maxDocumentBytes: 180 })
  await writeFile(path.join(f.pkg, 'docs', 'zh.md'), 'x'.repeat(181))
  const tooLarge = await f.request({})
  assert.equal(tooLarge.status, 413)
  assert.equal((await tooLarge.json()).reason, 'too-large')
  await writeFile(path.join(f.pkg, 'docs', 'zh.md'), '# Repaired')
  assert.equal((await (await f.request({})).json()).markdown, '# Repaired', 'installed files are not immutable cache entries')
  const repaired = await f.request({ refresh: 'true' })
  assert.equal(repaired.status, 200)
  assert.equal((await repaired.json()).markdown, '# Repaired')
  const before = await (await f.request({})).json()
  await writeFile(path.join(f.pkg, 'docs', 'zh.md'), '# Changed at the same package version')
  const changed = await (await f.request({})).json()
  assert.equal(changed.markdown, '# Changed at the same package version')
  assert.equal(changed.document, before.document, 'the existing image identity remains valid')
  assert.equal((await f.getImage(before.document, 'pixel.png')).status, 200)
  assert.equal((await f.request({ name: 'unlisted' })).status, 400)
  assert.equal((await f.request({ language: '../secret' })).status, 400)
  const unlisted = await f.request({ kind: 'market', url: 'https://fixture.invalid/index.json', name: 'listed', version: '2.0.0' })
  assert.equal(unlisted.status, 400, 'a client cannot request an unlisted package version')
  const noPublicSource = await f.request({ kind: 'market', url: 'https://fixture.invalid/index.json', name: 'listed', version: '1.0.0' })
  assert.deepEqual(await noPublicSource.json(), { status: 'none' }, 'private registries are never sent to public file CDNs')
})

async function remoteFixture(t) {
  const previous = getGlobalDispatcher()
  const agent = new MockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  t.after(async () => { setGlobalDispatcher(previous); await agent.close() })
  return agent
}

test('bundle and market retain independent CDN orders and image limits', async t => {
  const agent = await remoteFixture(t)
  const f = await fixture(t, {
    bundle: { npmFileSources: ['unpkg'], maxImageBytes: 4 },
    market: { npmFileSources: ['npmmirror'], maxImageBytes: 1024 },
  }, {
    bundles: [{ name: 'fixture-document-bundle', availability: 'missing', installTarget: { version: '1.0.0' } }],
    marketEntry: name => ({ name, versions: [{ version: '1.0.0', source: { type: 'npm' } }] }),
  })
  const unpkg = agent.get('https://unpkg.com')
  unpkg.intercept({ path: '/fixture-document-bundle@1.0.0/locale/en.json' }).reply(404)
  unpkg.intercept({ path: '/fixture-document-bundle@1.0.0/README.md' }).reply(200, '# Bundle')
  unpkg.intercept({ path: '/fixture-document-bundle@1.0.0/pixel.png' }).reply(200, image)
  const mirror = agent.get('https://registry.npmmirror.com')
  mirror.intercept({ path: '/fixture-document-bundle/1.0.0/files/locale/en.json' }).reply(404)
  mirror.intercept({ path: '/fixture-document-bundle/1.0.0/files/README.md' }).reply(200, '# Market')
  mirror.intercept({ path: '/fixture-document-bundle/1.0.0/files/pixel.png' }).reply(200, image)
  const bundle = await (await f.request({ language: 'en' })).json()
  const market = await (await f.request({ kind: 'market', url: 'https://fixture.invalid/index.json', language: 'en', version: '1.0.0' })).json()
  assert.equal(bundle.markdown, '# Bundle')
  assert.equal(market.markdown, '# Market')
  assert.notEqual(bundle.document, market.document, 'independent limits must not share image authorization records')
  assert.equal((await f.getImage(bundle.document, 'pixel.png')).status, 413)
  assert.equal((await f.getImage(market.document, 'pixel.png')).status, 200)
  agent.assertNoPendingInterceptors()
})

test('an explicitly configured GitLab host uses its file API with the listed pinned commit', async t => {
  const agent = await remoteFixture(t)
  const commit = 'a'.repeat(40)
  const f = await fixture(t, { market: { gitlabHosts: ['GITLAB.FIXTURE.INVALID'], maxRepositoryBytes: 12345,
    maxCacheBytes: 54321, cacheDir: '.custom-doc-cache', gitTimeoutMs: 1234 } }, {
    marketEntry: name => ({ name, versions: [{ version: '1.0.0', source: { type: 'git', url: 'https://gitlab.fixture.invalid/group/project.git', commit } }] }),
  })
  const gitlab = agent.get('https://gitlab.fixture.invalid')
  gitlab.intercept({ path: `/api/v4/projects/group%2Fproject/repository/files/locale%2Fen.json/raw?ref=${commit}` }).reply(404)
  gitlab.intercept({ path: '/group/project.git/info/refs?service=git-upload-pack' }).reply(200)
  gitlab.intercept({ path: `/api/v4/projects/group%2Fproject/repository/files/README.md/raw?ref=${commit}` }).reply(200, '# Self-hosted')
  const result = await f.request({ kind: 'market', url: 'https://fixture.invalid/index.json', name: 'listed', language: 'en', version: '1.0.0' })
  assert.equal(result.status, 200)
  assert.equal((await result.json()).markdown, '# Self-hosted')
  agent.assertNoPendingInterceptors()
})

test('remote version failures stay cached and explicit retry uses only the selected CDN', async t => {
  const agent = await remoteFixture(t)
  const f = await fixture(t, { market: { npmFileSources: ['unpkg'], maxDocumentBytes: 16 } }, {
    marketEntry: name => ({ name, versions: [{ version: '1.0.0', source: { type: 'npm' } }] }),
  })
  const pool = agent.get('https://unpkg.com')
  pool.intercept({ path: '/listed@1.0.0/locale/en.json' }).reply(404).times(2)
  pool.intercept({ path: '/listed@1.0.0/README.md' }).reply(200, 'x'.repeat(17))
  pool.intercept({ path: '/listed@1.0.0/README.md' }).reply(200, '# Repaired')
  const params = { kind: 'market', url: 'https://fixture.invalid/index.json', name: 'listed', language: 'en', version: '1.0.0' }
  assert.equal((await f.request(params)).status, 413)
  assert.equal((await f.request(params)).status, 413)
  assert.equal((await (await f.request({ ...params, refresh: 'true' })).json()).markdown, '# Repaired')
  agent.assertNoPendingInterceptors()
})

test('relative document images cannot follow a package link outside its root', async t => {
  const f = await fixture(t)
  const outside = path.join(f.directory, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'private.png'), image)
  await symlink(outside, path.join(f.pkg, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  const document = await (await f.request({ language: 'en' })).json()
  assert.equal((await f.getImage(document.document, 'linked/private.png')).status, 404)
})
