$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/distribution/filesystem-paths.ps1')
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('dsh-bootstrap-paths-' + [Guid]::NewGuid().ToString())
$originalLocation = Get-Location
$originalProcessDirectory = [Environment]::CurrentDirectory
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
  Set-Location -LiteralPath $fixture
  [Environment]::CurrentDirectory = $originalProcessDirectory
  foreach ($value in @('program', 'data', 'plugin.tgz', 'backend/package.json')) {
    $expected = Join-Path $fixture $value
    $actual = Resolve-DshFileSystemPath $value
    if ($actual -ne $expected) { throw "Relative provider path resolved incorrectly for $value" }
  }
  New-PSDrive -Name DshPathFixture -PSProvider FileSystem -Root $fixture | Out-Null
  try {
    if ((Resolve-DshFileSystemPath 'DshPathFixture:/program') -ne (Join-Path $fixture 'program')) { throw 'Filesystem PSDrive resolution failed' }
  } finally { Remove-PSDrive -Name DshPathFixture }
  $refused = $false
  try { Resolve-DshFileSystemPath 'Env:PATH' | Out-Null } catch { $refused = $true }
  if (-not $refused) { throw 'Non-filesystem provider was accepted' }
  Write-Output 'Provider-aware relative, PSDrive, and non-filesystem rejection checks passed'
} finally {
  Set-Location -LiteralPath $originalLocation.Path
  [Environment]::CurrentDirectory = $originalProcessDirectory
  $absoluteFixture = [IO.Path]::GetFullPath($fixture)
  if (-not $absoluteFixture.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()))) { throw 'Refusing cleanup outside the named temp fixture' }
  Remove-Item -LiteralPath $absoluteFixture -Recurse -Force
}
