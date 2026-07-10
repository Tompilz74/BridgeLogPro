param(
  [string]$ServiceName = "BridgeLogGateway",
  [string]$GatewayRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$NodeExe = "node.exe",
  [string]$NssmExe = "nssm.exe",
  [string]$ConfigPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "gateway\config.json")
)

$ErrorActionPreference = "Stop"

$gatewayScript = Join-Path $GatewayRoot "gateway\bridgeLogGateway.mjs"
if (!(Test-Path $gatewayScript)) {
  throw "Gateway script not found: $gatewayScript"
}
if (!(Test-Path $ConfigPath)) {
  throw "Gateway config not found: $ConfigPath"
}

$nodeCommand = Get-Command $NodeExe -ErrorAction Stop
$nssmCommand = Get-Command $NssmExe -ErrorAction Stop
$serviceLogDir = Join-Path $GatewayRoot "gateway\logs"
New-Item -ItemType Directory -Force -Path $serviceLogDir | Out-Null

& $nssmCommand.Source stop $ServiceName 2>$null | Out-Null
& $nssmCommand.Source remove $ServiceName confirm 2>$null | Out-Null

& $nssmCommand.Source install $ServiceName $nodeCommand.Source $gatewayScript
& $nssmCommand.Source set $ServiceName AppDirectory $GatewayRoot
& $nssmCommand.Source set $ServiceName AppEnvironmentExtra "GATEWAY_CONFIG=$ConfigPath"
& $nssmCommand.Source set $ServiceName AppStdout (Join-Path $serviceLogDir "service.out.log")
& $nssmCommand.Source set $ServiceName AppStderr (Join-Path $serviceLogDir "service.err.log")
& $nssmCommand.Source set $ServiceName AppRotateFiles 1
& $nssmCommand.Source set $ServiceName AppRotateOnline 1
& $nssmCommand.Source set $ServiceName AppRotateBytes 1048576
& $nssmCommand.Source set $ServiceName Start SERVICE_AUTO_START
& $nssmCommand.Source set $ServiceName AppStopMethodSkip 6
& $nssmCommand.Source start $ServiceName

Write-Host "Installed and started $ServiceName"
Write-Host "Config: $ConfigPath"
Write-Host "Gateway dashboard/API: http://localhost:3100"