param(
  [Parameter(Mandatory=$true)][string]$Backend,
  [Parameter(Mandatory=$true)][string]$Plugin,
  [string]$PluginIntegrity,
  [string]$Root = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DSH-Modern-UI/program'),
  [string]$DataHome,
  [string]$Node,
  [switch]$SkipCommunity
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'filesystem-paths.ps1')
$Root = Resolve-DshFileSystemPath $Root
$Backend = Resolve-DshFileSystemPath $Backend
$Plugin = Resolve-DshFileSystemPath $Plugin
if (-not $DataHome) {
  $selection = Join-Path $Root 'current.json'
  if (Test-Path -LiteralPath $selection) { $DataHome = (Get-Content -Raw -Encoding UTF8 -LiteralPath $selection | ConvertFrom-Json).home }
  else { $DataHome = Join-Path (Split-Path -Parent $Root) ('data-' + [Guid]::NewGuid().ToString()) }
}
if (-not $PluginIntegrity) {
  $hasher = [Security.Cryptography.SHA512]::Create()
  try { $PluginIntegrity = 'sha512-' + [Convert]::ToBase64String($hasher.ComputeHash([IO.File]::ReadAllBytes($Plugin))) } finally { $hasher.Dispose() }
}
if (-not $Node) {
  $candidate = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  $lock = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.json') | ConvertFrom-Json
  if ($candidate -and ((& $candidate.Source --version) -eq ('v' + $lock.nodeVersion))) { $Node = $candidate.Source }
}
& (Join-Path $PSScriptRoot 'bootstrap.ps1') -Root $Root -DataHome $DataHome -Plugin $Plugin -PluginIntegrity $PluginIntegrity -Backend $Backend -Node $Node -SkipCommunity:$SkipCommunity
