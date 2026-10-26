# DSH-UI installer for Windows (PowerShell 5.1 or later). Same steps as install.sh: download the
# official DeepSeek Harness source at the pinned commit, apply patches/dsh-ui.patch, install
# dependencies and build with a private Node and pnpm, write the launcher, then install the
# community plugins the profile lacks. Needs Git for Windows and the tar.exe in Windows 10+.
#
# Interpolations next to Chinese text are written ${name}: PowerShell variable names may contain
# CJK letters, so "$Dir里" would read a variable called Dir里.
param(
  [string]$Dir = (Join-Path $HOME '.dsh-ui'),
  [string]$DshHome = '',
  [string]$DshProfile = '',
  [switch]$SkipPlugins,
  [switch]$PrepareOnly,
  [switch]$Force,
  [switch]$Help
)
$ErrorActionPreference = 'Stop'
# The progress bar makes Invoke-WebRequest crawl on PowerShell 5.1; older systems default below TLS 1.2.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if ($Help) {
  @'
用法: install.ps1 [-Dir <目录>] [-DshHome <目录>] [-DshProfile <名称>] [-SkipPlugins] [-PrepareOnly] [-Force]

  -Dir          安装目录，默认 ~\.dsh-ui
  -DshHome      DSH 数据目录（DSH_HOME）。默认沿用上次安装记下的目录；第一次安装用 <安装目录>\data；已有目录会先备份
  -DshProfile   插件装进哪个配置。默认沿用上次的；第一次安装用 web
  -SkipPlugins  不装社区插件
  -PrepareOnly  只下载源码并打补丁，不装依赖、不构建；之后再运行一次会接着装
  -Force        同一版本已装好也重新下载构建（旧目录改名保留）

环境变量: DSH_UI_TARBALL_URL（官方源码包地址）、DSH_UI_NODE_MIRROR（Node 下载根地址）
'@ | Write-Host
  exit 0
}

function Fail([string]$Message) { Write-Host "错误: ${Message}" -ForegroundColor Red; exit 1 }
function Invoke-Checked([string]$What, [scriptblock]$Block) {
  & $Block
  if ($LASTEXITCODE -ne 0) { Fail "${What} 失败（退出码 ${LASTEXITCODE}）" }
}
function Get-Sha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLower() }
function Publish-Config([string]$TemporaryPath, [string]$DestinationPath) {
  if ([IO.File]::Exists($DestinationPath)) {
    # A CLR null string avoids PowerShell converting $null into an empty backup path.
    [IO.File]::Replace($TemporaryPath, $DestinationPath, [NullString]::Value)
  } else {
    [IO.File]::Move($TemporaryPath, $DestinationPath)
  }
}

# Same-volume rename avoids PowerShell 5.1 Move-Item enumerating runtime files.
# Retry only Windows sharing/lock violations, never permissions or destination conflicts.
function Move-RuntimeDirectory([string]$Source, [string]$Destination) {
  for ($attempt = 0; $attempt -lt 9; $attempt++) {
    try {
      [IO.Directory]::Move($Source, $Destination)
      return
    } catch {
      $cause = $_.Exception
      while ($cause.InnerException) { $cause = $cause.InnerException }
      $code = $cause.HResult -band 0xffff
      if (-not ($cause -is [IO.IOException]) -or ($code -ne 32 -and $code -ne 33)) { throw }
      if ($attempt -eq 8) {
        throw [IO.IOException]::new("Node directory is still in use after bounded retries: ${Source}. Close the process using this installation and rerun the installer.", $cause)
      }
      Start-Sleep -Milliseconds 250
    }
  }
}
function Switch-RuntimeDirectory([string]$Candidate, [string]$Current, [string]$Previous) {
  if (Test-Path -LiteralPath $Previous) { Remove-Item -LiteralPath $Previous -Recurse -Force }
  if (Test-Path -LiteralPath $Current) { Move-RuntimeDirectory $Current $Previous }
  try {
    Move-RuntimeDirectory $Candidate $Current
  } catch {
    $switchFailure = $_
    if (-not (Test-Path -LiteralPath $Current) -and (Test-Path -LiteralPath $Previous)) {
      try { Move-RuntimeDirectory $Previous $Current } catch {
        throw [IO.IOException]::new("Node switch and rollback failed. The prior runtime is retained at ${Previous}; stop the process holding it and rerun the installer.", $_.Exception)
      }
    }
    throw $switchFailure
  }
}

