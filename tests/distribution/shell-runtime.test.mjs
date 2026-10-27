import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'
import { bindPowerShell } from '../../scripts/distribution/shell-runtime.mjs'
import { schemaFor } from '../../scripts/distribution/profile-settings.mjs'

test('private pwsh Config binding preserves sandbox activation and unrelated inert expressions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shell-binding-'))
  try {
    const original = '- id: unrelated\n  config:\n    value: !!js process.exit(99)\n'
    await writeFile(join(root, 'cordis.patch.yml'), original)
    const effective = '- id: pwsh-sandbox\n  name: "@deepseek-ai/dsh-pwsh-sandbox"\n  disabled: !!js process.platform !== "win32"\n  config:\n    timeoutMs: 4321\n'
    const pwsh = { path: 'C:\\private shell\\pwsh.exe' }
    const result = await bindPowerShell(root, effective, pwsh, yaml)
    assert.equal(result.changed, true)
    const text = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    assert.match(text, /!!js process.exit\(99\)/)
    const rows = yaml.load(text, { schema: schemaFor(yaml) })
    assert.deepEqual(rows[1], { id: 'pwsh-sandbox', name: '@deepseek-ai/dsh-pwsh-sandbox', config: { pwshPath: pwsh.path } })
    assert.equal(Object.hasOwn(rows[1], 'disabled'), false)
    assert.equal((await bindPowerShell(root, yaml.dump([{ id: 'pwsh-sandbox', name: '@deepseek-ai/dsh-pwsh-sandbox', config: { pwshPath: pwsh.path } }]), pwsh, yaml)).changed, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('explicit or computed user pwsh choices are never overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shell-choice-'))
  try {
    const original = '[]\n'
    await writeFile(join(root, 'cordis.patch.yml'), original)
    const pwsh = { path: 'C:\\private\\pwsh.exe' }
    await assert.rejects(bindPowerShell(root, yaml.dump([{ id: 'shell', name: '@deepseek-ai/dsh-pwsh-sandbox', config: { pwshPath: 'C:\\user\\pwsh.exe' } }]), pwsh, yaml), /not overwritten/)
    await assert.rejects(bindPowerShell(root, '- id: shell\n  name: "@deepseek-ai/dsh-pwsh-sandbox"\n  config: !!js process.exit(99)\n', pwsh, yaml), /manual review/)
    assert.equal(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), original)
  } finally { await rm(root, { recursive: true, force: true }) }
})
