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
    // Read attributes; allow readers/writers but deny delete/rename on this owned directory.
    SafeFileHandle handle = CreateFile(path, 0x80, 3, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
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
      if ($temporary) { [DshRuntimeDirectoryLockFixture]::ReleaseAfter($handle, 750) }
      $failure = $null
      try { Switch-RuntimeDirectory $candidate $current $previous } catch { $failure = $_ }
      if ($temporary) {
        Assert-True ($null -eq $failure) "A temporary directory lock did not recover: $failure"
        Assert-True ((Get-FileHash (Join-Path $current 'node.exe')).Hash -eq $newHash) 'Temporary-lock recovery did not publish the complete candidate.'
        Assert-True ((Get-FileHash (Join-Path $previous 'node.exe')).Hash -eq $oldHash) 'Temporary-lock recovery lost the previous runtime.'
      } else {
        Assert-True ($null -ne $failure -and $failure.Exception.Message -like '*still in use after bounded retries*') 'A persistent directory lock did not produce the bounded sharing-violation failure.'
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
