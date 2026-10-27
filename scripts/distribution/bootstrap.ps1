param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$DataHome,
  [Parameter(Mandatory=$true)][string]$Plugin,
  [Parameter(Mandatory=$true)][string]$PluginIntegrity,
  [string]$Backend,
  [string]$Node,
  [switch]$SkipCommunity
)
$ErrorActionPreference = 'Stop'
$installStarted = [DateTimeOffset]::UtcNow.ToString('o')
$installTimer = [Diagnostics.Stopwatch]::StartNew()
. (Join-Path $PSScriptRoot 'filesystem-paths.ps1')
$Root = Resolve-DshFileSystemPath $Root
$DataHome = Resolve-DshFileSystemPath $DataHome
$Plugin = Resolve-DshFileSystemPath $Plugin
if ($Backend) { $Backend = Resolve-DshFileSystemPath $Backend }
if ($Node) { $Node = Resolve-DshFileSystemPath $Node }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Only Windows x64 is a candidate target; arm64 has not been accepted.' }
$runtimeLock = Join-Path $PSScriptRoot 'runtime-lock.json'
$runtime = Get-Content -Raw -LiteralPath $runtimeLock | ConvertFrom-Json
$artifact = $runtime.node.'win32-x64'
$cacheConditions = @{ releaseCacheDirectoryExisted = (Test-Path -LiteralPath (Join-Path $Root 'release-cache')); pnpmStoreDirectoryExisted = (Test-Path -LiteralPath (Join-Path $Root 'store')); nodeDownloaded = (-not [bool]$Node) }
$bootstrap = $null
try {
  $managerArgs = @((Join-Path $PSScriptRoot 'manager.mjs'), 'install', '--root', $Root, '--home', $DataHome, '--plugin', $Plugin, '--plugin-integrity', $PluginIntegrity)
  if ($Node) {
    if ((& $Node --version) -ne ('v' + $runtime.nodeVersion)) { throw 'Existing Node does not match the pinned version.' }
    $node = $Node
    $managerArgs += @('--node', $Node)
  } else {
    $bootstrap = Join-Path $Root ('bootstrap-' + [Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Force -Path $bootstrap | Out-Null
    $archive = Join-Path $bootstrap 'node.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $artifact.url -OutFile $archive
    $expected = $artifact.integrity.Substring('sha256-'.Length)
    $stream = [IO.File]::OpenRead($archive)
    try {
      $hasher = [Security.Cryptography.SHA256]::Create()
      try { $actual = [Convert]::ToBase64String($hasher.ComputeHash($stream)) } finally { $hasher.Dispose() }
    } finally { $stream.Dispose() }
    if ($actual -ne $expected) { throw 'Private Node download integrity mismatch; previous installation retained.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $bootstrap
    $node = Join-Path $bootstrap $artifact.executable
    $managerArgs += @('--runtime-lock', $runtimeLock, '--node-archive', $archive)
  }
  if ($Backend) { $managerArgs += @('--backend', $Backend) }
  $coreOutput = & $node @managerArgs
  $coreExit = $LASTEXITCODE
  if ($coreExit -ne 0) {
    @{ phase = 'core'; result = @{ state = 'failed'; exitCode = $coreExit } } | ConvertTo-Json -Depth 10
    throw "Installation failed ($coreExit); previous entry retained. See the core error above."
  }
  $coreElapsedMs = $installTimer.ElapsedMilliseconds
  @{ phase = 'core'; result = (($coreOutput -join "`n") | ConvertFrom-Json) } | ConvertTo-Json -Depth 20
  if ($SkipCommunity) {
    @{ phase = 'community'; result = @{ state = 'skipped' } } | ConvertTo-Json -Depth 10
  } else {
    try {
      $communityOutput = & $node (Join-Path $PSScriptRoot 'manager.mjs') community --root $Root
      $communityExit = $LASTEXITCODE
      if ($communityExit -ne 0) { throw "Community operation failed ($communityExit)" }
      @{ phase = 'community'; result = (($communityOutput -join "`n") | ConvertFrom-Json) } | ConvertTo-Json -Depth 20
    } catch {
      @{ phase = 'community'; result = @{ state = 'failed'; coreRetained = $true; retry = 'community --root <program-root>' } } | ConvertTo-Json -Depth 10
    }
  }
  $installTimer.Stop()
  @{ phase = 'timing'; result = @{ startedAt = $installStarted; completedAt = [DateTimeOffset]::UtcNow.ToString('o'); coreElapsedMs = $coreElapsedMs; elapsedMs = $installTimer.ElapsedMilliseconds; backend = $(if ($Backend) { 'existing' } else { 'downloaded official npm release' }); cacheConditions = $cacheConditions; platform = 'win32-x64' } } | ConvertTo-Json -Depth 10

} finally {
  if ($bootstrap -and (Test-Path -LiteralPath $bootstrap)) {
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $resolvedBootstrap = [IO.Path]::GetFullPath($bootstrap)
    if (-not $resolvedBootstrap.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Bootstrap cleanup escaped program root' }
    Remove-Item -LiteralPath $resolvedBootstrap -Recurse -Force
  }
}
