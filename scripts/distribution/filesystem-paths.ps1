function Resolve-DshFileSystemPath([string]$Value) {
  [System.Management.Automation.ProviderInfo]$providerInfo = $null
  [System.Management.Automation.PSDriveInfo]$driveInfo = $null
  $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Value, [ref]$providerInfo, [ref]$driveInfo)
  if ($providerInfo.Name -ne 'FileSystem') { throw 'Only FileSystem provider paths are accepted.' }
  return $resolved
}
