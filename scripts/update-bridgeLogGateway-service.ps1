param(
  [string]$ServiceName = "BridgeLogGateway",
  [string]$NssmExe = "nssm.exe"
)

$ErrorActionPreference = "Stop"

$nssmCommand = Get-Command $NssmExe -ErrorAction Stop
$status = & $nssmCommand.Source status $ServiceName 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Service not found: $ServiceName"
}

Write-Host "Restarting $ServiceName after update..."
& $nssmCommand.Source restart $ServiceName
Write-Host "$ServiceName restarted."