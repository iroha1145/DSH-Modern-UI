// Package already-built plugin assets with the thin, source-free consumer installer.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { officialSource, versions } from './distribution/manager.mjs'
import { hostRange, supportedHostVersions, getHostCompatibility } from './distribution/compatibility.mjs'

const userDocuments = ['install.md', 'compatibility.md', 'compatibility', 'architecture.md', 'data-migration.md', 'host-compat.md']
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
assert.equal(process.version.split('.')[0], `v${versions.node.split('.')[0]}`, 'Build previews with the declared Node major version')
for (const filename of ['build-inputs.json', 'host-build-inputs.json']) {
  const built = JSON.parse(await readFile(path.join(root, 'packages/modern-ui/lib', filename), 'utf8'))
  assert.deepEqual(built.compatibleHosts, supportedHostVersions, 'Rebuild the plugin after changing the compatibility manifest')
}
const output = path.resolve(process.argv[2] ?? path.join(root, '.artifacts/plugin-preview'))
await mkdir(output, { recursive: true })
const npm = path.join(
  path.dirname(process.execPath),
  process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js',
)
const packed = JSON.parse(
  execFileSync(
    process.execPath,
    [npm, 'pack', './packages/modern-ui', '--ignore-scripts', '--json', '--cache', path.join(root, '.artifacts/npm-cache'), '--pack-destination', output],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  ),
)[0]
const bytes = await readFile(path.join(output, packed.filename))
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
assert.equal(integrity, packed.integrity)
await rename(path.join(output, packed.filename), path.join(output, 'modern-ui.tgz'))
await cp(path.join(root, 'scripts/distribution'), path.join(output, 'installer'), { recursive: true })
// Ship only the user-facing documents; audit history stays in the repository.
for (const document of userDocuments) await cp(path.join(root, 'docs', document), path.join(output, 'docs', document), { recursive: true })
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'))
await cp(path.join(root, 'scripts/preview-consumer-check.mjs'), path.join(output, 'consumer-check.mjs'))
const runtimes = JSON.parse(await readFile(path.join(output, 'installer/runtime-lock.json'), 'utf8'))
const communities = JSON.parse(await readFile(path.join(output, 'installer/community-lock.json'), 'utf8'))
const manifest = {
  schemaVersion: 1,
  status: process.env.MODERN_UI_RELEASE ? 'released' : 'local-preview-unpublished',
  acceptanceRecord: 'docs/compatibility.md',
  compatibilityScope: 'Host range with an exact verified list; feature and platform acceptance is recorded separately by test:compat',
  hostRange,
  plugin: { name: packed.name, version: packed.version, filename: 'modern-ui.tgz', integrity, bytes: bytes.length },
  backend: officialSource,
  compatibleHosts: supportedHostVersions,
  backends: Object.fromEntries(supportedHostVersions.map(version => [version, getHostCompatibility(version)])),
  node: versions.node,
  pnpm: versions.pnpm,
  runtimeSources: runtimes,
  communityPlugins: communities.plugins,
  decision: 'Modern UI session web controls removed; official plugin configuration remains authoritative',
  limitations: [
    'Only targets with passing consumer jobs for the source revision are verified',
    'Real touchscreen, WebKit and Electron multi-window execution unverified',
    'Legacy web/search snapshots require the retained legacy environment or read-only export',
    'Root owner bundle changes require a browser refresh',
    'Profiles with explicit Host compatibility bindings retain the package until those bindings are restored',
  ],
}
await writeFile(path.join(output, 'preview.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(
  path.join(output, 'install.ps1'),
  `param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$DataHome,
  [string]$Backend,
  [string]$BackendVersion,
  [string]$FromProfile,
  [string]$Node,
  [switch]$SkipCommunity,
  [switch]$WithCommunity
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'installer/bootstrap.ps1') -Root $Root -DataHome $DataHome -Plugin (Join-Path $PSScriptRoot 'modern-ui.tgz') -PluginIntegrity '${integrity}' -Backend $Backend -BackendVersion $BackendVersion -FromProfile $FromProfile -Node $Node -SkipCommunity:$SkipCommunity -WithCommunity:$WithCommunity
`,
)
await writeFile(
  path.join(output, 'install-existing.ps1'),
  `param(
  [Parameter(Mandatory=$true)][string]$Backend,
  [string]$Root,
  [string]$DataHome,
  [string]$Node,
  [string]$FromProfile,
  [switch]$SkipCommunity,
  [switch]$WithCommunity
)
$ErrorActionPreference = 'Stop'
$installerArguments = @{} + $PSBoundParameters
$installerArguments.Plugin = Join-Path $PSScriptRoot 'modern-ui.tgz'
$installerArguments.PluginIntegrity = '${integrity}'
& (Join-Path $PSScriptRoot 'installer/install-existing.ps1') @installerArguments
`,
)
await writeFile(
  path.join(output, 'install-existing.mjs'),
  `import { fileURLToPath } from 'node:url'
import { installExisting } from './installer/install-existing.mjs'
await installExisting(['--plugin', fileURLToPath(new URL('./modern-ui.tgz', import.meta.url)),
  '--plugin-integrity', '${integrity}', ...process.argv.slice(2)])
`,
)
await writeFile(
  path.join(output, 'install-existing.sh'),
  `#!/bin/sh
set -eu
if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then echo 'usage: install-existing.sh OFFICIAL_PACKAGE_JSON [PROGRAM_ROOT] [DATA_HOME]' >&2; exit 2; fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
backend=$1
shift
exec sh "$here/installer/install-existing.sh" "$backend" "$here/modern-ui.tgz" '${integrity}' "$@"
`,
  { mode: 0o755 },
)
await writeFile(
  path.join(output, 'install.sh'),
  `#!/bin/sh
set -eu
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then echo 'usage: install.sh PROGRAM_ROOT DATA_HOME [EXISTING_OFFICIAL_PACKAGE_JSON]' >&2; exit 2; fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -eq 3 ]; then
  exec sh "$here/installer/bootstrap.sh" "$1" "$2" "$here/modern-ui.tgz" '${integrity}' "$3"
fi
exec sh "$here/installer/bootstrap.sh" "$1" "$2" "$here/modern-ui.tgz" '${integrity}'
`,
  { mode: 0o755 },
)
await writeFile(
  path.join(output, 'README.txt'),
  `DSH Modern UI - precompiled plugin preview (unpublished)

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
Core and community-plugin outcomes are separate. Community plugins are not installed by default;
use -WithCommunity (PowerShell) or DSH_MODERN_WITH_COMMUNITY=1 (POSIX) to add the verified
combination listed in preview.json.
The two directories must be separate. User data and other profiles are retained.
Launch the generated program/dsh-ui.cmd (Windows) or program/dsh-ui (POSIX).

preview.json records exact versions and integrity.
Compatibility scope and remaining differences are documented in docs/compatibility.md.
`,
)
console.log(JSON.stringify({ output, ...manifest }, null, 2))
