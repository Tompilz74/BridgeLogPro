# BridgeLog Gateway

BridgeLog Gateway is the onboard Windows service for Northern Escape.

It runs separately from the Netlify BridgeLog Web App and is responsible for vessel-network data:

- NMEA 0183 over TCP
- Latest vessel state cache
- Local history snapshots
- HTTP REST API
- Server-sent events for live updates
- Simple local dashboard
- Optional local hosting of the built BridgeLog Web App

The Gateway is intended for LAN/onboard use only. Do not port-forward it or expose it publicly.

## Config

Runtime settings live in `gateway/config.json`:

- `nmea.host` / `nmea.port` default to `0.0.0.0:10110`
- `http.host` / `http.port` default to `0.0.0.0:3100`
- `cors.allowedOrigins` controls browser origins that may read the Gateway API
- `vesselName` labels the dashboard/API state
- `staleTimeoutSeconds` controls stale flags per data group
- `webApp.serveDist` serves the built web app from `dist` on port `3100`

Environment variables can override the main runtime values when needed.

## Run Manually

```powershell
node .\gateway\bridgeLogGateway.mjs
```

Dashboard/API:

```text
http://localhost:3100/gateway
```

If `npm run build` has produced `dist`, the crew-facing web app is also served from:

```text
http://<gateway-ip>:3100
```

## Simulator Mode

For shore-side testing without Northern Escape connected:

```powershell
npm run gateway:simulator
```

Or start/stop simulator mode on a running local Gateway:

```text
http://localhost:3100/api/v1/simulator/start
http://localhost:3100/api/v1/simulator/stop
```

Simulator mode is off by default and should stay off for onboard deployment.

## Windows Firewall

Run PowerShell as Administrator:

```powershell
.\scripts\setup-bridgeLogGateway-firewall.ps1
```

This opens inbound TCP `10110` and `3100` on the Windows private network profile.

## Install As Windows Service

Install NSSM and make sure `nssm.exe` is on `PATH`, then run PowerShell as Administrator:

```powershell
.\scripts\install-bridgeLogGateway-service.ps1
```

Update/restart after deploying new code or config:

```powershell
.\scripts\update-bridgeLogGateway-service.ps1
```

Uninstall:

```powershell
.\scripts\uninstall-bridgeLogGateway-service.ps1
```

The service name is `BridgeLogGateway`.

## REST API

Current versioned endpoints:

- `GET /api/v1/health`
- `GET /api/v1/state`
- `GET /api/v1/diagnostics`
- `GET /api/v1/history`
- `GET /api/v1/events`
- `GET /api/v1/simulator/start`
- `GET /api/v1/simulator/stop`

Temporary aliases remain available for existing clients:

- `GET /api/health`
- `GET /api/state`
- `GET /api/diagnostics`
- `GET /api/history`
- `GET /api/events`
- `GET /api/gateway/state`
- `GET /api/vessel-state`

## Live Updates

`/api/v1/events` streams `gateway-state` events using Server-Sent Events.

The web app auto-detects the Gateway and connects to HTTP/SSE. It does not receive NMEA directly.

## Tests

```powershell
npm run test:gateway
```