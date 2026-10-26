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
# Load only the production rename/switch helpers; do not run the installer at test import.
$parseErrors = $null
$tokens = $null
$installerAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts/install.ps1'), [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) 'The installer has PowerShell syntax errors.'
$helpers = $installerAst.FindAll({ param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -in @('Move-RuntimeDirectory', 'Switch-RuntimeDirectory') }, $true)
Assert-True ($helpers.Count -eq 2) 'Expected the production runtime switch helpers.'
foreach ($helper in $helpers) { . ([scriptblock]::Create($helper.Extent.Text)) }
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
public static class DshRuntimeDirectoryLockFixture {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  public static SafeFileHandle Open(string path) {
    // GENERIC_READ participates in sharing checks; attribute-only access does not.
    // Allow readers/writers but omit FILE_SHARE_DELETE, which also protects rename.
    SafeFileHandle handle = CreateFile(path, 0x80000000, 3, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle.IsInvalid) { int code = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(code); }
    return handle;
  }
  public static void ReleaseAfter(SafeFileHandle handle, int milliseconds) {
    // A task handshake owns no caller-managed wait handle that a late starter could touch.
    TaskCompletionSource<bool> started = new TaskCompletionSource<bool>();
    Thread worker = new Thread(delegate() {
      System.Diagnostics.Stopwatch countdown = System.Diagnostics.Stopwatch.StartNew();
      started.SetResult(true);
      int remaining = milliseconds - (int)countdown.ElapsedMilliseconds;
      if (remaining > 0) Thread.Sleep(remaining);
      handle.Dispose();
    });
    worker.IsBackground = true;
    worker.Start();
    if (!started.Task.Wait(5000)) {
      throw new TimeoutException("Runtime lock release thread did not start within five seconds.");
    }
  }
}
'@
function Get-RuntimeFailureEvidence($Failure) {
  if ($null -eq $Failure) { return @{ outcome = 'success'; exceptions = @() } }
  $chain = @()
  $exception = $Failure.Exception
  while ($null -ne $exception) {
    $chain += @{ type = $exception.GetType().FullName; message = $exception.Message; hresult = $exception.HResult.ToString('X8'); win32Code = ($exception.HResult -band 0xffff) }
    $exception = $exception.InnerException
  }
  return @{ outcome = 'failure'; record = $Failure.ToString(); errorId = $Failure.FullyQualifiedErrorId; category = $Failure.CategoryInfo.ToString(); scriptStack = $Failure.ScriptStackTrace; exceptions = $chain }
}
function Write-RuntimeSwitchEvidence([string]$Phase, [bool]$Temporary, $Failure, $Handle, [long]$ElapsedMs, [string[]]$Paths) {
  $directories = @()
  foreach ($path in $Paths) {
    $file = Join-Path $path 'node.exe'
    $hash = $null
    if (Test-Path -LiteralPath $file) {
      try { $hash = (Get-FileHash -LiteralPath $file).Hash } catch { $hash = "unreadable: $($_.Exception.Message)" }
    }
    $directories += @{ path = $path; exists = (Test-Path -LiteralPath $path); nodeExists = (Test-Path -LiteralPath $file); sha256 = $hash }
  }
  $evidence = @{ phase = $Phase; temporary = $Temporary; elapsedMs = $ElapsedMs; handleClosed = $Handle.IsClosed; handleInvalid = $Handle.IsInvalid; powershell = $PSVersionTable.PSVersion.ToString(); failure = (Get-RuntimeFailureEvidence $Failure); directories = $directories }
  Write-Host ('Runtime switch fixture evidence: ' + ($evidence | ConvertTo-Json -Depth 8 -Compress))
}
function Test-RuntimeDirectoryLocks {
  foreach ($temporary in @($true, $false)) {
    $fixture = Join-Path $scratch ("runtime-lock-" + [Guid]::NewGuid().ToString('N'))
    $current = Join-Path $fixture 'node'
    $candidate = Join-Path $fixture 'candidate'
    $previous = Join-Path $fixture 'node.previous'
    New-Item -ItemType Directory -Path $current, $candidate | Out-Null
    Set-Content -Path (Join-Path $current 'node.exe') -Value 'previous-runtime'
    Set-Content -Path (Join-Path $candidate 'node.exe') -Value 'validated-candidate'
    $oldHash = (Get-FileHash (Join-Path $current 'node.exe')).Hash
    $newHash = (Get-FileHash (Join-Path $candidate 'node.exe')).Hash
    $handle = [DshRuntimeDirectoryLockFixture]::Open($candidate)
    try {
      # Observe the actual Windows lock semantics before scheduling any release.
      $probeTarget = Join-Path $fixture 'probe-target'
      $probeFailure = $null
      try { [IO.Directory]::Move($candidate, $probeTarget) } catch { $probeFailure = $_ }
      Write-RuntimeSwitchEvidence 'locked-rename-probe' $temporary $probeFailure $handle 0 @($candidate, $probeTarget, $current, $previous)
      $probeCause = if ($null -ne $probeFailure) { $probeFailure.Exception } else { $null }
      while ($null -ne $probeCause -and $null -ne $probeCause.InnerException) { $probeCause = $probeCause.InnerException }
      $probeCode = if ($null -ne $probeCause) { $probeCause.HResult -band 0xffff } else { 0 }
      Assert-True ($probeCause -is [IO.IOException] -and $probeCode -in @(32, 33)) ("Fixture did not establish a real sharing violation before testing runtime retries. Actual: " + ((Get-RuntimeFailureEvidence $probeFailure) | ConvertTo-Json -Depth 8 -Compress))
      if ($temporary) { [DshRuntimeDirectoryLockFixture]::ReleaseAfter($handle, 750) }
      $elapsed = [Diagnostics.Stopwatch]::StartNew()
      $failure = $null
      try { Switch-RuntimeDirectory $candidate $current $previous } catch { $failure = $_ }
      $elapsed.Stop()
      Write-RuntimeSwitchEvidence 'production-switch' $temporary $failure $handle $elapsed.ElapsedMilliseconds @($candidate, $current, $previous)
      if ($temporary) {
        Assert-True ($null -eq $failure) "A temporary directory lock did not recover: $failure"
        Assert-True ((Get-FileHash (Join-Path $current 'node.exe')).Hash -eq $newHash) 'Temporary-lock recovery did not publish the complete candidate.'
        Assert-True ((Get-FileHash (Join-Path $previous 'node.exe')).Hash -eq $oldHash) 'Temporary-lock recovery lost the previous runtime.'
      } else {
        Assert-True ($null -ne $failure -and $failure.Exception.Message -like '*still in use after bounded retries*') ("A persistent directory lock did not produce the bounded sharing-violation failure. Actual: " + ((Get-RuntimeFailureEvidence $failure) | ConvertTo-Json -Depth 8 -Compress))
        Assert-True ((Get-FileHash (Join-Path $current 'node.exe')).Hash -eq $oldHash) 'Persistent-lock failure did not restore the previous runtime.'
        Assert-True ((Get-FileHash (Join-Path $candidate 'node.exe')).Hash -eq $newHash) 'Persistent-lock failure changed candidate bytes.'
      }
    } finally { $handle.Dispose() }
  }
  # Missing sources are not sharing violations and must not be retried as a locked runtime.
  $failure = $null
  try { Move-RuntimeDirectory (Join-Path $scratch 'missing-runtime') (Join-Path $scratch 'unused-destination') } catch { $failure = $_ }
  Assert-True ($null -ne $failure -and $failure.Exception.Message -notlike '*bounded retries*') 'An unrelated filesystem error was treated as a sharing violation.'
  $conflictSource = Join-Path $scratch 'conflict-source'
  $conflictTarget = Join-Path $scratch 'conflict-target'
  New-Item -ItemType Directory -Path $conflictSource, $conflictTarget | Out-Null
  Set-Content (Join-Path $conflictSource 'keep.txt') 'source'
  Set-Content (Join-Path $conflictTarget 'keep.txt') 'target'
  $failure = $null
  try { Move-RuntimeDirectory $conflictSource $conflictTarget } catch { $failure = $_ }
  Assert-True ($null -ne $failure -and $failure.Exception.Message -notlike '*bounded retries*') 'An existing destination was accepted or retried as a sharing violation.'
  Assert-True ((Get-Content -Raw (Join-Path $conflictSource 'keep.txt')).Trim() -eq 'source') 'Destination conflict changed the source.'
  Assert-True ((Get-Content -Raw (Join-Path $conflictTarget 'keep.txt')).Trim() -eq 'target') 'Destination conflict overwrote the target.'
  Write-Host 'Windows runtime switching: transient lock, persistent lock rollback, missing source and destination conflict passed.'
}
function Reject-Home([string]$Install, [string]$DataHome) {
  $arguments = @('-Dir', $Install, '-SkipPlugins', '-PrepareOnly', '-Force')
  if ($DataHome) { $arguments += @('-DshHome', $DataHome) }
  $output = & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/install.ps1') @arguments 2>&1
  Assert-True ($LASTEXITCODE -ne 0) "Unsafe home accepted: $DataHome"
  Assert-True (($output | Out-String) -match '数据目录') "Failed for a reason other than the directory guard: $output"
}
function Test-DataHomeGuards([string]$Install) {
  $fresh = Join-Path $scratch 'rejected-fresh'
  foreach ($relative in @('dsh', 'dsh/new', 'runtime/node/new', 'data-backups/new', 'overlays/new', 'dsh.old-next/new')) {
    Reject-Home $fresh (Join-Path $fresh $relative)
    Assert-True (-not (Test-Path $fresh)) 'Rejected fresh install created directories.'
  }
  $session = Join-Path $Install 'data/active-session'
  [IO.File]::WriteAllBytes($session, [byte[]]@(0, 1, 2, 255))
  $guards = @($session, (Join-Path $Install 'install.json'), (Join-Path $Install 'dsh-ui.state'), (Join-Path $Install 'runtime/node/node.exe'))
  $before = @($guards | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash }) -join ','
  $alias = Join-Path $scratch 'install-alias'
  New-Item -ItemType Junction -Path $alias -Target $Install | Out-Null
  try {
    foreach ($homePath in @($alias, $scratch, (Join-Path $alias 'DSH/new'), (Join-Path $alias 'runtime/node/new'), (Join-Path $alias 'data-backups/new'))) {
      Reject-Home $Install $homePath
      Assert-True ((@($guards | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash }) -join ',') -eq $before) 'Rejected home changed active files.'
    }
    $intentPath = Join-Path $Install 'install.json'
    $savedIntent = [IO.File]::ReadAllBytes($intentPath)
    try {
      @{ home = (Join-Path $alias 'dsh/new'); profile = 'web' } | ConvertTo-Json | Set-Content -Encoding UTF8 $intentPath
      $badHash = (Get-FileHash $intentPath).Hash
      Reject-Home $Install ''
      Assert-True ((Get-FileHash $intentPath).Hash -eq $badHash) 'Rejected saved intent was overwritten.'
    } finally { [IO.File]::WriteAllBytes($intentPath, $savedIntent) }
  } finally { [IO.Directory]::Delete($alias) }
  $linkedInstall = Join-Path $scratch 'linked-data-install'
  New-Item -ItemType Directory -Path (Join-Path $linkedInstall 'dsh') | Out-Null
  $dataLink = Join-Path $linkedInstall 'data'
  New-Item -ItemType Junction -Path $dataLink -Target (Join-Path $linkedInstall 'dsh') | Out-Null
  try { Reject-Home $linkedInstall ''; Assert-True (-not (Test-Path (Join-Path $linkedInstall 'install.json'))) 'Linked data persisted intent.' }
  finally { [IO.Directory]::Delete($dataLink) }
  $outside = Join-Path $scratch 'managed-outside'
  New-Item -ItemType Directory -Path $outside | Out-Null
  $runtimeLink = Join-Path $linkedInstall 'runtime'
  New-Item -ItemType Junction -Path $runtimeLink -Target $outside | Out-Null
  try { Reject-Home $linkedInstall (Join-Path $outside 'new'); Assert-True (-not (Test-Path (Join-Path $outside 'new'))) 'Managed junction target was created.' }
  finally { [IO.Directory]::Delete($runtimeLink) }
  Prepare -InstallerArgs @('-Dir', $Install, '-Force')
  Assert-True ((Get-FileHash $session).Hash -eq ($before -split ',')[0]) 'Source replacement changed active session.'
}
try {
  Test-RuntimeDirectoryLocks
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

  Test-DataHomeGuards $isolated

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
  Assert-True ((Get-FileHash $importedSession).Hash -eq $importedHash) 'Runtime recovery changed the active session.'
  & (Join-Path $custom 'runtime/node/node.exe') (Join-Path $root 'tests/runtime-loader.mjs') (Join-Path $custom 'dsh') (Join-Path $scratch 'native-loader')
  Assert-True ($LASTEXITCODE -eq 0) 'The pinned runtime cannot load the frozen native loader dependency.'
  # Capture arguments through the real launcher and private Node, with no application boot.
  Copy-Item (Join-Path $root 'scripts/launch.ps1') (Join-Path $custom 'dsh-ui.ps1')
  $intent | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $custom 'launch.json')
  $loader = Join-Path $custom 'dsh/node_modules/tsx/dist/esm'
  New-Item -ItemType Directory -Force -Path $loader | Out-Null
  Set-Content -Path (Join-Path $loader 'index.mjs') -Value 'export {};'
  Set-Content -Path (Join-Path $custom 'dsh/apps/cli/src/bin.ts') -Value 'import zlib from "node:zlib"; console.log(JSON.stringify({args: process.argv.slice(2), home: process.env.DSH_HOME, node: process.versions.node, brotliBlockSwitch: Object.hasOwn(zlib.constants, "BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH")}));'
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
    $expectedRuntime = (Get-Content -Raw (Join-Path $root 'dsh-ui.json') | ConvertFrom-Json).node.runtime
    Assert-True ($captured.node -eq $expectedRuntime) 'Launcher did not use the pinned runtime.'
    Assert-True $captured.brotliBlockSwitch 'Runtime is missing the fixed Brotli decoder constant.'
    Write-Host ("Launcher runtime: " + $captured.node)
  }
  Write-Host 'Windows preparation: isolation, data backup, resume, partial-runtime recovery and CLI forwarding passed.'
} finally {
  if ($null -eq $oldHome) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue } else { $env:DSH_HOME = $oldHome }
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
