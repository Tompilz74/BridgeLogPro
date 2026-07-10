param(
  [string]$ServiceName = "BridgeLogGateway",
  [string]$NssmExe = "nssm.exe"
)

$ErrorActionPreference = "Stop"

$nssmCommand = Get-Command $NssmExe -ErrorAction Stop
& $nssmCommand.Source stop $ServiceName 2>$null | Out-Null
& $nssmCommand.Source remove $ServiceName confirm
Write-Host "Removed $ServiceName"