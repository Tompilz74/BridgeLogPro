param(
  [string]$RulePrefix = "BridgeLog Gateway",
  [int]$NmeaPort = 10110,
  [int]$HttpPort = 3100
)

$ErrorActionPreference = "Stop"

function Ensure-PortRule {
  param(
    [string]$Name,
    [string]$DisplayName,
    [int]$Port
  )

  $existing = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -Name $Name -Enabled True -Profile Private -Direction Inbound -Action Allow | Out-Null
    Set-NetFirewallPortFilter -AssociatedNetFirewallRule $existing -Protocol TCP -LocalPort $Port | Out-Null
    Write-Host "Updated firewall rule: $DisplayName TCP $Port"
    return
  }

  New-NetFirewallRule `
    -Name $Name `
    -DisplayName $DisplayName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private | Out-Null

  Write-Host "Created firewall rule: $DisplayName TCP $Port"
}

Ensure-PortRule -Name "BridgeLogGateway-NMEA" -DisplayName "$RulePrefix NMEA TCP" -Port $NmeaPort
Ensure-PortRule -Name "BridgeLogGateway-HTTP" -DisplayName "$RulePrefix HTTP API" -Port $HttpPort

Write-Host "Firewall ready for LAN/private network access only."