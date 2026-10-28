// Package already-built plugin assets with the thin, source-free consumer installer.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { officialSource, versions } from './distribution/manager.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
assert.equal(process.version, 'v24.22.1', 'Build previews with the pinned Node runtime')
const output = path.resolve(process.argv[2] ?? path.join(root, '.artifacts/plugin-preview'))
await mkdir(output, { recursive: true })
const npm = path.join(path.dirname(process.execPath), process.platform === 'win32'
  ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', './packages/modern-ui', '--ignore-scripts', '--json', '--cache', path.join(root, '.artifacts/npm-cache'), '--pack-destination', output],
  { cwd: root, encoding: 'utf8', windowsHide: true }))[0]
const bytes = await readFile(path.join(output, packed.filename))
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
assert.equal(integrity, packed.integrity)
await rename(path.join(output, packed.filename), path.join(output, 'modern-ui.tgz'))
await cp(path.join(root, 'scripts/distribution'), path.join(output, 'installer'), { recursive: true })
await cp(path.join(root, 'docs'), path.join(output, 'docs'), { recursive: true })
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'))
await cp(path.join(root, 'scripts/preview-consumer-check.mjs'), path.join(output, 'consumer-check.mjs'))
const runtimes = JSON.parse(await readFile(path.join(output, 'installer/runtime-lock.json'), 'utf8'))
const communities = JSON.parse(await readFile(path.join(output, 'installer/community-lock.json'), 'utf8'))
const manifest = {
  schemaVersion: 1, status: 'local-preview-unpublished',
  acceptanceRecord: 'docs/plugin-migration.md',
  compatibilityScope: 'Pinned host and runtime; platform acceptance is recorded by the matching source revision consumer CI',
  plugin: { name: packed.name, version: packed.version, filename: 'modern-ui.tgz', integrity, bytes: bytes.length },
  backend: officialSource,
  node: versions.node, pnpm: versions.pnpm,
  runtimeSources: runtimes, communityPlugins: communities.plugins,
  decision: 'Modern UI session web controls removed; official plugin configuration remains authoritative',
  limitations: ['Only targets with passing consumer jobs for the source revision are verified', 'Real touchscreen, WebKit and Electron multi-window execution unverified', 'Legacy web/search snapshots require the retained legacy environment or read-only export', 'Root owner bundle changes require a browser refresh', 'Profiles with explicit Host compatibility bindings retain the package until those bindings are restored'],
}
await writeFile(path.join(output, 'preview.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(path.join(output, 'install.ps1'), `param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$DataHome,
  [string]$Backend,
  [string]$Node,
  [switch]$SkipCommunity
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'installer/bootstrap.ps1') -Root $Root -DataHome $DataHome -Plugin (Join-Path $PSScriptRoot 'modern-ui.tgz') -PluginIntegrity '${integrity}' -Backend $Backend -Node $Node -SkipCommunity:$SkipCommunity
`)
await writeFile(path.join(output, 'install-existing.ps1'), `param(
  [Parameter(Mandatory=$true)][string]$Backend,
  [string]$Root,
  [string]$DataHome,
  [string]$Node,
  [switch]$SkipCommunity
)
$ErrorActionPreference = 'Stop'
$installerArguments = @{} + $PSBoundParameters
$installerArguments.Plugin = Join-Path $PSScriptRoot 'modern-ui.tgz'
$installerArguments.PluginIntegrity = '${integrity}'
& (Join-Path $PSScriptRoot 'installer/install-existing.ps1') @installerArguments
`)
await writeFile(path.join(output, 'install-existing.mjs'), `import { fileURLToPath } from 'node:url'
import { installExisting } from './installer/install-existing.mjs'
await installExisting(['--plugin', fileURLToPath(new URL('./modern-ui.tgz', import.meta.url)),
  '--plugin-integrity', '${integrity}', ...process.argv.slice(2)])
`)
await writeFile(path.join(output, 'install-existing.sh'), `#!/bin/sh
set -eu
if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then echo 'usage: install-existing.sh OFFICIAL_PACKAGE_JSON [PROGRAM_ROOT] [DATA_HOME]' >&2; exit 2; fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
backend=$1
shift
exec sh "$here/installer/install-existing.sh" "$backend" "$here/modern-ui.tgz" '${integrity}' "$@"
`, { mode: 0o755 })
await writeFile(path.join(output, 'install.sh'), `#!/bin/sh
set -eu
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then echo 'usage: install.sh PROGRAM_ROOT DATA_HOME [EXISTING_OFFICIAL_PACKAGE_JSON]' >&2; exit 2; fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -eq 3 ]; then
  exec sh "$here/installer/bootstrap.sh" "$1" "$2" "$here/modern-ui.tgz" '${integrity}' "$3"
fi
exec sh "$here/installer/bootstrap.sh" "$1" "$2" "$here/modern-ui.tgz" '${integrity}'
`, { mode: 0o755 })
await writeFile(path.join(output, 'README.txt'), `DSH Modern UI - precompiled plugin preview (unpublished)

This directory contains the actual precompiled Modern UI tgz and a thin installer.
There is no published npm/Release URL for this preview. Preserve legacy web/search sessions for the old environment or read-only export.
The custom Modern UI session web switch is retired. New sessions use official plugin configuration.

Windows x64, from PowerShell (replace the two target paths):
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH Modern/program' -DataHome 'D:/DSH Modern/data'

Existing compatible official DSH with Node 24.22.1 (private program/data defaults, or pass --root and --home):
  node ./install-existing.mjs --backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json'
Or the PowerShell entry:
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install-existing.ps1 -Backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json'

The PowerShell execution-policy argument applies only to this process, not system settings.

POSIX targets (check the consumer CI for this source revision):
  sh ./install.sh '/path/to/program' '/path/to/data'

The installer downloads verified official Node, pnpm and DSH release assets; it does not compile source.
Windows also uses the pinned private Microsoft PowerShell 7 release listed in preview.json.
Core and community-plugin outcomes are separate. Use -SkipCommunity (PowerShell) or
DSH_MODERN_SKIP_COMMUNITY=1 (POSIX) to run only the core path.
The two directories must be separate. User data and other profiles are retained.
Launch the generated program/dsh-ui.cmd (Windows) or program/dsh-ui (POSIX).

preview.json records exact versions and integrity.
Compatibility scope and remaining differences are documented in docs/plugin-migration.md.
`)
console.log(JSON.stringify({ output, ...manifest }, null, 2))
