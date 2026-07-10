param(
  [int]$HttpPort = 3100,
  [int]$NmeaPort = 10110,
  [double]$StartLatitude = -17.772667,
  [double]$StartLongitude = 177.38355,
  [double]$SpeedKnots = 8.4,
  [double]$CourseDeg = 272
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$env:GATEWAY_HTTP_PORT = [string]$HttpPort
$env:GATEWAY_NMEA_PORT = [string]$NmeaPort
$env:GATEWAY_SIMULATOR_ENABLED = "true"
$env:GATEWAY_SIMULATOR_START_LAT = [string]$StartLatitude
$env:GATEWAY_SIMULATOR_START_LON = [string]$StartLongitude
$env:GATEWAY_SIMULATOR_SPEED_KNOTS = [string]$SpeedKnots
$env:GATEWAY_SIMULATOR_COURSE_DEG = [string]$CourseDeg

Write-Host "Starting BridgeLog Gateway simulator..."
Write-Host "Web app/dashboard: http://localhost:$HttpPort"
Write-Host "Gateway dashboard: http://localhost:$HttpPort/gateway"
Write-Host "Simulated NMEA listener: 0.0.0.0:$NmeaPort"

node (Join-Path $root "gateway\bridgeLogGateway.mjs")