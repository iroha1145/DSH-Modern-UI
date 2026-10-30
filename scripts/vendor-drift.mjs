// Report which vendored upstream sources changed for an official DSH release. Two comparisons:
//   recent      - the newest verified host below it → the release: the first clue when a new rc fails;
//   cumulative  - the revision the vendor tree was captured from (provenance.json `commit`) → the
//                 release: everything the vendored copies have not absorbed.
// The npm packages do not ship src/, so monorepo sources come from GitHub source archives
// (tag `dsh-v<version>`); `npm:<package>@<version>/<file>` sources come from the npm registry.
//   node scripts/vendor-drift.mjs --host <version> [--since <version>|none] [--json <file>] [--markdown <file>] [--cache <dir>]
// Drift is information, not failure: the exit code is non-zero only when a side cannot be read.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGunzip } from 'node:zlib'
import { compareVersions, parseVersion, supportedHostVersions } from './distribution/compatibility.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Release tag the upstream monorepo uses for one published @deepseek-ai/dsh version. */
export const hostTag = version => `refs/tags/dsh-v${version}`

/**
 * Read a gzipped tar stream, keeping the bytes of wanted regular files and the paths of all of them.
 * The archive's top-level directory is stripped: GitHub source archives and npm tarballs both wrap
 * the tree in one.
 * @param {AsyncIterable<Buffer> | Iterable<Buffer>} source - gzipped tar bytes.
 * @param {(file: string) => boolean} wanted - whether to keep a file's contents.
 * @returns {Promise<{ files: Map<string, Buffer>, paths: Set<string>, comment: string | undefined }>}
 */
export async function readArchive(source, wanted) {
  const files = new Map()
  const paths = new Set()
  let comment
  let pending = Buffer.alloc(0)
  let entry
  let longName
  let pax = {}
  const finish = () => {
    const bytes = entry.chunks === undefined ? undefined : Buffer.concat(entry.chunks)
    if (entry.type === 'g') comment = parsePax(bytes).comment ?? comment
    else if (entry.type === 'x') pax = parsePax(bytes)
    else if (entry.type === 'L') longName = bytes.toString('utf8').replace(/\0+$/, '')
    else if (entry.keep) files.set(entry.name, bytes)
    entry = undefined
  }
  for await (const chunk of Readable.from(source).pipe(createGunzip())) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    while (true) {
      if (entry !== undefined) {
        if (entry.remaining > 0) {
          if (pending.length === 0) break
          const take = Math.min(entry.remaining, pending.length)
          entry.chunks?.push(pending.subarray(0, take))
          pending = pending.subarray(take)
          entry.remaining -= take
          if (entry.remaining > 0) break
        }
        if (pending.length < entry.padding) break
        pending = pending.subarray(entry.padding)
        finish()
        continue
      }
      if (pending.length < 512) break
      const header = pending.subarray(0, 512)
      pending = pending.subarray(512)
      if (header.every(byte => byte === 0)) continue
      const field = (start, length) =>
        header
          .subarray(start, start + length)
          .toString('utf8')
          .replace(/\0.*$/s, '')
      const size = Number.parseInt(field(124, 12).trim() || '0', 8)
      const type = field(156, 1) || '0'
      const meta = type === 'x' || type === 'g' || type === 'L'
      const prefix = field(345, 155)
      let name = pax.path ?? longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
      if (!meta) {
        pax = {}
        longName = undefined
      }
      name = name.split('/').slice(1).join('/')
      const regular = !meta && (type === '0' || type === '7') && name !== ''
      if (regular) paths.add(name)
      const keep = regular && wanted(name)
      entry = { name, type, keep, remaining: size, padding: (512 - (size % 512)) % 512, chunks: meta || keep ? [] : undefined }
    }
  }
  return { files, paths, comment }
}

