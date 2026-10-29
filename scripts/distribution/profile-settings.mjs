import { createHash } from 'node:crypto'
import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const fields = ['models', 'prices', 'pricesUpdatedAt']
const hash = text => createHash('sha256').update(text).digest('hex')

function plain(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false
  seen.add(value)
  const result = Object.values(value).every(item => plain(item, seen))
  seen.delete(value)
  return result
}

export function schemaFor(yaml) {
  class Expression { constructor(source) { this.source = source } }
  const expression = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar', instanceOf: Expression,
    construct: source => new Expression(source), represent: value => value.source,
  })
  return yaml.JSON_SCHEMA.extend([expression])
}

function patchRows(nodes, seen = new Set()) {
  if (!Array.isArray(nodes)) throw new Error('Profile patch must be an array of Cordis patch operations')
  if (seen.has(nodes)) throw new Error('Cyclic profile patch cannot be migrated automatically')
  seen.add(nodes)
  const result = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Unsupported profile patch operation')
    if (typeof node.id === 'string') result.push(node)
    if (Array.isArray(node.insert)) result.push(...patchRows(node.insert, seen))
  }
  seen.delete(nodes)
  return result
}

/** Convert only settings in a copied profile patch; unrelated expressions remain inert YAML. */
export function transformProfileSettings(source, yaml) {
  const schema = schemaFor(yaml)
  const patch = yaml.load(source, { schema }) ?? []
  const rows = patchRows(patch)
  const unique = id => {
    const found = rows.filter(row => row.id === id)
    if (found.length > 1) throw new Error(`Multiple ${id} rows require manual precedence review`)
    return found[0]
  }
  const model = unique('ui-model-selection')
  const conversation = unique('ui-conversation')
  const modern = unique('modern-ui')
  for (const row of [model, conversation, modern].filter(Boolean)) {
    if (row.config !== undefined && (!row.config || Array.isArray(row.config) || Object.getPrototypeOf(row.config) !== Object.prototype)) {
      throw new Error(`Computed or non-object ${row.id} config requires manual review; it was not evaluated`)
    }
  }
  const proposed = {}
  for (const name of fields) if (Object.hasOwn(model?.config ?? {}, name)) proposed[name] = model.config[name]
  if (Object.hasOwn(conversation?.config ?? {}, 'collapsedViews')) proposed.collapsedViews = conversation.config.collapsedViews
  if (!Object.keys(proposed).length) return { source, result: { changed: false, movedFields: [], conversionVersion: 1 } }
  if (!plain(proposed)) throw new Error('Legacy settings must be finite JSON values; computed fields were not evaluated')
  if (proposed.collapsedViews !== undefined && (!Array.isArray(proposed.collapsedViews) || proposed.collapsedViews.some(value => typeof value !== 'string'))) {
    throw new Error('Legacy collapsedViews must be a string array')
  }
  const target = { ...modern?.config }
  const added = []
  for (const [name, value] of Object.entries(proposed)) {
    if (Object.hasOwn(target, name) && !isDeepStrictEqual(target[name], value)) {
      throw new Error(`Legacy ${name} conflicts with modern-ui settings; neither value was overwritten`)
    }
    if (!Object.hasOwn(target, name)) { target[name] = value; added.push(name) }
  }
  if (!added.length) return { source, result: { changed: false, movedFields: [], conversionVersion: 1 } }
  if (modern) modern.config = target
  else patch.push({ id: 'modern-ui', config: target })
  return { source: yaml.dump(patch, { schema, lineWidth: -1, noCompatMode: true }), result: {
    changed: true, movedFields: added, conversionVersion: 1,
    collapsedViews: proposed.collapsedViews === undefined ? 'not present' : 'preserved; UI application not yet accepted',
  } }
}

