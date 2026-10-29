// Frozen actual conversation writer from bb606b3058e7e4556d0bd259d82f1e1f4321e517.
// Extracted body SHA-256: 754666977f7b80fab3e1830fb0584bc948e11d5866911a0e7329acc4cebdd98c
import { createHash } from "node:crypto"
import { lstat, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
const hash = text => createHash("sha256").update(text).digest("hex")
// BEGIN FROZEN BODY
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