# Run from a checkout of this repository; otherwise fetch it and run the fetched copy.
$Root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { '' }
if (-not $Root -or -not (Test-Path (Join-Path $Root 'dsh-ui.json'))) {
  $repoUrl = if ($env:DSH_UI_REPO_URL) { $env:DSH_UI_REPO_URL } else { 'https://codeload.github.com/iroha1145/DSH-Modern-UI/zip/main' }
  $fetched = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-ui-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $fetched | Out-Null
  Write-Host '下载 DSH-UI 仓库 …'
  Invoke-WebRequest -UseBasicParsing -Uri $repoUrl -OutFile (Join-Path $fetched 'repo.zip')
  Expand-Archive -Path (Join-Path $fetched 'repo.zip') -DestinationPath $fetched
  $script = (Get-ChildItem -Path $fetched -Recurse -Filter install.ps1 | Select-Object -First 1).FullName
  $forward = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script, '-Dir', $Dir)
  if ($DshHome) { $forward += @('-DshHome', $DshHome) }
  if ($DshProfile) { $forward += @('-DshProfile', $DshProfile) }
  if ($SkipPlugins) { $forward += '-SkipPlugins' }
  if ($PrepareOnly) { $forward += '-PrepareOnly' }
  if ($Force) { $forward += '-Force' }
  & (Get-Process -Id $PID).Path @forward
  Remove-Item -Recurse -Force $fetched
  return
}

$manifest = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $Root 'dsh-ui.json') | ConvertFrom-Json
$commit = $manifest.upstream.commit
$tarballUrl = if ($env:DSH_UI_TARBALL_URL) { $env:DSH_UI_TARBALL_URL } else { $manifest.upstream.tarball }
$tarballSha = $manifest.upstream.tarballSha256
if ($tarballSha -notmatch '^[a-f0-9]{64}$') { Fail '清单缺少有效的官方源码包校验值' }
$patchFile = Join-Path $Root $manifest.patch.file
$stamp = "$commit $($manifest.patch.sha256)"
$nodeVersion = $manifest.node.runtime

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { Fail '需要 tar.exe（Windows 10 及以上自带）' }
$gitOk = $false
try { git --version *> $null; $gitOk = ($LASTEXITCODE -eq 0) } catch { $gitOk = $false }
if (-not $gitOk) { Fail '需要 Git for Windows（用来打补丁），请先安装' }
if ((Get-Sha256 $patchFile) -ne $manifest.patch.sha256) {
  Fail "补丁文件的校验值不对，可能下载不完整或被改了换行符：${patchFile}"
}

