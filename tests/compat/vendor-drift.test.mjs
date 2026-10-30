import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { driftMarkdown, driftReport, expandSource, hostTag, npmSource, previousVerifiedHost, readArchive, vendorSources } from '../../scripts/vendor-drift.mjs'

// Network-free: archives are written here in the shapes GitHub source archives and npm tarballs use.

const sha256 = text => createHash('sha256').update(text).digest('hex')

function header(name, size, type, prefix = '') {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644\0', 100)
  block.write('0000000\0', 108)
  block.write('0000000\0', 116)
  block.write(size.toString(8).padStart(11, '0') + '\0', 124)
  block.write('00000000000\0', 136)
  block.write(type, 156)
  block.write('ustar\0', 257)
  block.write('00', 263)
  block.write(prefix, 345, 155, 'utf8')
  block.fill(' ', 148, 156)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return block
}
function pad(bytes) {
  return Buffer.concat([bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}
function paxRecords(records) {
  return Buffer.from(
    Object.entries(records)
      .map(([key, value]) => {
        const body = ` ${key}=${value}\n`
        let length = body.length + 1
        while (String(length).length + body.length !== length) length++
        return `${length}${body}`
      })
      .join(''),
  )
}
/** Entries: { name, content } files, { pax: {...} } per-file extended header, { global: {...} }, { prefix } split names. */
function archive(entries) {
  const blocks = []
  for (const entry of entries) {
    if (entry.global || entry.pax) {
      const body = paxRecords(entry.global ?? entry.pax)
      blocks.push(header('pax_header', body.length, entry.global ? 'g' : 'x'), pad(body))
      continue
    }
    const body = Buffer.from(entry.content)
    blocks.push(header(entry.name, body.length, '0', entry.prefix), pad(body))
  }
  blocks.push(Buffer.alloc(1024))
  // Split into small chunks so the parser has to resume across header and body boundaries.
  const gz = gzipSync(Buffer.concat(blocks))
  const chunks = []
  for (let offset = 0; offset < gz.length; offset += 97) chunks.push(gz.subarray(offset, offset + 97))
  return chunks
}

test('archives are read with the wrapper directory stripped, keeping only wanted contents', async () => {
  const long = `packages/client/${'deep/'.repeat(30)}file.ts`
  const result = await readArchive(
    archive([
      { global: { comment: 'b830ec950faba0a46dda564be3e2d854afed94f1' } },
      { name: 'repo-sha/packages/a.ts', content: 'alpha' },
      { name: 'repo-sha/packages/skipped.ts', content: 'not kept' },
      { name: 'b.css', prefix: 'repo-sha/packages/client/ui', content: '.b{}' },
      { pax: { path: `repo-sha/${long}` } },
      { name: 'truncated-name-ignored', content: 'x'.repeat(1300) },
    ]),
    file => file !== 'packages/skipped.ts',
  )
  assert.equal(result.comment, 'b830ec950faba0a46dda564be3e2d854afed94f1')
  assert.deepEqual([...result.paths].sort(), [long, 'packages/a.ts', 'packages/client/ui/b.css', 'packages/skipped.ts'].sort())
  assert.equal(result.files.get('packages/a.ts')?.toString(), 'alpha')
  assert.equal(result.files.get('packages/client/ui/b.css')?.toString(), '.b{}')
  assert.equal(result.files.get(long)?.length, 1300)
  assert.equal(result.files.has('packages/skipped.ts'), false)
})

test('sources expand locale groups, parse npm sources and collect every use', () => {
  assert.deepEqual(expandSource('locales/{ja,es}.ts'), ['locales/ja.ts', 'locales/es.ts'])
  assert.deepEqual(npmSource('npm:@deepseek-ai/dsh-client-ui-model-selection@0.2.1-rc.4/lib/client.js'), {
    name: '@deepseek-ai/dsh-client-ui-model-selection',
    version: '0.2.1-rc.4',
    file: 'lib/client.js',
  })
  assert.equal(npmSource('packages/client/ui-chat/src/index.ts'), undefined)
  const sources = vendorSources({
    files: [{ source: 'p/a.ts', target: 'src/a.ts', sourceSha256: 'aa', adapted: false }],
    adapters: [
      { target: 'src/x.ts', sources: [{ source: 'p/a.ts', sourceSha256: 'aa' }] },
      { target: 'src/y.ts', sources: [{ source: 'p/a.ts', sourceSha256: 'aa' }] },
    ],
    translations: [
      { namespace: 'common', source: 'p/locales/{ja,de}.ts', languages: ['ja', 'de'] },
      { namespace: 'docs', target: 'src/docs.ts', sources: [{ source: 'p/b.ts', sourceSha256: 'bb' }] },
      { namespace: 'original', target: 'src/original.ts' },
    ],
  })
  assert.deepEqual([...sources.keys()].sort(), ['p/a.ts', 'p/b.ts', 'p/locales/de.ts', 'p/locales/ja.ts'])
  assert.deepEqual(sources.get('p/a.ts'), {
    adapted: true,
    sourceSha256: 'aa',
    uses: [
      { kind: 'file', target: 'src/a.ts' },
      { kind: 'adapter', target: 'src/x.ts' },
      { kind: 'adapter', target: 'src/y.ts' },
    ],
  })
  assert.deepEqual(sources.get('p/b.ts')?.uses, [{ kind: 'translation', target: 'src/docs.ts' }])
})

test('drift is classified by what changed upstream and whether the copy can simply be refreshed', () => {
  const file = (name, adapted, content) => ({ source: `p/${name}`, target: `src/${name}`, sourceSha256: sha256(content), adapted })
  const provenance = {
    files: [
      file('same.ts', false, 'same'),
      file('adapted.ts', true, 'adapted v1'),
      file('pristine.ts', false, 'pristine v1'),
      file('patched.ts', false, 'patched v1 + modern patch'),
      file('gone.ts', true, 'gone'),
      file('modern-only.ts', false, 'modern only'),
    ],
  }
  const side = (ref, entries) => ({
    ref,
    files: new Map(Object.entries(entries).map(([name, text]) => [`p/${name}`, Buffer.from(text)])),
    paths: new Set(Object.keys(entries).map(name => `p/${name}`)),
  })
  const base = side('base', {
    'same.ts': 'same',
    'adapted.ts': 'adapted v1',
    'pristine.ts': 'pristine v1',
    'patched.ts': 'patched v1',
    'gone.ts': 'gone',
    'old-neighbour.ts': '',
  })
  const head = side('head', {
    'same.ts': 'same',
    'adapted.ts': 'adapted v2',
    'pristine.ts': 'pristine v2',
    'patched.ts': 'patched v2',
    'old-neighbour.ts': '',
    'new.ts': '',
  })
  const report = driftReport({ provenance, base, head })
  assert.deepEqual(report.summary, { sources: 6, unchanged: 1, changed: 3, removed: 1, appeared: 0, notUpstream: 1, added: 1 })
  assert.deepEqual(
    report.mergeAdapted.map(row => row.source),
    ['p/adapted.ts', 'p/patched.ts'],
  )
  assert.equal(report.mergeAdapted.find(row => row.source === 'p/patched.ts')?.patched, true)
  assert.deepEqual(
    report.recopyVerbatim.map(row => row.source),
    ['p/pristine.ts'],
  )
  assert.deepEqual(
    report.removed.map(row => row.source),
    ['p/gone.ts'],
  )
  assert.deepEqual(
    report.notUpstream.map(row => row.source),
    ['p/modern-only.ts'],
  )
  assert.deepEqual(report.added, ['p/new.ts'])

  // Between two later releases, whether a copy was patched is still judged against the captured revision.
  const later = side('later', {
    'same.ts': 'same',
    'adapted.ts': 'adapted v2',
    'pristine.ts': 'pristine v3',
    'patched.ts': 'patched v3',
    'old-neighbour.ts': '',
    'new.ts': '',
  })
  const recent = driftReport({ provenance, base: head, head: later, captured: base })
  assert.deepEqual(
    recent.mergeAdapted.map(row => row.source),
    ['p/patched.ts'],
  )
  assert.deepEqual(
    recent.recopyVerbatim.map(row => row.source),
    ['p/pristine.ts'],
  )
  assert.deepEqual(recent.added, [])
})

test('markdown leads with the recent comparison and truncates long lists', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ source: `p/${index}.ts`, uses: [{ kind: 'file', target: `src/${index}.ts` }] }))
  const report = (base, head) => ({
    base,
    head,
    summary: { sources: 5, unchanged: 0, changed: 5, removed: 0, appeared: 0, notUpstream: 0, added: 0 },
    mergeAdapted: rows,
    recopyVerbatim: [],
    removed: [],
    appeared: [],
    notUpstream: [],
    added: [],
  })
  const markdown = driftMarkdown({ recent: report('rc.4', 'rc.5'), cumulative: report('captured', 'rc.5') }, { limit: 2 })
  assert.ok(markdown.indexOf('相对上一个已验证宿主') < markdown.indexOf('相对 vendor 抓取基线'))
  assert.match(markdown, /- `p\/1\.ts` → `src\/1\.ts`\n- …另有 3 项/)
  assert.doesNotMatch(markdown, /p\/2\.ts/)
  assert.doesNotMatch(driftMarkdown({ recent: null, cumulative: report('captured', 'rc.5') }), /相对上一个已验证宿主/)
})

test('the recent baseline is the newest verified host below the release', () => {
  const verified = ['0.2.1-rc.2', '0.2.1-rc.4', '0.2.1-rc.3']
  assert.equal(previousVerifiedHost('0.2.1-rc.5', verified), '0.2.1-rc.4')
  assert.equal(previousVerifiedHost('0.2.1-rc.4', verified), '0.2.1-rc.3')
  assert.equal(previousVerifiedHost('0.2.1-rc.2', verified), undefined)
  assert.equal(hostTag('0.2.1-rc.5'), 'refs/tags/dsh-v0.2.1-rc.5')
})

test('every provenance source is either a monorepo path or an exact npm package file', async () => {
  const provenance = JSON.parse(await readFile(new URL('../../packages/modern-ui/provenance.json', import.meta.url), 'utf8'))
  const sources = [...vendorSources(provenance).keys()]
  assert.ok(sources.length > 500)
  for (const source of sources) {
    const npm = npmSource(source)
    if (npm) assert.match(npm.version, /^\d+\.\d+\.\d+/, source)
    else assert.match(source, /^packages\/[\w./@-]+$/, source)
  }
})
