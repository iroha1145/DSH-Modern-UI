// Frozen bindPowerShell from a3da03fc9871208ec444e87d7117a5869324122f (also unchanged at bb606b3).
// Full shell-runtime.mjs SHA-256: 70c21d5638541876d943b45207adbe7371e668c902a42a140c0110da4f945c12
// Frozen function source SHA-256: 51af9876d83f90af6cebff086f5145e0171e5580956edec87ba37a8de628c1dd
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schemaFor } from './profile-settings-bb606b3.mjs'
// BEGIN FROZEN FUNCTION
export async function bindPowerShell(profile, effectiveYaml, powershell, yaml) {
  if (!powershell) return { changed: false, executors: [] }
  const schema = schemaFor(yaml)
  const effective = yaml.load(effectiveYaml, { schema })
  if (!Array.isArray(effective)) throw new Error('Effective profile is not an entry list')
  const names = new Set(['@deepseek-ai/dsh-pwsh-local', '@deepseek-ai/dsh-pwsh-sandbox'])
  const rows = effective.filter(entry => names.has(entry.name) && entry.disabled !== true)
  if (!rows.length) throw new Error('Windows profile has no supported top-level PowerShell executor')
  const additions = []
  for (const row of rows) {
    if (!row.id || typeof row.id !== 'string') throw new Error('PowerShell executor requires a stable profile id')
    if (row.config !== undefined && (!row.config || Array.isArray(row.config) || Object.getPrototypeOf(row.config) !== Object.prototype)) throw new Error(`Computed executor configuration for ${row.id} requires manual review`)
    const configured = row.config?.pwshPath
    if (configured !== undefined && configured !== '' && configured !== powershell.path) throw new Error(`Executor ${row.id} pins another PowerShell path; source configuration was not overwritten`)
    // Official entry patches replace config as a whole, so retain the effective executor settings.
    if (configured !== powershell.path) additions.push({ id: row.id, name: row.name, config: { ...row.config, pwshPath: powershell.path } })
  }
  if (additions.length) {
    const path = join(profile, 'cordis.patch.yml')
    const original = await readFile(path, 'utf8')
    const patch = yaml.load(original, { schema }) ?? []
    if (!Array.isArray(patch)) throw new Error('Profile patch is not an entry list')
    await writeFile(path, yaml.dump([...patch, ...additions], { schema, lineWidth: -1, noCompatMode: true }))
  }
  return { changed: additions.length > 0, executors: rows.map(row => ({ id: row.id, module: row.name })), path: powershell.path }
}
