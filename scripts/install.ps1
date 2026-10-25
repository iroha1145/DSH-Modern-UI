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
  -DshHome      DSH 数据目录（DSH_HOME）。默认沿用上次安装记下的目录；第一次安装用 $env:DSH_HOME，没有则 ~\.dsh
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

# Run from a checkout of this repository; otherwise fetch it and run the fetched copy.
$Root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { '' }
if (-not $Root -or -not (Test-Path (Join-Path $Root 'dsh-ui.json'))) {
  $repoUrl = if ($env:DSH_UI_REPO_URL) { $env:DSH_UI_REPO_URL } else { 'https://codeload.github.com/iroha1145/DSH-UI/zip/main' }
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

# The install directory holds only what this script writes; refuse to spread into anything else.
$allowed = '^(runtime|dsh|dsh\.old-.*|dsh-ui\.ps1|dsh-ui\.cmd|dsh-ui\.state|launch\.json|overlays|upstream-.*\.tar\.gz(\.part)?)$'
if (Test-Path $Dir) {
  foreach ($entry in Get-ChildItem -Force -Path $Dir) {
    if ($entry.Name -notmatch $allowed) { Fail "${Dir} 里已经有别的文件（$($entry.Name)），不像是 DSH-UI 的安装目录。换一个 -Dir" }
  }
}
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Dir = (Resolve-Path $Dir).Path
$runtime = Join-Path $Dir 'runtime'
$dsh = Join-Path $Dir 'dsh'
$stateFile = Join-Path $Dir 'dsh-ui.state'
$conf = Join-Path $Dir 'launch.json'

# A rerun keeps the data directory and profile recorded by the previous install.
$recorded = if (Test-Path $conf) { Get-Content -Raw -Encoding UTF8 $conf | ConvertFrom-Json } else { $null }
if (-not $DshHome) {
  $DshHome = if ($recorded -and $recorded.home) { $recorded.home } elseif ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
}
if (-not $DshProfile) { $DshProfile = if ($recorded -and $recorded.profile) { $recorded.profile } else { $manifest.profile } }
New-Item -ItemType Directory -Force -Path $DshHome | Out-Null
$DshHome = (Resolve-Path $DshHome).Path

# Private Node from the official release zip, checked against SHASUMS256.txt; pnpm pinned next to it.
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$nodeDir = Join-Path $runtime 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$haveNode = (Test-Path $nodeExe) -and ((& $nodeExe -p 'process.versions.node') -eq $nodeVersion)
if (-not $haveNode) {
  $nodeName = "node-v${nodeVersion}-win-${arch}"
  $nodeBase = "$(if ($env:DSH_UI_NODE_MIRROR) { $env:DSH_UI_NODE_MIRROR } else { 'https://nodejs.org/dist' })/v${nodeVersion}"
  $zip = Join-Path $runtime "${nodeName}.zip"
  Write-Host "下载 Node ${nodeVersion} …"
  Invoke-WebRequest -UseBasicParsing -Uri "${nodeBase}/${nodeName}.zip" -OutFile $zip
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "${nodeBase}/SHASUMS256.txt").Content -split "`n"
  $expected = ($sums | Where-Object { $_ -match "\s${nodeName}\.zip$" } | Select-Object -First 1) -replace '\s.*$', ''
  if (-not $expected -or (Get-Sha256 $zip) -ne $expected.Trim().ToLower()) {
    Remove-Item $zip
    Fail 'Node 安装包的校验值对不上，可能下载不完整'
  }
  if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
  $unpack = Join-Path $runtime 'node-unpack'
  if (Test-Path $unpack) { Remove-Item -Recurse -Force $unpack }
  Expand-Archive -Path $zip -DestinationPath $unpack
  Move-Item (Join-Path $unpack $nodeName) $nodeDir
  Remove-Item -Recurse -Force $unpack, $zip
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
  Push-Location $dsh
  try {
    $env:LEFTHOOK = '0'
    Invoke-Checked 'pnpm install' { & $pnpmCmd install --frozen-lockfile }
    Invoke-Checked 'pnpm run build' { & $pnpmCmd run build }
  } finally {
    Remove-Item Env:LEFTHOOK -ErrorAction SilentlyContinue
    Pop-Location
  }
  Set-Content -Path $stateFile -Value "done $stamp"
}
if ($PrepareOnly) { exit 0 }

# The launcher comes before the plugins, so it exists even when a plugin step needs fixing.
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'overlays') | Out-Null
Copy-Item (Join-Path $Root 'overlays\*.yml') (Join-Path $Dir 'overlays')
Copy-Item (Join-Path $Root 'scripts\launch.ps1') (Join-Path $Dir 'dsh-ui.ps1')
Set-Content -Path (Join-Path $Dir 'dsh-ui.cmd') -Value "@powershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0dsh-ui.ps1`" %*"
@{ home = $DshHome; profile = $DshProfile } | ConvertTo-Json | Set-Content -Encoding UTF8 -Path $conf

if (-not $SkipPlugins) {
  Invoke-Checked '安装插件' {
    & $nodeExe (Join-Path $Root 'scripts\plugins.mjs') --dsh $dsh --home $DshHome --profile $DshProfile --manifest (Join-Path $Root 'dsh-ui.json')
  }
}

Write-Host ''
Write-Host "装好了。启动：$(Join-Path $Dir 'dsh-ui.cmd')"
Write-Host "它会打印一个带 token 的本机地址，用浏览器打开即可。数据目录：${DshHome}"