/** Call only for a new staged profile, after copying the user's source profile. */
export async function preserveLegacySettings(profile, yaml) {
  const filename = join(profile, 'cordis.patch.yml')
  const receiptPath = join(profile, 'modern-ui-settings-migration.json')
  let receiptBytes
  try { receiptBytes = await readFile(receiptPath, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (receiptBytes !== undefined) {
    const receipt = JSON.parse(receiptBytes)
    if (receipt.conversionVersion !== 1 || receipt.backup !== 'modern-ui-settings-before-migration.yml') throw new Error('Unsupported settings migration receipt')
    const backup = await readFile(join(profile, receipt.backup), 'utf8')
    if (hash(backup) !== receipt.originalSha256) throw new Error('Settings migration backup checksum mismatch')
    return { changed: false, movedFields: [], conversionVersion: 1, alreadyMigrated: true }
  }
  let info
  try { info = await lstat(filename) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!info) return { changed: false, movedFields: [], conversionVersion: 1 }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Staged profile patch must be a regular file')
  if (info.size > 1024 * 1024) throw new Error('Profile patch is too large for automatic settings conversion')
  const original = await readFile(filename, 'utf8')
  const transformed = transformProfileSettings(original, yaml)
  if (!transformed.result.changed) return transformed.result
  const backup = join(profile, 'modern-ui-settings-before-migration.yml')
  // No overwrite, including on a partially completed earlier attempt.
  await writeFile(backup, original, { flag: 'wx', mode: 0o600 })
  const temporary = join(profile, 'modern-ui-settings.pending.yml')
  await writeFile(temporary, transformed.source, { flag: 'wx', mode: 0o600 })
  if (await readFile(filename, 'utf8') !== original) throw new Error('Staged profile patch changed during settings conversion')
  await rename(temporary, filename)
  const result = { ...transformed.result, originalSha256: hash(original), migratedSha256: hash(transformed.source),
    backup: 'modern-ui-settings-before-migration.yml' }
  await writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return result
}

const HOST_REPLACEMENTS = {
  '@deepseek-ai/dsh-experimental-translator': '@iroha1145/dsh-modern-ui/translator',
  '@deepseek-ai/dsh-mcp-client': '@iroha1145/dsh-modern-ui/mcp-client',
  '@deepseek-ai/dsh-web-fetch-http': '@iroha1145/dsh-modern-ui/web-fetch-http',
}

/** Read inherited settings before the new bundle contributes its default configuration. */
export function transformEffectivePreferences(source, beforeYaml, afterYaml, yaml, { migrateUi = true } = {}) {
  const schema = schemaFor(yaml)
  const patch = yaml.load(source, { schema }) ?? []
  const rows = patchRows(patch)
  const before = yaml.load(beforeYaml, { schema })
  const after = yaml.load(afterYaml, { schema })
  if (!Array.isArray(before) || !Array.isArray(after)) throw new Error('Effective configuration must be an entry list')
  const unique = (entries, name) => {
    const matches = entries.filter(row => row.name === name)
    if (matches.length > 1) throw new Error(`Multiple ${name} entries require explicit precedence review`)
    const config = matches[0]?.config ?? {}
    if (!config || Object.getPrototypeOf(config) !== Object.prototype) throw new Error(`Computed ${name} settings require explicit review; not evaluated`)
    return { entry: matches[0], config }
  }
  const modernName = '@iroha1145/dsh-modern-ui'
  const originalModern = unique(before, modernName)
  const target = unique(after, modernName)
  if (target.entry?.id !== 'modern-ui') throw new Error('Effective preferences require the Modern UI owner')
  const modernRows = rows.filter(row => row.id === 'modern-ui')
  if (modernRows.length > 1) throw new Error('Layered Modern UI settings require explicit precedence review')
  const explicit = modernRows[0]?.config ?? {}
  if (!explicit || Object.getPrototypeOf(explicit) !== Object.prototype) throw new Error('Computed Modern UI settings require explicit review')
  const protectedFields = { ...originalModern.config, ...explicit }
  // These two empty maps are contributed by Modern's bundle, even in profiles
  // whose earlier converter never copied inherited picker settings. An explicit
  // patch value (including an intentionally empty map) always wins.
  for (const key of ['models', 'prices']) {
    const value = protectedFields[key]
    if (!Object.hasOwn(explicit, key) && value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0) delete protectedFields[key]
  }
  const config = { ...target.config, ...explicit }
  const movedFields = []
  for (const [name, keys] of [
    ['@deepseek-ai/dsh-client-ui-model-selection', fields],
    ['@deepseek-ai/dsh-client-ui-chat', CHAT_PREFERENCE_FIELDS],
  ]) {
    if (!migrateUi) break
    const original = unique(before, name).config
    for (const key of keys) {
      if (!Object.hasOwn(original, key) || Object.hasOwn(protectedFields, key)) continue
      if (!plain(original[key])) throw new Error(`Computed ${key} requires explicit review; not evaluated`)
      if (CHAT_PREFERENCE_FIELDS.includes(key) && (typeof original[key] !== 'string' || (key === 'foldedReplies' && !['all', 'final'].includes(original[key])))) throw new Error(`Invalid chat preference: ${key}`)
      config[key] = original[key]
      movedFields.push(key)
    }
  }
  if (movedFields.length) {
    if (modernRows[0]) modernRows[0].config = config
    else patch.push({ id: 'modern-ui', name: modernName, config })
  }
  const documentName = '@iroha1145/dsh-modern-ui/plugin-documents'
  const documentTarget = unique(after, documentName)
  const proposed = {}
  const sourceFields = {
    bundle: ['@deepseek-ai/dsh-plugin-manager', {
      detailMaxBytes: 'maxDocumentBytes', detailImageMaxBytes: 'maxImageBytes',
      detailFetchTimeoutMs: 'fetchTimeoutMs', detailNpmFileSources: 'npmFileSources',
    }],
    market: ['@deepseek-ai/dsh-plugin-market', {
      detailMaxBytes: 'maxDocumentBytes', detailImageMaxBytes: 'maxImageBytes', fetchTimeoutMs: 'fetchTimeoutMs',
      cacheTtlMs: 'cacheTtlMs', detailNpmFileSources: 'npmFileSources', detailGitlabHosts: 'gitlabHosts',
      detailRepositoryMaxBytes: 'maxRepositoryBytes', detailCacheMaxBytes: 'maxCacheBytes',
      detailCacheDir: 'cacheDir', detailGitTimeoutMs: 'gitTimeoutMs',
    }],
  }
  for (const [kind, [name, mapping]] of Object.entries(sourceFields)) {
    const original = unique(before, name).config
    for (const [from, to] of Object.entries(mapping)) if (Object.hasOwn(original, from)) {
      const value = original[from]
      if (!proposed[kind]) proposed[kind] = {}
      proposed[kind][to] = value
    }
  }
  if (Object.keys(proposed).length) {
    if (typeof documentTarget.entry?.id !== 'string') throw new Error('Document settings require one addressable Modern document owner')
    const documentRows = rows.filter(row => row.id === documentTarget.entry.id)
    if (documentRows.length > 1) throw new Error('Layered Modern document settings require explicit precedence review')
    const explicitDocument = documentRows[0]?.config ?? {}
    if (!explicitDocument || Object.getPrototypeOf(explicitDocument) !== Object.prototype) throw new Error('Computed Modern document config requires explicit review')
    const target = { ...documentTarget.config, ...explicitDocument }
    const originalModern = unique(before, documentName).config
    const protectedConfig = { ...originalModern, ...target }
    const additions = []
    for (const [kind, values] of Object.entries(proposed)) {
      const inherited = originalModern[kind] ?? {}
      const current = target[kind] ?? {}
      if (!inherited || Object.getPrototypeOf(inherited) !== Object.prototype || !current || Object.getPrototypeOf(current) !== Object.prototype) throw new Error(`Computed document ${kind} config requires explicit review`)
      const existing = { ...inherited, ...current }
      const migrated = { ...existing }
      for (const [key, value] of Object.entries(values)) {
        // The previous flat Modern limit fields also express a deliberate override.
        if (Object.hasOwn(existing, key) || Object.hasOwn(protectedConfig, key)) continue
        if (!plain(value)) throw new Error(`Computed document ${kind}.${key} requires explicit review; not evaluated`)
        migrated[key] = value
        additions.push(`documents.${kind}.${key}`)
      }
      if (Object.keys(migrated).length) target[kind] = migrated
    }
    if (additions.length) {
      if (documentRows[0]) documentRows[0].config = target
      else patch.push({ id: documentTarget.entry.id, name: documentName, config: target })
      movedFields.push(...additions)
    }
  }
  return { source: movedFields.length ? yaml.dump(patch, { schema, lineWidth: -1, noCompatMode: true }) : source,
    result: { changed: movedFields.length > 0, movedFields, conversionVersion: 2 } }
}

async function readMigrationEvidence(profile, name) {
  let info
  try { info = await lstat(join(profile, name)) } catch (error) { if (error.code !== 'ENOENT') throw error; return }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return
  return readFile(join(profile, name), 'utf8')
}

async function migrationEvidence(profile, filename, backups) {
  const bytes = await readMigrationEvidence(profile, filename)
  if (bytes === undefined) return
  let receipt
  try { receipt = JSON.parse(bytes) } catch (error) { if (!(error instanceof SyntaxError)) throw error; return }
  if (!receipt || !Object.hasOwn(backups, receipt.conversionVersion) || !backups[receipt.conversionVersion].includes(receipt.backup)
    || ![receipt.originalSha256, receipt.migratedSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) return
  const source = await readMigrationEvidence(profile, receipt.backup)
  if (source === undefined || hash(source) !== receipt.originalSha256) return
  return { filename, receipt, source, receiptSha256: hash(bytes) }
}

/** Reconstruct only the two append-only writes omitted from the old receipt chain. */
async function legacyBindingEvidence(profile, snapshots, records, yaml, schema) {
  const object = value => value && Object.getPrototypeOf(value) === Object.prototype
  const keys = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))
  const id = value => typeof value === 'string' && value.length > 0 && value !== 'modern-ui'
  const config = value => object(value) && !Object.hasOwn(value, 'plugins')
  const shellNames = new Set(['@deepseek-ai/dsh-pwsh-local', '@deepseek-ai/dsh-pwsh-sandbox'])
  const shell = row => keys(row, ['id', 'name', 'config']) && id(row.id) && shellNames.has(row.name)
    && config(row.config) && typeof row.config.pwshPath === 'string' && row.config.pwshPath.length > 0
  const host = (disable, insert) => {
    if (!keys(disable, ['id', 'name', 'disabled']) || !id(disable.id) || disable.disabled !== true
      || !Object.hasOwn(HOST_REPLACEMENTS, disable.name) || !keys(insert, ['insert'])
      || !Array.isArray(insert.insert) || insert.insert.length !== 1) return false
    const replacement = insert.insert[0]
    return object(replacement) && replacement.id === `modern-ui-compat-${disable.id}`
      && replacement.name === HOST_REPLACEMENTS[disable.name]
      && Object.keys(replacement).every(key => ['id', 'name', 'config', 'group', 'disabled', 'inject', 'intercept', 'isolate'].includes(key))
      && (replacement.group === undefined || replacement.group === false || replacement.group === null)
      && (replacement.disabled === undefined || replacement.disabled === null || replacement.disabled === false)
      && (replacement.config === undefined || config(replacement.config))
  }
  const dump = rows => yaml.dump(rows, { schema, lineWidth: -1, noCompatMode: true })
  const anchors = new Set(records.flatMap(({ receipt }) => [receipt.originalSha256, receipt.migratedSha256]))
  const edges = []
  // Newly reconstructed prefixes may end in the preceding Host write. Every
  // accepted path still has to reach a checksum from a validated old receipt.
  for (const [migratedSha256, source] of snapshots) {
    let rows
    try { rows = yaml.load(source, { schema }) } catch (error) { if (!(error instanceof yaml.YAMLException)) throw error; continue }
    if (!Array.isArray(rows) || dump(rows) !== source) continue
    const connectPrefix = async (end, kind) => {
      const prefix = dump(rows.slice(0, end))
      const originalSha256 = hash(prefix)
      // A PowerShell predecessor must be recorded, or end in the Host stage
      // that can lead to a recorded predecessor. Do not retain arbitrary cuts.
      if (kind === 'powershell' && !anchors.has(originalSha256)
        && !(end >= 2 && host(rows[end - 2], rows[end - 1]))) return
      const edge = { kind, originalSha256, migratedSha256 }
      if (kind === 'host') {
        edge.backup = `modern-ui-host-before-${originalSha256.slice(0, 16)}.yml`
        if (await readMigrationEvidence(profile, edge.backup) !== prefix) return
      }
      snapshots.set(originalSha256, prefix)
      edges.push(edge)
    }
    let end = rows.length
    const ids = new Set()
    while (end && shell(rows[end - 1])) {
      if (ids.has(rows[end - 1].id)) break
      ids.add(rows[--end].id)
      await connectPrefix(end, 'powershell')
    }
    if (end < rows.length) continue
    while (end >= 2 && host(rows[end - 2], rows[end - 1])) {
      if (ids.has(rows[end - 2].id)) break
      ids.add(rows[end - 2].id)
      end -= 2
      await connectPrefix(end, 'host')
    }
  }
  return edges
}

/** Recover only empty picker maps introduced by the conversation writer, with an intact recorded path to today's file. */
async function recoverConversationPickerDefaults(profile, beforeYaml, afterYaml, yaml) {
  const receiptName = 'modern-ui-picker-defaults-recovery-v1.json'
  const backup = 'modern-ui-picker-defaults-before-recovery-v1.yml'
  const recovered = await migrationEvidence(profile, receiptName, { 1: [backup] })
  if (recovered) return { changed: false, alreadyRecovered: true }
  // A partial or altered recovery is not permission to run it again.
  try { await lstat(join(profile, receiptName)); throw new Error('Picker defaults recovery receipt is invalid') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const conversation = await migrationEvidence(profile, 'modern-ui-conversation-migration.json', {
    1: ['modern-ui-conversation-before-migration.yml'],
  })
  if (!conversation || conversation.receipt.changed !== true || conversation.receipt.namespace !== 'modern-ui') return { changed: false }
  const filename = join(profile, 'cordis.patch.yml')
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return { changed: false }
  const original = await readFile(filename, 'utf8')
  const currentHash = hash(original)
  const records = [conversation]
  for (const [name, backups] of [
    ['modern-ui-settings-migration.json', { 1: ['modern-ui-settings-before-migration.yml'] }],
    ['modern-ui-chat-migration.json', { 1: ['modern-ui-chat-before-migration.yml'], 2: ['modern-ui-chat-before-migration.yml', 'modern-ui-chat-before-migration-v2.yml'] }],
    ['modern-ui-effective-preferences-v1.json', { 1: ['modern-ui-effective-preferences-before-v1.yml'], 2: ['modern-ui-effective-preferences-before-v2.yml'] }],
  ]) {
    const record = await migrationEvidence(profile, name, backups)
    if (record) records.push(record)
  }
  const snapshots = new Map([[currentHash, original], ...records.map(record => [record.receipt.originalSha256, record.source])])
  const schema = schemaFor(yaml)
  const bindings = await legacyBindingEvidence(profile, snapshots, records, yaml, schema)
  const configOf = source => {
    if (source === undefined) return
    try {
      const rows = patchRows(yaml.load(source, { schema }) ?? []).filter(row => row.id === 'modern-ui')
      const config = rows[0]?.config ?? {}
      return rows.length <= 1 && config && Object.getPrototypeOf(config) === Object.prototype ? config : undefined
    } catch { return undefined } // Unsupported historical YAML is not evidence for an automatic overwrite.
  }
  const empty = value => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0
  const originalConfig = configOf(conversation.source)
  const generatedHash = conversation.receipt.migratedSha256
  const generatedConfig = configOf(snapshots.get(generatedHash))
  if (!originalConfig || !generatedConfig) return { changed: false }
  const effectiveConfig = (text, name) => {
    const entries = yaml.load(text, { schema })
    if (!Array.isArray(entries)) return
    const matches = entries.filter(entry => entry.name === name)
    return matches.length === 1 ? matches[0].config : undefined
  }
  const before = effectiveConfig(beforeYaml, '@iroha1145/dsh-modern-ui')
  const after = effectiveConfig(afterYaml, '@iroha1145/dsh-modern-ui')
  const inherited = effectiveConfig(beforeYaml, '@deepseek-ai/dsh-client-ui-model-selection')
  const currentConfig = configOf(original)
  const additions = {}
  const evidence = new Map([[conversation.filename, conversation.receiptSha256]])
  const automaticBindings = new Set()
  for (const key of ['models', 'prices']) {
    if (Object.hasOwn(originalConfig, key) || !empty(generatedConfig[key]) || !empty(currentConfig?.[key])
      || !empty(before?.[key]) || !empty(after?.[key]) || !inherited?.[key]
      || Object.getPrototypeOf(inherited[key]) !== Object.prototype || !Object.keys(inherited[key]).length || !plain(inherited[key])) continue
    const paths = new Map([[generatedHash, []]])
    for (const [digest, chain] of paths) {
      for (const record of [...records, ...bindings]) {
        const receipt = record.receipt ?? record
        if (receipt.originalSha256 !== digest || paths.has(receipt.migratedSha256)
          || !empty(configOf(snapshots.get(receipt.migratedSha256))?.[key])) continue
        paths.set(receipt.migratedSha256, [...chain, record])
      }
    }
    const chain = paths.get(currentHash)
    if (!chain) continue
    additions[key] = inherited[key]
    for (const record of chain) {
      if (record.receipt) evidence.set(record.filename, record.receiptSha256)
      else automaticBindings.add(record)
    }
  }
  if (!Object.keys(additions).length) return { changed: false }
  const patch = yaml.load(original, { schema })
  const row = patchRows(patch).find(row => row.id === 'modern-ui')
  row.config = { ...row.config, ...additions }
  const changed = yaml.dump(patch, { schema, lineWidth: -1, noCompatMode: true })
  await writeFile(join(profile, backup), original, { flag: 'wx', mode: 0o600 })
  const pending = join(profile, 'modern-ui-picker-defaults-recovery.pending.yml')
  await writeFile(pending, changed, { flag: 'wx', mode: 0o600 })
  if (await readFile(filename, 'utf8') !== original) throw new Error('Profile changed during picker defaults recovery')
  await rename(pending, filename)
  const result = { changed: true, conversionVersion: 1, recoveredFields: Object.keys(additions), backup,
    originalSha256: currentHash, migratedSha256: hash(changed), receipts: Object.fromEntries(evidence),
    automaticBindings: [...automaticBindings] }
  await writeFile(join(profile, receiptName), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return result
}

/** Independent receipt upgrades profiles previously handled by the patch-only converters. */
export async function preserveEffectivePreferences(profile, beforeYaml, afterYaml, yaml) {
  const filename = join(profile, 'cordis.patch.yml')
  const receiptPath = join(profile, 'modern-ui-effective-preferences-v1.json')
  const backups = { 1: 'modern-ui-effective-preferences-before-v1.yml', 2: 'modern-ui-effective-preferences-before-v2.yml' }
  const backup = backups[2]
  let previous
  try { previous = JSON.parse(await readFile(receiptPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous) {
    if (!(previous.conversionVersion in backups) || previous.backup !== backups[previous.conversionVersion] || hash(await readFile(join(profile, previous.backup), 'utf8')) !== previous.originalSha256) throw new Error('Effective preferences migration receipt is invalid')
  }
  const pickerDefaultsRecovery = await recoverConversationPickerDefaults(profile, beforeYaml, afterYaml, yaml)
  if (previous?.conversionVersion === 2) return { changed: pickerDefaultsRecovery.changed, alreadyMigrated: true,
    conversionVersion: 2, pickerDefaultsRecovery }
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Effective migration requires a small regular profile patch')
  const original = await readFile(filename, 'utf8')
  const transformed = transformEffectivePreferences(original, beforeYaml, afterYaml, yaml, { migrateUi: !previous })
  await writeFile(join(profile, backup), original, { flag: 'wx', mode: 0o600 })
  if (transformed.result.changed) {
    const pending = join(profile, 'modern-ui-effective-preferences.pending.yml')
    await writeFile(pending, transformed.source, { flag: 'wx', mode: 0o600 })
    if (await readFile(filename, 'utf8') !== original) throw new Error('Profile changed during effective settings migration')
    await rename(pending, filename)
  }
  const result = { ...transformed.result, backup, originalSha256: hash(original), migratedSha256: hash(transformed.source) }
  await writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { flag: previous ? 'w' : 'wx', mode: 0o600 })
  return pickerDefaultsRecovery.changed ? { ...result, changed: true, pickerDefaultsRecovery } : result
}

/** Preserve the original conversation settings before selecting the new client owner. */
export function transformConversationPreferences(source, effectiveYaml, yaml) {
  const schema = schemaFor(yaml)
  const patch = yaml.load(source, { schema }) ?? []
  const rows = patchRows(patch)
  const effective = yaml.load(effectiveYaml, { schema })
  if (!Array.isArray(effective)) throw new Error('Effective profile must be an entry list')
  const originals = effective.filter(row => row.name === '@deepseek-ai/dsh-client-ui-conversation')
  const targets = effective.filter(row => row.id === 'modern-ui' && row.name === '@iroha1145/dsh-modern-ui')
  if (originals.length > 1 || targets.length !== 1) throw new Error('Conversation owner settings require one original and one Modern UI entry')
  const original = originals[0]?.config ?? {}
  const target = targets[0].config ?? {}
  for (const config of [original, target]) {
    if (!config || Array.isArray(config) || Object.getPrototypeOf(config) !== Object.prototype) {
      throw new Error('Computed conversation settings require explicit review; expressions were not evaluated')
    }
  }
  const additions = {}
  for (const key of ['busyEnter', 'collapsedViews']) {
    if (Object.hasOwn(target, key) || !Object.hasOwn(original, key)) continue
    const value = original[key]
    if (key === 'busyEnter' ? !['queue', 'steer'].includes(value)
      : !Array.isArray(value) || value.some(id => typeof id !== 'string')) {
      throw new Error(`Invalid original conversation preference: ${key}`)
    }
    additions[key] = value
  }
  const movedFields = Object.keys(additions)
  if (movedFields.length) {
    const modernRows = rows.filter(row => row.id === 'modern-ui')
    if (modernRows.length > 1) throw new Error('Layered Modern UI settings require explicit precedence review')
    const row = modernRows[0]
    if (row) {
      if (row.config !== undefined && (!row.config || Array.isArray(row.config) || Object.getPrototypeOf(row.config) !== Object.prototype)) {
        throw new Error('Computed Modern UI settings require explicit review')
      }
      for (const [key, value] of Object.entries(row.config ?? {})) {
        if (!Object.hasOwn(target, key) || !isDeepStrictEqual(target[key], value)) {
          throw new Error('Composed Modern UI settings do not match the staged profile; retry migration without concurrent edits')
        }
      }
      row.config = { ...target, ...additions }
    } else patch.push({ id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { ...target, ...additions } })
  }
  return { source: movedFields.length ? yaml.dump(patch, { schema, lineWidth: -1, noCompatMode: true }) : source,
    result: { changed: movedFields.length > 0, movedFields, conversionVersion: 1,
      namespace: 'modern-ui', retainedOriginalEntry: originals[0]?.id } }
}

/** This separate receipt also upgrades profiles that already migrated model settings. */
export async function preserveConversationPreferences(profile, effectiveYaml, yaml) {
  const filename = join(profile, 'cordis.patch.yml')
  const receiptPath = join(profile, 'modern-ui-conversation-migration.json')
  const backupName = 'modern-ui-conversation-before-migration.yml'
  let previous
  try { previous = JSON.parse(await readFile(receiptPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous) {
    if (previous.conversionVersion !== 1 || previous.backup !== backupName) throw new Error('Unsupported conversation migration receipt')
    if (hash(await readFile(join(profile, backupName), 'utf8')) !== previous.originalSha256) throw new Error('Conversation backup checksum mismatch')
    return { changed: false, movedFields: [], alreadyMigrated: true, namespace: 'modern-ui' }
  }
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Conversation migration requires a small regular staged profile patch')
  const original = await readFile(filename, 'utf8')
  const transformed = transformConversationPreferences(original, effectiveYaml, yaml)
  if (!transformed.result.changed) return transformed.result
  await writeFile(join(profile, backupName), original, { flag: 'wx', mode: 0o600 })
  const temporary = join(profile, 'modern-ui-conversation.pending.yml')
  await writeFile(temporary, transformed.source, { flag: 'wx', mode: 0o600 })
  if (await readFile(filename, 'utf8') !== original) throw new Error('Conversation settings changed during conversion')
  await rename(temporary, filename)
  const result = { ...transformed.result, backup: backupName,
    originalSha256: hash(original), migratedSha256: hash(transformed.source) }
  await writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return result
}

/** Move the patch-only folded-reply chat preference into the plugin's own settings row. */
/** Chat preferences Modern's own chat target reads from its namespace once the official ui-chat entry is disabled. */
const CHAT_PREFERENCE_FIELDS = ['transcriptView', 'collapseTiming', 'foldedReplies', 'performanceUsage', 'linkOpening']
const CHAT_PREFERENCE_VALUES = { foldedReplies: ['all', 'final'] }
const CHAT_CONVERSION_VERSION = 2

export function transformChatPreferences(source, yaml) {
  const schema = schemaFor(yaml)
  const patch = yaml.load(source, { schema }) ?? []
  const rows = patchRows(patch)
  const unique = id => {
    const found = rows.filter(row => row.id === id)
    if (found.length > 1) throw new Error(`Multiple ${id} rows require manual precedence review`)
    return found[0]
  }
  const chat = unique('ui-chat')
  const modern = unique('modern-ui')
  for (const row of [chat, modern].filter(Boolean)) {
    if (row.config !== undefined && (!row.config || Array.isArray(row.config) || Object.getPrototypeOf(row.config) !== Object.prototype)) {
      throw new Error(`Computed or non-object ${row.id} config requires manual review; it was not evaluated`)
    }
  }
  const unchanged = { source, result: { changed: false, movedFields: [], conversionVersion: CHAT_CONVERSION_VERSION, namespace: 'modern-ui' } }
  const movedFields = CHAT_PREFERENCE_FIELDS.filter(field => Object.hasOwn(chat?.config ?? {}, field) && !Object.hasOwn(modern?.config ?? {}, field))
  if (movedFields.length === 0) return unchanged
  const target = { ...modern?.config }
  for (const field of movedFields) {
    const value = chat.config[field]
    if (typeof value !== 'string') throw new Error(`Legacy ${field} must be a plain string; computed values were not evaluated`)
    const accepted = CHAT_PREFERENCE_VALUES[field]
    if (accepted && !accepted.includes(value)) throw new Error(`Legacy ${field} must be ${accepted.map(item => `"${item}"`).join(' or ')}; computed values were not evaluated`)
    target[field] = value
  }
  if (modern) modern.config = target
  else patch.push({ id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: target })
  // The ui-chat row keeps its values for the retained original profile; its entry is disabled by the bundle patch.
  return { source: yaml.dump(patch, { schema, lineWidth: -1, noCompatMode: true }), result: {
    changed: true, movedFields, conversionVersion: CHAT_CONVERSION_VERSION, namespace: 'modern-ui', retainedOriginalEntry: chat.id } }
}

/**
 * Separate receipt: profiles migrated before a preference had a home are upgraded once per
 * conversion version. Version 1 moved only foldedReplies; version 2 moves every official chat
 * preference Modern's own chat target reads, so a version-1 profile gets one more pass.
 */
export async function preserveChatPreferences(profile, yaml) {
  const filename = join(profile, 'cordis.patch.yml')
  const receiptPath = join(profile, 'modern-ui-chat-migration.json')
  const backupNames = { 1: 'modern-ui-chat-before-migration.yml', 2: 'modern-ui-chat-before-migration-v2.yml' }
  let previous
  try { previous = JSON.parse(await readFile(receiptPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous) {
    // A version-2 receipt may still point at the version-1 backup when that pass had nothing left to move.
    if (!(previous.conversionVersion in backupNames) || !Object.values(backupNames).includes(previous.backup)) throw new Error('Unsupported chat migration receipt')
    if (hash(await readFile(join(profile, previous.backup), 'utf8')) !== previous.originalSha256) throw new Error('Chat backup checksum mismatch')
    if (previous.conversionVersion === CHAT_CONVERSION_VERSION) return { changed: false, movedFields: [], alreadyMigrated: true, namespace: 'modern-ui' }
  }
  const info = await lstat(filename)
  if (!info.isFile()) throw new Error('Profile patch must be a regular file')
  const original = await readFile(filename, 'utf8')
  const transformed = transformChatPreferences(original, yaml)
  const backupName = backupNames[CHAT_CONVERSION_VERSION]
  if (!transformed.result.changed) {
    if (!previous) return transformed.result
    // Nothing left to move: record the current version against the earlier backup, which still verifies.
    const result = { ...transformed.result, backup: previous.backup, originalSha256: previous.originalSha256, migratedSha256: previous.migratedSha256, previousConversionVersion: previous.conversionVersion }
    await writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
    return result
  }
  await writeFile(join(profile, backupName), original, { flag: 'wx', mode: 0o600 })
  const temporary = join(profile, 'modern-ui-chat.pending.yml')
  await writeFile(temporary, transformed.source, { flag: 'wx', mode: 0o600 })
  if (await readFile(filename, 'utf8') !== original) throw new Error('Chat settings changed during conversion')
  await rename(temporary, filename)
  const result = { ...transformed.result, backup: backupName, originalSha256: hash(original), migratedSha256: hash(transformed.source),
    ...previous ? { previousConversionVersion: previous.conversionVersion } : {} }
  await writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  return result
}

/** Validate the packaged owner patch without changing a user's activation or configuration. */
export function validateUiOwnerBindings(bundleSource, effectiveSource, yaml) {
  const schema = schemaFor(yaml)
  const bundle = yaml.load(bundleSource, { schema })
  const effective = yaml.load(effectiveSource, { schema })
  if (!Array.isArray(bundle) || !Array.isArray(effective)) throw new Error('UI owner validation requires entry lists')
  const expected = bundle.filter(row => row?.disabled === true && typeof row.name === 'string'
    && row.name.startsWith('@deepseek-ai/dsh-client-ui-'))
  if (expected.length !== 7 || expected.some(row => typeof row.id !== 'string' || !row.id)
    || new Set(expected.map(row => row.id)).size !== expected.length || new Set(expected.map(row => row.name)).size !== expected.length) {
    throw new Error('Modern UI artifact must declare seven unique UI owner bindings')
  }
  const names = new Set(expected.map(row => row.name))
  const found = []
  const visit = (rows, nested, seen = new Set()) => {
    if (seen.has(rows)) throw new Error('Cyclic effective UI owner configuration')
    seen.add(rows)
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      if (names.has(row.name)) found.push({ row, nested })
      for (const children of [row.group ? row.config : undefined, row.config?.plugins, row.insert]) {
        if (Array.isArray(children)) visit(children, true, seen)
      }
    }
    seen.delete(rows)
  }
  visit(effective, false)
  return expected.map(({ id, name }) => {
    const matches = found.filter(item => item.row.name === name)
    if (matches.length !== 1 || matches[0].nested || matches[0].row.id !== id
      || ![undefined, null, false].includes(matches[0].row.group)
      || effective.filter(row => row?.id === id).length !== 1) {
      throw new Error(`UI owner ${name} requires one top-level entry with id ${id}; custom, nested, missing, or duplicate owners require explicit migration`)
    }
    const { disabled } = matches[0].row
    if (disabled !== undefined && disabled !== null && typeof disabled !== 'boolean') {
      throw new Error(`Computed activation of UI owner ${id} requires explicit migration`)
    }
    return { id, name, ...(disabled !== undefined ? { disabled } : {}) }
  })
}

function containsNestedHost(entry, seen = new Set()) {
  if (seen.has(entry)) throw new Error('Cyclic effective Host configuration')
  seen.add(entry)
  const children = [...(entry.group && Array.isArray(entry.config) ? entry.config : []),
    ...(Array.isArray(entry.config?.plugins) ? entry.config.plugins : [])]
  const found = children.some(child => child && typeof child === 'object' &&
    ((HOST_REPLACEMENTS[child.name] && child.disabled !== true) || containsNestedHost(child, seen)))
  seen.delete(entry)
  return found
}

/** Select replacement plugins with normal profile rows, never module interception. */
export function transformHostBindings(source, effectiveYaml, yaml) {
  const schema = schemaFor(yaml)
  const patch = yaml.load(source, { schema }) ?? []
  patchRows(patch)
  const effective = yaml.load(effectiveYaml, { schema })
  if (!Array.isArray(effective)) throw new Error('Effective Cordis configuration must be an entry list')
  const ids = new Set(effective.filter(entry => typeof entry.id === 'string').map(entry => entry.id))
  const replacements = []
  for (const entry of effective) {
    if (containsNestedHost(entry)) {
      throw new Error('Nested translator/MCP composition requires an explicit reviewed profile migration')
    }
    const replacement = HOST_REPLACEMENTS[entry.name]
    if (!replacement || entry.disabled === true) continue
    if (typeof entry.id !== 'string' || !entry.id) throw new Error('Host compatibility replacement requires a stable entry id')
    if (entry.disabled !== undefined && entry.disabled !== null && typeof entry.disabled !== 'boolean') throw new Error(`Computed activation of ${entry.id} requires manual compatibility review`)
    const id = `modern-ui-compat-${entry.id}`
    if (ids.has(id)) throw new Error(`Host replacement id is already in use: ${id}`)
    ids.add(id)
    patch.push({ id: entry.id, name: entry.name, disabled: true }, { insert: [{ ...entry, id, name: replacement }] })
    replacements.push({ fromId: entry.id, toId: id, plugin: replacement })
  }
  return { source: replacements.length ? yaml.dump(patch, { schema, lineWidth: -1, noCompatMode: true }) : source,
    result: { changed: replacements.length > 0, replacements } }
}

/** Apply only to a staged profile after its plugin package is installed. */
export async function bindHostCompatibility(profile, effectiveYaml, yaml) {
  const filename = join(profile, 'cordis.patch.yml')
  const metadata = await lstat(filename)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Staged profile patch must be a regular file')
  if (metadata.size > 1024 * 1024) throw new Error('Profile patch is too large for automatic Host composition')
  const original = await readFile(filename, 'utf8')
  const transformed = transformHostBindings(original, effectiveYaml, yaml)
  if (!transformed.result.changed) return transformed.result
  const backup = `modern-ui-host-before-${hash(original).slice(0, 16)}.yml`
  try { await writeFile(join(profile, backup), original, { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if (error.code !== 'EEXIST' || await readFile(join(profile, backup), 'utf8') !== original) throw error
  }
  const temporary = join(profile, 'modern-ui-host.pending.yml')
  await writeFile(temporary, transformed.source, { flag: 'wx', mode: 0o600 })
  if (await readFile(filename, 'utf8') !== original) throw new Error('Staged profile changed during Host composition')
  await rename(temporary, filename)
  return { ...transformed.result, backup, originalSha256: hash(original), migratedSha256: hash(transformed.source) }
}
