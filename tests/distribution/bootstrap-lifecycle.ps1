param(
  [string]$Node,
  [string]$Installer = (Join-Path $PSScriptRoot '../../scripts/distribution')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('dsh-bootstrap-lifecycle-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
  Copy-Item -LiteralPath (Join-Path $Installer 'bootstrap.ps1') -Destination $fixture
  Copy-Item -LiteralPath (Join-Path $Installer 'filesystem-paths.ps1') -Destination $fixture
  $emptyHash = 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
  @{ nodeVersion = '24.22.1'; node = @{ 'win32-x64' = @{ url = 'https://example.invalid/node.zip'; integrity = $emptyHash; executable = 'node.ps1' } } } | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $fixture 'runtime-lock.json')
  function Invoke-WebRequest { param($Uri, $OutFile, [switch]$UseBasicParsing) [IO.File]::WriteAllBytes($OutFile, [byte[]]@()) }
  function Expand-Archive {
    param($LiteralPath, $DestinationPath)
    @'
if ($args[0] -eq '--version') { 'v24.22.1'; $global:LASTEXITCODE = 0; return }
$archiveIndex = [Array]::IndexOf($args, '--node-archive')
if ($archiveIndex -lt 0 -or -not (Test-Path -LiteralPath $args[$archiveIndex + 1])) { throw 'Downloaded archive was not handed to manager' }
$global:LASTEXITCODE = 0
'{}'
'@ | Set-Content (Join-Path $DestinationPath 'node.ps1')
  }
  $root = Join-Path $fixture 'program'
  & (Join-Path $fixture 'bootstrap.ps1') -Root $root -DataHome (Join-Path $fixture 'data') -Plugin (Join-Path $fixture 'plugin.tgz') -PluginIntegrity test -SkipCommunity | Out-Null
  if (Get-ChildItem -LiteralPath $root -Filter 'bootstrap-*') { throw 'Successful bootstrap leaked staging' }
  function Invoke-WebRequest { param($Uri, $OutFile, [switch]$UseBasicParsing) throw 'expected download failure' }
  $failed = $false
  try { & (Join-Path $fixture 'bootstrap.ps1') -Root $root -DataHome (Join-Path $fixture 'data') -Plugin (Join-Path $fixture 'plugin.tgz') -PluginIntegrity test -SkipCommunity | Out-Null }
  catch { $failed = $true; if ($_.ToString() -notmatch 'expected download failure') { throw } }
  if (-not $failed -or (Get-ChildItem -LiteralPath $root -Filter 'bootstrap-*')) { throw 'Failed bootstrap leaked staging or was accepted' }
  'process.exit(23)' | Set-Content (Join-Path $fixture 'manager.mjs')
  $failed = $false
  try { & (Join-Path $fixture 'bootstrap.ps1') -Root $root -DataHome (Join-Path $fixture 'data') -Plugin (Join-Path $fixture 'plugin.tgz') -PluginIntegrity test -Node $Node -SkipCommunity | Out-Null }
  catch { $failed = $true; if ($_.ToString() -notmatch 'Installation failed \(23\)') { throw } }
  if (-not $failed) { throw 'Failed core installation was accepted' }
  $global:LASTEXITCODE = 0
  'Bootstrap archive reuse, cleanup, and explicit Node failure checks passed'
} finally {
  $resolved = [IO.Path]::GetFullPath($fixture)
  if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()))) { throw 'Unexpected fixture cleanup path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