function parsePax(bytes) {
  const records = {}
  let offset = 0
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset)
    if (space < 0) break
    const length = Number.parseInt(bytes.subarray(offset, space).toString('utf8'), 10)
    if (!Number.isSafeInteger(length) || length <= 0) break
    const record = bytes.subarray(space + 1, offset + length - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return records
}

/** Expand the one `{a,b}` group provenance uses for per-language locale files. */
export function expandSource(source) {
  const match = /\{([^{}]+)\}/.exec(source)
  if (!match) return [source]
  return match[1].split(',').flatMap(part => expandSource(source.slice(0, match.index) + part + source.slice(match.index + match[0].length)))
}

/**
 * Parse an `npm:<package>@<version>/<file>` source.
 * @returns {{ name: string, version: string, file: string } | undefined}
 */
export function npmSource(source) {
  const match = /^npm:((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.+)$/.exec(source)
  return match ? { name: match[1], version: match[2], file: match[3] } : undefined
}

/**
 * Every upstream source the package derives from, with how it is used.
 * @param {object} provenance - parsed provenance.json.
 * @returns {Map<string, { adapted: boolean, sourceSha256: string | undefined, uses: { kind: string, target: string }[] }>}
 */
export function vendorSources(provenance) {
  const sources = new Map()
  const add = (pattern, use, adapted, sourceSha256) => {
    for (const source of expandSource(pattern)) {
      const current = sources.get(source) ?? { adapted: false, sourceSha256: undefined, uses: [] }
      current.adapted ||= adapted
      current.sourceSha256 ??= source === pattern ? sourceSha256 : undefined
      if (!current.uses.some(known => known.kind === use.kind && known.target === use.target)) current.uses.push(use)
      sources.set(source, current)
    }
  }
  for (const file of provenance.files ?? []) add(file.source, { kind: 'file', target: file.target }, file.adapted === true, file.sourceSha256)
  for (const adapter of provenance.adapters ?? []) {
    for (const source of adapter.sources ?? []) add(source.source, { kind: 'adapter', target: adapter.target }, true, source.sourceSha256)
  }
  for (const translation of provenance.translations ?? []) {
    // A translation names one source, several (with digests), or none when its text is original.
    const use = { kind: 'translation', target: translation.target ?? translation.namespace }
    if (translation.source !== undefined) add(translation.source, use, true, translation.sourceSha256)
    for (const source of translation.sources ?? []) add(source.source, use, true, source.sourceSha256)
  }
  return sources
}

/**
 * Classify each vendored source by what changed upstream between two revisions.
 * @param {object} input
 * @param {object} input.provenance - parsed provenance.json.
 * @param {{ ref: string, files: Map<string, Buffer>, paths?: Set<string> }} input.base - earlier revision.
 * @param {{ ref: string, files: Map<string, Buffer>, paths: Set<string> }} input.head - later revision.
 * @param {{ files: Map<string, Buffer> }} [input.captured] - revision the vendor tree was captured from;
 *   defaults to base. Tells verbatim copies of pristine upstream files from copies of patched ones.
 */
export function driftReport({ provenance, base, head, captured = base }) {
  const sources = vendorSources(provenance)
  const rows = []
  for (const [source, info] of [...sources].sort(([left], [right]) => left.localeCompare(right))) {
    const before = base.files.get(source)
    const after = head.files.get(source)
    const baseSha256 = before === undefined ? null : sha256(before)
    const headSha256 = after === undefined ? null : sha256(after)
    let status
    if (baseSha256 === null) status = headSha256 === null ? 'not-upstream' : 'appeared'
    else if (headSha256 === null) status = 'removed'
    else status = baseSha256 === headSha256 ? 'unchanged' : 'changed'
    const original = captured.files.get(source)
    rows.push({
      source,
      status,
      adapted: info.adapted,
      // True when the legacy Modern patch had changed the source before it was captured; null when unknown.
      patched: info.sourceSha256 === undefined || original === undefined ? null : info.sourceSha256 !== sha256(original),
      uses: info.uses,
      baseSha256,
      headSha256,
    })
  }
  const directories = new Set([...sources.keys()].map(source => path.posix.dirname(source)))
  const added = [...head.paths].filter(file => directories.has(path.posix.dirname(file)) && !sources.has(file) && base.paths?.has(file) !== true).sort()
  const pick = status => rows.filter(row => row.status === status)
  const changed = pick('changed')
  return {
    base: base.ref,
    head: head.ref,
    summary: {
      sources: rows.length,
      unchanged: pick('unchanged').length,
      changed: changed.length,
      removed: pick('removed').length,
      appeared: pick('appeared').length,
      notUpstream: pick('not-upstream').length,
      added: added.length,
    },
    // Only a verbatim copy of an unpatched source can simply be copied again; anything else is merged.
    mergeAdapted: changed.filter(row => row.adapted || row.patched !== false),
    recopyVerbatim: changed.filter(row => !row.adapted && row.patched === false),
    removed: pick('removed'),
    appeared: pick('appeared'),
    notUpstream: pick('not-upstream'),
    added,
    rows,
  }
}

function reportMarkdown(title, report, limit) {
  const list = (items, describe) => {
    const shown = items.slice(0, limit).map(describe)
    if (items.length > limit) shown.push(`- …另有 ${items.length - limit} 项，见 JSON 报告`)
    return shown.join('\n')
  }
  const targets = row => [...new Set(row.uses.map(use => use.target))].map(target => `\`${target}\``).join('、')
  const { summary } = report
  const lines = [
    `### ${title}：\`${report.base}\` → \`${report.head}\``,
    '',
    `${summary.sources} 个上游源文件：未变 ${summary.unchanged}，改动 ${summary.changed}，删除 ${summary.removed}，两侧都没有 ${summary.notUpstream}；被 vendor 的目录里新增 ${summary.added}。`,
  ]
  const section = (heading, items, describe) => {
    if (items.length > 0) lines.push('', `**${heading}：${items.length}**`, '', list(items, describe))
  }
  section('上游已改动、本地有改写或抓取时已打补丁（需人工合并）', report.mergeAdapted, row => `- \`${row.source}\` → ${targets(row)}`)
  section('上游已改动、本地是未打补丁的原样副本（可直接重新复制）', report.recopyVerbatim, row => `- \`${row.source}\``)
  section('上游已删除或改名', report.removed, row => `- \`${row.source}\` → ${targets(row)}`)
  section('基线没有、上游后来出现', report.appeared, row => `- \`${row.source}\` → ${targets(row)}`)
  section('被 vendor 的目录里上游新增的文件', report.added, file => `- \`${file}\``)
  return lines.join('\n')
}

/** Markdown for the step summary and the canary issue; the JSON report has every row. */
export function driftMarkdown({ recent, cumulative }, { limit = 40 } = {}) {
  const parts = []
  if (recent) parts.push(reportMarkdown('相对上一个已验证宿主', recent, limit))
  parts.push(reportMarkdown('相对 vendor 抓取基线（累计）', cumulative, limit))
  const notUpstream = cumulative.notUpstream.length
  if (notUpstream > 0) parts.push(`上游没有的 ${notUpstream} 个源文件是旧 Modern 补丁新增的文件（\`provenance.json\` 的 \`modernUiCommit\`），不随上游变化。`)
  return parts.join('\n\n') + '\n'
}

/**
 * Newest verified host strictly below a version, the baseline for the recent comparison.
 * @param {string} version - host under test.
 * @param {readonly string[]} [verified] - verified host versions.
 */
export function previousVerifiedHost(version, verified = supportedHostVersions) {
  return verified
    .filter(candidate => compareVersions(candidate, version) < 0)
    .toSorted(compareVersions)
    .at(-1)
}

function githubArchiveUrl(repository, ref) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repository)
  if (!match) throw new Error(`Unsupported upstream repository: ${repository}`)
  return `https://codeload.github.com/${match[1]}/${match[2]}/tar.gz/${ref}`
}

