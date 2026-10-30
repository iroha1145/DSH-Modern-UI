import { readFile, writeFile, rename, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isMainModule } from './entrypoint.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function validateReceipt(root, generation, receipt) {
  if (typeof generation !== 'string' || typeof receipt !== 'string') throw new Error('Invalid installation receipt reference')
  const expected = join(generation, 'installation.json')
  if (relative(expected, receipt) !== '') throw new Error('Receipt must belong to the referenced generation')
  const path = relative(await realpath(root), await realpath(generation)).split(sep)
  if (path.length !== 2 || path[0] !== 'versions' || !path[1] || path[1] === '..')
    throw new Error('Recovery generation must be inside the managed versions directory')
  if (relative(await realpath(generation), await realpath(receipt)) !== 'installation.json') throw new Error('Recovery receipt escaped its generation')
}
export async function receiptReference(state) {
  const receipt = join(state.generation, 'installation.json')
  await validateReceipt(state.root, state.generation, receipt)
  const bytes = await readFile(receipt)
  const stored = JSON.parse(bytes)
  if (stored.generation !== state.generation || stored.home !== state.home || stored.profile !== state.profile)
    throw new Error('Installation receipt does not match the selected generation')
  return { generation: state.generation, receipt, sha256: digest(bytes) }
}
export async function previousState(previous, root) {
  if (!previous?.receipt) return previous // Legacy releases embedded the complete previous state.
  await validateReceipt(root, previous.generation, previous.receipt)
  const bytes = await readFile(previous.receipt)
  if (digest(bytes) !== previous.sha256) throw new Error('Installation recovery receipt changed')
  const state = JSON.parse(bytes)
  if (state.generation !== previous.generation) throw new Error('Installation recovery generation mismatch')
  if (relative(await realpath(root), await realpath(state.root)) !== '') throw new Error('Installation recovery root mismatch')
  return state
}
export async function readSelection(root, { recovery = true } = {}) {
  try {
    return JSON.parse(await readFile(join(root, 'current.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!recovery) return undefined
  let retained
  try {
    retained = JSON.parse(await readFile(join(root, 'recovery.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  if (retained.format !== 1 || !retained.selection?.receipt) throw new Error('Invalid installation recovery receipt')
  const state = await previousState(retained.selection, root)
  if (state.home !== retained.home || state.profile !== retained.profile) throw new Error('Recovery data/profile does not match the installation receipt')
  return state
}
export async function retainSelection(root, state) {
  const retained = { format: 1, home: state.home, profile: state.profile, selection: await receiptReference(state) }
  const temporary = join(root, `recovery-${randomUUID()}.json`)
  await writeFile(temporary, JSON.stringify(retained, null, 2) + '\n')
  await rename(temporary, join(root, 'recovery.json'))
  return retained
}
if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2])
  readSelection(root)
    .then(state => console.log(state?.home ?? join(dirname(root), `data-${randomUUID()}`)))
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
