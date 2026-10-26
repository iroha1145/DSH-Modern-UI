# Start DSH-UI on Windows. The installer copies this file to <install dir>\dsh-ui.ps1, next to
# launch.json. Arguments go to the dsh CLI; with none it boots the profile chosen at install.
# DSH runs from the home directory, so relative paths in arguments resolve from there.
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
Set-Location $HOME
& $node --import $loader (Join-Path $dir 'dsh\apps\cli\src\bin.ts') @arguments
exit $LASTEXITCODE