function npmTarballUrl(name, version) {
  return `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`
}

async function download(url, cache, key) {
  const cached = cache === undefined ? undefined : path.join(cache, `${key.replace(/[^\w.-]+/g, '_')}.tgz`)
  if (cached !== undefined && existsSync(cached)) return readFile(cached)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download ${url} failed (HTTP ${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (cached !== undefined) {
    await mkdir(cache, { recursive: true })
    await writeFile(cached, bytes)
  }
  return bytes
}

/**
 * Read one side: the monorepo at a ref plus every npm-sourced package at a version.
 * @param {object} input
 * @param {string} input.repository - upstream GitHub repository.
 * @param {string} input.ref - Git ref of the monorepo side.
 * @param {(npm: { name: string, version: string }) => string} input.npmVersion - package version for this side.
 */
async function readSide({ sources, repository, ref, npmVersion, cache }) {
  const monorepo = await readArchive([await download(githubArchiveUrl(repository, ref), cache, `github-${ref}`)], file => sources.has(file))
  const files = new Map(monorepo.files)
  const packages = new Map()
  for (const source of sources.keys()) {
    const npm = npmSource(source)
    if (npm === undefined) continue
    const version = npmVersion(npm)
    const key = `${npm.name}@${version}`
    if (!packages.has(key)) {
      packages.set(
        key,
        download(npmTarballUrl(npm.name, version), cache, `npm-${key}`).then(bytes => readArchive([bytes], () => true)),
      )
    }
    const file = (await packages.get(key)).files.get(npm.file)
    if (file !== undefined) files.set(source, file)
  }
  return { ref: monorepo.comment ? `${ref} (${monorepo.comment.slice(0, 12)})` : ref, files, paths: monorepo.paths }
}

async function main(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!['--host', '--since', '--json', '--markdown', '--cache', '--provenance'].includes(key) || argv[index + 1] === undefined) {
      throw new Error('Usage: node scripts/vendor-drift.mjs --host <version> [--since <version>|none] [--json <file>] [--markdown <file>] [--cache <dir>]')
    }
    options[key.slice(2)] = argv[index + 1]
  }
  if (!parseVersion(options.host ?? '')) throw new Error(`--host must be an official DSH version, got ${options.host}`)
  const since = options.since === 'none' ? undefined : (options.since ?? previousVerifiedHost(options.host))
  if (since !== undefined && !parseVersion(since)) throw new Error(`--since must be a version or "none", got ${since}`)
  const provenance = JSON.parse(await readFile(options.provenance ?? path.join(root, 'packages/modern-ui/provenance.json'), 'utf8'))
  const sources = vendorSources(provenance)
  const side = (ref, npmVersion) => readSide({ sources, repository: provenance.source, ref, npmVersion, cache: options.cache })
  // The captured side of an npm source is the exact version provenance records.
  const [captured, previous, head] = await Promise.all([
    side(provenance.commit, npm => npm.version),
    since === undefined ? undefined : side(hostTag(since), () => since),
    side(hostTag(options.host), () => options.host),
  ])
  const cumulative = driftReport({ provenance, base: captured, head })
  const recent = previous === undefined ? null : driftReport({ provenance, base: previous, head, captured })
  const result = { host: options.host, since: since ?? null, recent, cumulative }
  const markdown = driftMarkdown(result)
  if (options.json) await writeFile(options.json, JSON.stringify(result, null, 2) + '\n')
  if (options.markdown) await writeFile(options.markdown, markdown)
  process.stdout.write(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' })
  if (cumulative.summary.unchanged + cumulative.summary.changed + cumulative.summary.removed === 0) {
    throw new Error('No vendored source was found in the captured revision; check provenance.json `commit` and `source`')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