# Resolve junctions/symlinks through Windows itself, including existing ancestors.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class DshPhysicalDirectory {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
  public static string Resolve(string path) {
    using (var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      var buffer = new StringBuilder(32768);
      uint size = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
      if (size == 0 || size >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
      string result = buffer.ToString();
      if (result.StartsWith(@"\\?\UNC\")) return @"\\" + result.Substring(8);
      return result.StartsWith(@"\\?\") ? result.Substring(4) : result;
    }
  }
}
'@
function Resolve-PhysicalDirectory([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (Test-Path -LiteralPath $full -PathType Container) { return [DshPhysicalDirectory]::Resolve($full) }
  # A broken reparse point must fail closed rather than be treated as a new directory.
  $item = Get-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
  if ($null -ne $item) { Fail "目录不存在、链接失效或不是目录：$full" }
  $parent = Split-Path -Parent $full
  if (-not $parent -or $parent -eq $full) { Fail "无法解析目录：$full" }
  return Join-Path (Resolve-PhysicalDirectory $parent) (Split-Path -Leaf $full)
}
function Test-Within([string]$Child, [string]$Parent) {
  return ($Child.TrimEnd('\') + '\').StartsWith($Parent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
$Dir = Resolve-PhysicalDirectory $Dir

# The install directory holds only what this script writes; refuse to spread into anything else.
$allowed = '^(data|data-backups|install\.json(\.tmp)?|runtime|dsh|dsh\.old-.*|dsh-ui\.ps1|dsh-ui\.cmd|dsh-ui\.state|launch\.json(\.tmp)?|overlays|upstream-.*\.tar\.gz(\.part)?)$'
if (Test-Path $Dir) {
  foreach ($entry in Get-ChildItem -Force -Path $Dir) {
    if ($entry.Name -notmatch $allowed) { Fail "${Dir} 里已经有别的文件（$($entry.Name)），不像是 DSH-UI 的安装目录。换一个 -Dir" }
  }
}
$runtime = Join-Path $Dir 'runtime'
$dsh = Join-Path $Dir 'dsh'
$stateFile = Join-Path $Dir 'dsh-ui.state'
$conf = Join-Path $Dir 'launch.json'

# A rerun keeps the data directory and profile recorded by the previous install.
$intent = Join-Path $Dir 'install.json'
$readConf = if (Test-Path $intent) { $intent } else { $conf }
$explicitHome = [bool]$DshHome
$recorded = if (Test-Path $readConf) { Get-Content -Raw -Encoding UTF8 $readConf | ConvertFrom-Json } else { $null }
if (-not $DshHome) {
  $DshHome = if ($recorded -and $recorded.home) { $recorded.home } else { Join-Path $Dir 'data' }
}
if (-not $DshProfile) { $DshProfile = if ($recorded -and $recorded.profile) { $recorded.profile } else { $manifest.profile } }
$DshHome = Resolve-PhysicalDirectory $DshHome
if (Test-Within $Dir $DshHome) { Fail '数据目录不能包含安装目录；无法安全备份' }
if ((Test-Within $DshHome $Dir) -and -not (Test-Within $DshHome (Join-Path $Dir 'data'))) {
  Fail '数据目录不能位于安装器管理的目录；安装目录内只能使用 data 子目录'
}
$managedPaths = @('runtime', 'dsh', 'data-backups', 'overlays') | ForEach-Object { Join-Path $Dir $_ }
if (Test-Path -LiteralPath $Dir) { $managedPaths += @(Get-ChildItem -LiteralPath $Dir -Force -Filter 'dsh.old-*' | ForEach-Object { $_.FullName }) }
foreach ($managedPath in $managedPaths) {
  $physical = Resolve-PhysicalDirectory $managedPath
  if ((Test-Within $DshHome $physical) -or (Test-Within $physical $DshHome)) { Fail "数据目录不能与安装器管理的目录重叠：$physical" }
}
New-Item -ItemType Directory -Force -Path $Dir, $DshHome | Out-Null
if ((-not (Test-Path $intent) -or $explicitHome) -and (Get-ChildItem -Force $DshHome | Select-Object -First 1)) {
  $backup = Join-Path $Dir ('data-backups\home-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Force $backup | Out-Null
  Invoke-Checked '备份数据' { tar -czf (Join-Path $backup 'data.tar.gz.part') -C $DshHome . }
  Move-Item (Join-Path $backup 'data.tar.gz.part') (Join-Path $backup 'data.tar.gz')
  Write-Host "数据备份：${backup}；回退前请先停止所有使用此目录的 DSH"
}
@{ home = $DshHome; profile = $DshProfile } | ConvertTo-Json | Set-Content -Encoding UTF8 "${intent}.tmp"
Publish-Config "${intent}.tmp" $intent


# Private Node from the official release zip, checked against SHASUMS256.txt; pnpm pinned next to it.
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$nodeDir = Join-Path $runtime 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
function Test-Runtime([string]$Path) {
  $exe = Join-Path $Path 'node.exe'
  $npm = Join-Path $Path 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path $exe) -or -not (Test-Path $npm) -or -not (Test-Path (Join-Path $Path 'npm.cmd'))) { return $false }
  try {
    $version = & $exe -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or $version -ne $nodeVersion) { return $false }
    & $exe $npm --version *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
    & (Join-Path $Path 'npm.cmd') --version *> $null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}
$previous = Join-Path $runtime 'node.previous'
if (-not (Test-Path $nodeDir) -and (Test-Path $previous)) { Move-RuntimeDirectory $previous $nodeDir }
$complete = Join-Path $nodeDir '.complete'
if (-not (Test-Runtime $nodeDir) -or -not (Test-Path $complete) -or (Get-Content -Raw $complete).Trim() -ne $nodeVersion) {
  $nodeName = "node-v${nodeVersion}-win-${arch}"
  $nodeBase = "$(if ($env:DSH_UI_NODE_MIRROR) { $env:DSH_UI_NODE_MIRROR } else { 'https://nodejs.org/dist' })/v${nodeVersion}"
  $stage = Join-Path $runtime ('node-stage-' + [guid]::NewGuid())
  New-Item -ItemType Directory $stage | Out-Null
  try {
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "${nodeBase}/SHASUMS256.txt").Content -split "`n"
    foreach ($name in @("${nodeName}.zip")) {
      $file = Join-Path $stage $name
      Invoke-WebRequest -UseBasicParsing -Uri "${nodeBase}/${name}" -OutFile $file
      $expected = ($sums | Where-Object { ($_ -split '\s+')[-1] -eq $name } | Select-Object -First 1) -replace '\s.*$', ''
      if (-not $expected -or (Get-Sha256 $file) -ne $expected.Trim().ToLower()) { throw 'Node 校验失败；原运行时已保留，重跑安装器可重试' }
    }
    Expand-Archive -Path (Join-Path $stage "${nodeName}.zip") -DestinationPath $stage
    $candidate = Join-Path $stage $nodeName
    if (-not (Test-Runtime $candidate)) { throw 'Node 运行时缺少可用的 node 或 npm；原运行时已保留' }
    Set-Content -Path (Join-Path $candidate '.complete') -Value $nodeVersion
    Switch-RuntimeDirectory $candidate $nodeDir $previous
  } finally {
    try { Remove-Item -LiteralPath $stage -Recurse -Force } catch {
      Write-Warning "Node staging cleanup could not complete; retained path: ${stage}. $($_.Exception.Message)"
    }
  }
}
$env:Path = "${nodeDir};$(Join-Path $runtime 'node_modules\.bin');$env:Path"
$pnpmCmd = Join-Path $runtime 'node_modules\.bin\pnpm.cmd'
$pnpmVersion = if (Test-Path $pnpmCmd) { (& $pnpmCmd -v) } else { '' }
if ($pnpmVersion -ne $manifest.pnpm) {
  Write-Host "安装 pnpm $($manifest.pnpm) …"
  Invoke-Checked 'npm install' { & (Join-Path $nodeDir 'npm.cmd') install --prefix $runtime --no-audit --no-fund --loglevel=error "pnpm@$($manifest.pnpm)" }
}
Write-Host "Node $(& $nodeExe -v)，pnpm $(& $pnpmCmd -v)"

# The upstream archive carries 14 symlinks (agent notes and test snapshots) that tar.exe can only
# create with Developer Mode or as administrator. The patch and the build use none of them.
$symlinks = @(
  'CLAUDE.md', 'packages/CLAUDE.md', 'vendor/CLAUDE.md', '.claude/skills',
  '.agents/notes/implemented/CLAUDE.md', '.agents/skills/agent-experience/SKILL.md',
  'apps/cli/tests/profiles/acp/cordis.yml',
  'snapshots/acp/escalation-approved/system-prompt.expected.md',
  'snapshots/acp/escalation-approved/tool-schemas.expected.json',
  'snapshots/acp/image-compaction/system-prompt.expected.md',
  'snapshots/sdk/account-provider-signout/system-prompt.expected.md',
  'snapshots/sdk/account-provider-signout/tool-schemas.expected.json',
  'snapshots/session/agent-instructions/workspace/AGENTS.md',
  'snapshots/session/agent-instructions/workspace/nested/AGENTS.md'
)

$state = if (Test-Path $stateFile) { (Get-Content -Raw $stateFile).Trim() } else { '' }
if (-not $Force -and $state -eq "done $stamp") {
  Write-Host 'DSH-UI 这个版本已经装好，跳过下载和构建'
} else {
  if (-not $Force -and ($state -eq "prepared $stamp" -or $state -eq "building $stamp")) {
    Write-Host '接着上次准备好的源码继续'
  } else {
    if (Test-Path $dsh) {
      if ($state -like 'extracting*' -or $state -like 'prepared*' -or $state -like 'building*') {
        Remove-Item -Recurse -Force $dsh
      } elseif ($state -like 'done*') {
        if (-not $Force) { Fail "${dsh} 里装的是另一个版本。加 -Force 重新安装，旧目录会改名保留" }
        $backup = "${dsh}.old-$(Get-Date -Format yyyyMMddHHmmss)"
        Move-Item $dsh $backup
        Write-Host "旧目录已改名为 ${backup}，确认新版本没问题后可以删掉"
      } else {
        Fail "${dsh} 已经存在，但不是本安装器建的，为安全起见不覆盖。换一个 -Dir，或先把它移走"
      }
    }
    $tarball = Join-Path $Dir "upstream-${commit}.tar.gz"
    if (-not (Test-Path $tarball)) {
      Write-Host "下载官方 DeepSeek Harness 源码（${commit}）…"
      Invoke-WebRequest -UseBasicParsing -Uri $tarballUrl -OutFile "${tarball}.part"
      Move-Item "${tarball}.part" $tarball
    }
    if ((Get-Sha256 $tarball) -ne $tarballSha) {
      Remove-Item $tarball
      Fail '官方源码包的校验值不对；已清除不完整缓存，重新运行安装器可重试'
    }
    Set-Content -Path $stateFile -Value "extracting $stamp"
    New-Item -ItemType Directory -Force -Path $dsh | Out-Null
    $tarArgs = @('-xzf', $tarball, '-C', $dsh, '--strip-components', '1')
    foreach ($link in $symlinks) { $tarArgs += @('--exclude', "*/$link") }
    Invoke-Checked '解压源码' { tar @tarArgs }
    Write-Host '打补丁 …'
    Push-Location $dsh
    try {
      # The ceiling keeps git from treating an enclosing repository as the patch root; the config
      # keeps Git for Windows' autocrlf from rewriting the patched files.
      $env:GIT_CEILING_DIRECTORIES = $Dir
      Invoke-Checked '打补丁' { git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn $patchFile }
    } finally {
      Remove-Item Env:GIT_CEILING_DIRECTORIES -ErrorAction SilentlyContinue
      Pop-Location
    }
    Set-Content -Path $stateFile -Value "prepared $stamp"
    Remove-Item $tarball
  }
  if ($PrepareOnly) {
    Write-Host "源码已准备好：${dsh}。再运行一次本脚本（不带 -PrepareOnly）会接着装依赖和构建"
    exit 0
  }
  Set-Content -Path $stateFile -Value "building $stamp"
  Write-Host '安装依赖并构建（第一次要几分钟）…'
  $previousClientCommit = $env:DSH_CLIENT_COMMIT_HASH
  $previousBuildGitCeiling = $env:GIT_CEILING_DIRECTORIES
  Push-Location $dsh
  try {
    $env:LEFTHOOK = '0'
    Invoke-Checked 'pnpm install' { & $pnpmCmd install --frozen-lockfile }
    $env:DSH_CLIENT_COMMIT_HASH = $commit
    $env:GIT_CEILING_DIRECTORIES = $Dir
    Invoke-Checked 'pnpm run build' { & $pnpmCmd run build }
  } finally {
    if ($null -eq $previousClientCommit) { Remove-Item Env:DSH_CLIENT_COMMIT_HASH -ErrorAction SilentlyContinue }
    else { $env:DSH_CLIENT_COMMIT_HASH = $previousClientCommit }
    if ($null -eq $previousBuildGitCeiling) { Remove-Item Env:GIT_CEILING_DIRECTORIES -ErrorAction SilentlyContinue }
    else { $env:GIT_CEILING_DIRECTORIES = $previousBuildGitCeiling }
    Remove-Item Env:LEFTHOOK -ErrorAction SilentlyContinue
    Pop-Location
  }
  Set-Content -Path $stateFile -Value "done $stamp"
}
if ($PrepareOnly) { exit 0 }

# The launcher comes before the plugins, so it exists even when a plugin step needs fixing.
Copy-Item (Join-Path $Root 'scripts\launch.ps1') (Join-Path $Dir 'dsh-ui.ps1')
Set-Content -Path (Join-Path $Dir 'dsh-ui.cmd') -Value "@powershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0dsh-ui.ps1`" %*"
@{ home = $DshHome; profile = $DshProfile } | ConvertTo-Json | Set-Content -Encoding UTF8 -Path "${conf}.tmp"
Publish-Config "${conf}.tmp" $conf

if (-not $SkipPlugins) {
  Invoke-Checked '安装插件' {
    & $nodeExe (Join-Path $Root 'scripts\plugins.mjs') --dsh $dsh --home $DshHome --profile $DshProfile --manifest (Join-Path $Root 'dsh-ui.json')
  }
}

Write-Host ''
Write-Host "装好了。启动：$(Join-Path $Dir 'dsh-ui.cmd')"
Write-Host "它会打印一个带 token 的本机地址，用浏览器打开即可。数据目录：${DshHome}"
