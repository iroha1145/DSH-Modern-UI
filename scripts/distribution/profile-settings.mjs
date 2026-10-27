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
  const unchanged = { source, result: { changed: false, movedFields: [], conversionVersion: 1, namespace: 'modern-ui' } }
  if (!Object.hasOwn(chat?.config ?? {}, 'foldedReplies') || Object.hasOwn(modern?.config ?? {}, 'foldedReplies')) return unchanged
  const value = chat.config.foldedReplies
  if (value !== 'all' && value !== 'final') throw new Error('Legacy foldedReplies must be "all" or "final"; computed values were not evaluated')
  const target = { ...modern?.config, foldedReplies: value }
  if (modern) modern.config = target
  else patch.push({ id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: target })
  // The ui-chat row keeps its value for the retained original profile; the official schema ignores it.
  return { source: yaml.dump(patch, { schema, lineWidth: -1, noCompatMode: true }), result: {
    changed: true, movedFields: ['foldedReplies'], conversionVersion: 1, namespace: 'modern-ui', retainedOriginalEntry: chat.id } }
}

/** Separate receipt: profiles migrated before this preference had a home are upgraded once. */
export async function preserveChatPreferences(profile, yaml) {
  const filename = join(profile, 'cordis.patch.yml')
  const receiptPath = join(profile, 'modern-ui-chat-migration.json')
  const backupName = 'modern-ui-chat-before-migration.yml'
  let previous
  try { previous = JSON.parse(await readFile(receiptPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous) {
    if (previous.conversionVersion !== 1 || previous.backup !== backupName) throw new Error('Unsupported chat migration receipt')
    if (hash(await readFile(join(profile, backupName), 'utf8')) !== previous.originalSha256) throw new Error('Chat backup checksum mismatch')
    return { changed: false, movedFields: [], alreadyMigrated: true, namespace: 'modern-ui' }
  }
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Chat migration requires a small regular staged profile patch')
  const original = await readFile(filename, 'utf8')
  const transformed = transformChatPreferences(original, yaml)
  if (!transformed.result.changed) return transformed.result
  await writeFile(join(profile, backupName), original, { flag: 'wx', mode: 0o600 })
  const temporary = join(profile, 'modern-ui-chat.pending.yml')
  await writeFile(temporary, transformed.source, { flag: 'wx', mode: 0o600 })
  if (await readFile(filename, 'utf8') !== original) throw new Error('Chat settings changed during conversion')
  await rename(temporary, filename)
  const result = { ...transformed.result, backup: backupName, originalSha256: hash(original), migratedSha256: hash(transformed.source) }
  await writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return result
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
    if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') throw new Error(`Computed activation of ${entry.id} requires manual compatibility review`)
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
