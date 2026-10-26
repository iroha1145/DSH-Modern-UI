# Start DSH-UI on Windows. The installer copies this file to <install dir>\dsh-ui.ps1, next to
# launch.json. Arguments go to the dsh CLI; with none it boots the profile chosen at install.
# The web profile's workspace-write root is the process working directory. Keep the caller's
# directory when that is a project; if the caller is the real home, use <data>\workspace
# instead so the default root is not $HOME and does not include ~/.ssh.
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$conf = Join-Path $dir 'launch.json'
$settings = if (Test-Path $conf) { Get-Content -Raw -Encoding UTF8 $conf | ConvertFrom-Json } else { $null }
# The data directory chosen at install wins over a DSH_HOME meant for another DSH.
if ($settings -and $settings.home) { $env:DSH_HOME = $settings.home }
else { $env:DSH_HOME = Join-Path $dir 'data' }
$profileName = if ($settings -and $settings.profile) { $settings.profile } else { 'web' }
$node = Join-Path $dir 'runtime\node\node.exe'
if (-not (Test-Path $node)) { Write-Host "dsh-ui: 找不到 ${node}，请重新运行安装脚本"; exit 1 }
$env:Path = "$(Join-Path $dir 'runtime\node');$(Join-Path $dir 'runtime\node_modules\.bin');$env:Path"
$env:TSX_TSCONFIG_PATH = Join-Path $dir 'dsh\tsconfig.json'

$arguments = @($args)
if ($arguments.Count -eq 0) { $arguments = @($profileName) }
# Node's --import takes a URL; a bare Windows path would read as a URL scheme.
$loader = ([System.Uri](Join-Path $dir 'dsh\node_modules\tsx\dist\esm\index.mjs')).AbsoluteUri
function Resolve-Directory([string]$Path) {
  # Follow links. A workspace path that points at $HOME would otherwise become the
  # workspace-write root even though its literal path is not $HOME.
  $item = Get-Item -LiteralPath $Path -Force
  for ($hop = 0; $hop -lt 8 -and $item.LinkType; $hop++) {
    $target = $item.Target
    if ($target -is [System.Array]) { $target = $target | Select-Object -First 1 }
    if ([string]::IsNullOrEmpty([string]$target)) { break }
    if (-not [IO.Path]::IsPathRooted([string]$target)) {
      $parent = Split-Path -Parent $item.FullName
      $target = [IO.Path]::GetFullPath((Join-Path $parent ([string]$target)))
    }
    $item = Get-Item -LiteralPath ([string]$target) -Force
  }
  return [IO.Path]::GetFullPath($item.FullName).TrimEnd([char[]]@('\', '/'))
}
function Test-SameDirectory([string]$Left, [string]$Right) {
  # Windows paths differ by case; treating a case-variant of $HOME as home is the safe direction.
  return [string]::Equals((Resolve-Directory $Left), (Resolve-Directory $Right), [StringComparison]::OrdinalIgnoreCase)
}
if (Test-SameDirectory (Get-Location).Path $HOME) {
  $workspace = Join-Path $env:DSH_HOME 'workspace'
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  Set-Location -LiteralPath $workspace
  if (Test-SameDirectory (Get-Location).Path $HOME) {
    Write-Host 'dsh-ui: 默认工作区不能是主目录'
    exit 1
  }
}
& $node --import $loader (Join-Path $dir 'dsh\apps\cli\src\bin.ts') @arguments
exit $LASTEXITCODE
