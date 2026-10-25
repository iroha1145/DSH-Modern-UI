# Real Windows preparation smoke. Downloads only pinned public source/runtime archives.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("dsh-windows-prepare-" + [Guid]::NewGuid().ToString('N'))
$shell = (Get-Process -Id $PID).Path
$oldHome = $env:DSH_HOME
New-Item -ItemType Directory -Path $scratch | Out-Null
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Prepare([string[]]$InstallerArgs) {
  & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/install.ps1') @InstallerArgs -SkipPlugins -PrepareOnly
  Assert-True ($LASTEXITCODE -eq 0) 'The real Windows installer failed.'
}
try {
  $official = Join-Path $scratch 'official-data'
  New-Item -ItemType Directory -Path $official | Out-Null
  $sentinel = Join-Path $official 'original-session.jsonl'
  Set-Content -Path $sentinel -Value '{"fixture":"original"}'
  $originalHash = (Get-FileHash $sentinel).Hash
  $env:DSH_HOME = $official

  $isolated = Join-Path $scratch 'isolated install'
  Prepare -InstallerArgs @('-Dir', $isolated)
  $intent = Get-Content -Raw (Join-Path $isolated 'install.json') | ConvertFrom-Json
  Assert-True ($intent.home -eq (Join-Path $isolated 'data')) 'Fresh install reused the ambient official home.'
  Assert-True ((Get-FileHash $sentinel).Hash -eq $originalHash) 'The original data changed.'
  Assert-True (-not (Test-Path (Join-Path $isolated 'launch.json'))) 'Preparation activated an unfinished installation.'

  $custom = Join-Path $scratch 'custom install'
  $data = Join-Path $scratch 'research data'
  New-Item -ItemType Directory -Path $data | Out-Null
  $importedSession = Join-Path $data 'original-session.jsonl'
  Set-Content -Path $importedSession -Value '{"fixture":"imported-original"}'
  $importedHash = (Get-FileHash $importedSession).Hash
  Prepare -InstallerArgs @('-Dir', $custom, '-DshHome', $data, '-DshProfile', 'research')
  $backups = @(Get-ChildItem -Path (Join-Path $custom 'data-backups/*/data.tar.gz'))
  Assert-True ($backups.Count -eq 1) 'The existing data home was not backed up.'
  $restored = Join-Path $scratch 'restored backup'
  New-Item -ItemType Directory -Path $restored | Out-Null
  & tar -xzf ($backups[0].FullName) -C $restored
  Assert-True ($LASTEXITCODE -eq 0) 'The data backup could not be extracted.'
  Assert-True ((Get-FileHash (Join-Path $restored 'original-session.jsonl')).Hash -eq $importedHash) 'The data backup changed session bytes.'
  Assert-True ((Get-FileHash $importedSession).Hash -eq $importedHash) 'The imported original changed.'
  Prepare -InstallerArgs @('-Dir', $custom)
  $intent = Get-Content -Raw (Join-Path $custom 'install.json') | ConvertFrom-Json
  Assert-True ($intent.home -eq $data -and $intent.profile -eq 'research') 'Continuation lost the selected home/profile.'
  Remove-Item (Join-Path $custom 'runtime/node/npm.cmd')
  Prepare -InstallerArgs @('-Dir', $custom)
  Assert-True (Test-Path (Join-Path $custom 'runtime/node/npm.cmd')) 'A partial runtime did not recover.'
  $intent = Get-Content -Raw (Join-Path $custom 'install.json') | ConvertFrom-Json
  Assert-True ($intent.home -eq $data -and $intent.profile -eq 'research') 'Runtime recovery lost install intent.'
  # Capture arguments through the real launcher and private Node, with no application boot.
  Copy-Item (Join-Path $root 'scripts/launch.ps1') (Join-Path $custom 'dsh-ui.ps1')
  $intent | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $custom 'launch.json')
  $loader = Join-Path $custom 'dsh/node_modules/tsx/dist/esm'
  New-Item -ItemType Directory -Force -Path $loader | Out-Null
  Set-Content -Path (Join-Path $loader 'index.mjs') -Value 'export {};'
  Set-Content -Path (Join-Path $custom 'dsh/apps/cli/src/bin.ts') -Value 'console.log(JSON.stringify({args: process.argv.slice(2), home: process.env.DSH_HOME}));'
  foreach ($profile in @('research', 'web')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $data "profiles/$profile/node_modules/dsh-context") | Out-Null
  }
  $cases = @(
    @{ Arguments = @(); Expected = @('research') },
    @{ Arguments = @('web'); Expected = @('web') },
    @{ Arguments = @('--profile', 'web'); Expected = @('--profile', 'web') },
    @{ Arguments = @('--profile=web'); Expected = @('--profile=web') },
    @{ Arguments = @('plugin', 'list'); Expected = @('plugin', 'list') },
    @{ Arguments = @('web', '--dump-config'); Expected = @('web', '--dump-config') },
    @{ Arguments = @('web', '--dump-default-config'); Expected = @('web', '--dump-default-config') }
  )
  foreach ($case in $cases) {
    $forward = $case.Arguments
    $captured = & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $custom 'dsh-ui.ps1') @forward
    Assert-True ($LASTEXITCODE -eq 0) 'The real Windows launcher failed.'
    $captured = $captured | ConvertFrom-Json
    Assert-True (($captured.args | ConvertTo-Json -Compress) -eq ($case.Expected | ConvertTo-Json -Compress)) 'The launcher changed CLI arguments.'
    Assert-True ($captured.home -eq $data) 'The launcher changed the selected data home.'
  }
  Write-Host 'Windows preparation: isolation, data backup, resume, partial-runtime recovery and CLI forwarding passed.'
} finally {
  if ($null -eq $oldHome) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue } else { $env:DSH_HOME = $oldHome }
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
