import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNmea } from "./nmeaParser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const configPath = process.env.GATEWAY_CONFIG || path.join(__dirname, "config.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function numberFrom(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFrom(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const fileConfig = readJson(configPath, {});
const config = {
  vesselName: process.env.GATEWAY_VESSEL_NAME || fileConfig.vesselName || "Northern Escape",
  nmea: {
    host: process.env.GATEWAY_NMEA_HOST || process.env.NMEA_LISTEN_HOST || fileConfig.nmea?.host || "0.0.0.0",
    port: numberFrom(process.env.GATEWAY_NMEA_PORT || process.env.NMEA_LISTEN_PORT, fileConfig.nmea?.port ?? 10110),
  },
  http: {
    host: process.env.GATEWAY_HTTP_HOST || fileConfig.http?.host || "0.0.0.0",
    port: numberFrom(process.env.GATEWAY_HTTP_PORT, fileConfig.http?.port ?? 3100),
  },
  cors: {
    allowedOrigins: Array.isArray(fileConfig.cors?.allowedOrigins) ? fileConfig.cors.allowedOrigins : [],
  },
  staleTimeoutSeconds: numberFrom(process.env.GATEWAY_STALE_TIMEOUT_SECONDS, fileConfig.staleTimeoutSeconds ?? 120),
  history: {
    intervalSeconds: numberFrom(process.env.GATEWAY_HISTORY_INTERVAL_SECONDS, fileConfig.history?.intervalSeconds ?? 30),
    maxApiRows: numberFrom(process.env.GATEWAY_HISTORY_MAX_API_ROWS, fileConfig.history?.maxApiRows ?? 500),
  },
  logging: {
    directory: process.env.GATEWAY_LOG_DIR || fileConfig.logging?.directory || "gateway/logs",
    fileName: process.env.GATEWAY_LOG_FILE || fileConfig.logging?.fileName || "gateway.log",
    maxBytes: numberFrom(process.env.GATEWAY_LOG_MAX_BYTES, fileConfig.logging?.maxBytes ?? 1_048_576),
    maxFiles: numberFrom(process.env.GATEWAY_LOG_MAX_FILES, fileConfig.logging?.maxFiles ?? 5),
  },
  webApp: {
    serveDist: process.env.GATEWAY_SERVE_WEB_APP ? process.env.GATEWAY_SERVE_WEB_APP === "true" : fileConfig.webApp?.serveDist !== false,
    distPath: process.env.GATEWAY_WEB_DIST || fileConfig.webApp?.distPath || "dist",
  },
  simulator: {
    enabled: booleanFrom(process.env.GATEWAY_SIMULATOR_ENABLED, fileConfig.simulator?.enabled ?? false),
    intervalSeconds: numberFrom(process.env.GATEWAY_SIMULATOR_INTERVAL_SECONDS, fileConfig.simulator?.intervalSeconds ?? 2),
    startLatitude: numberFrom(process.env.GATEWAY_SIMULATOR_START_LAT, fileConfig.simulator?.startLatitude ?? -17.772667),
    startLongitude: numberFrom(process.env.GATEWAY_SIMULATOR_START_LON, fileConfig.simulator?.startLongitude ?? 177.38355),
    speedKnots: numberFrom(process.env.GATEWAY_SIMULATOR_SPEED_KNOTS, fileConfig.simulator?.speedKnots ?? 8.4),
    courseDeg: numberFrom(process.env.GATEWAY_SIMULATOR_COURSE_DEG, fileConfig.simulator?.courseDeg ?? 272),
    windSpeedKnots: numberFrom(process.env.GATEWAY_SIMULATOR_WIND_KNOTS, fileConfig.simulator?.windSpeedKnots ?? 12),
    windAngleDeg: numberFrom(process.env.GATEWAY_SIMULATOR_WIND_ANGLE_DEG, fileConfig.simulator?.windAngleDeg ?? 45),
    depthMeters: numberFrom(process.env.GATEWAY_SIMULATOR_DEPTH_METERS, fileConfig.simulator?.depthMeters ?? 18),
    airTempC: numberFrom(process.env.GATEWAY_SIMULATOR_AIR_TEMP_C, fileConfig.simulator?.airTempC ?? 26),
    waterTempC: numberFrom(process.env.GATEWAY_SIMULATOR_WATER_TEMP_C, fileConfig.simulator?.waterTempC ?? 27),
    barometerHpa: numberFrom(process.env.GATEWAY_SIMULATOR_BAROMETER_HPA, fileConfig.simulator?.barometerHpa ?? 1012),
  },
};

const dataDir = process.env.GATEWAY_DATA_DIR || path.join(__dirname, "data");
const historyPath = path.join(dataDir, "gateway-history.jsonl");
const logDir = path.resolve(rootDir, config.logging.directory);
const logPath = path.join(logDir, config.logging.fileName);
const distDir = path.resolve(rootDir, config.webApp.distPath);
const clients = new Set();
const lineBufferBySocket = new WeakMap();
const startedAt = new Date().toISOString();
let nmeaServer = null;
let reconnectTimer = null;
let lastHistoryWriteAt = 0;
let lastSentenceAtMs = null;
let simulatorTimer = null;
let simulatorStartedAtMs = null;

const latest = {
  gateway: {
    name: "BridgeLog Gateway",
    vesselName: config.vesselName,
    status: "starting",
    nmeaListenHost: config.nmea.host,
    nmeaListenPort: config.nmea.port,
    httpHost: config.http.host,
    httpPort: config.http.port,
    startedAt,
    connectedClients: 0,
    sseClients: 0,
    sentenceCount: 0,
    invalidSentenceCount: 0,
    lastError: null,
    lastUpdated: null,
    stale: true,
    inputSource: "none",
    simulatorEnabled: config.simulator.enabled,
    simulatorActive: false,
  },
  vessel: {
    latitude: null,
    longitude: null,
    timestamp: null,
    speedKnots: null,
    courseDeg: null,
    headingDeg: null,
    windAngleDeg: null,
    windSpeedKnots: null,
    windReference: null,
    windDirTrueDeg: null,
    depthMeters: null,
    airTempC: null,
    waterTempC: null,
    barometerHpa: null,
    humidityPct: null,
    gpsQuality: null,
    satellites: null,
    hdop: null,
    altitudeM: null,
    lastSentence: null,
    lastSentenceType: null,
    updatedAt: null,
  },
};

const groupFields = {
  gps: ["latitude", "longitude", "gpsQuality", "satellites", "hdop", "altitudeM"],
  heading: ["headingDeg"],
  speed: ["speedKnots", "courseDeg"],
  wind: ["windAngleDeg", "windSpeedKnots", "windReference", "windDirTrueDeg"],
  depth: ["depthMeters"],
  environment: ["airTempC", "waterTempC", "barometerHpa", "humidityPct"],
};
const groupUpdatedAt = Object.fromEntries(Object.keys(groupFields).map((key) => [key, null]));

function ensureRuntimeDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
}

function rotateLogsIfNeeded() {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size < config.logging.maxBytes) return;
    for (let i = config.logging.maxFiles - 1; i >= 1; i -= 1) {
      const from = `${logPath}.${i}`;
      const to = `${logPath}.${i + 1}`;
      if (fs.existsSync(from)) {
        if (i + 1 > config.logging.maxFiles) fs.rmSync(from, { force: true });
        else fs.renameSync(from, to);
      }
    }
    fs.renameSync(logPath, `${logPath}.1`);
  } catch {
    // Logging must not crash the gateway.
  }
}

function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  rotateLogsIfNeeded();
  fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, () => {});
  const rendered = `[${entry.ts}] ${level.toUpperCase()} ${message}`;
  if (level === "error") console.error(rendered);
  else console.log(rendered);
}

function ageSeconds(timestamp) {
  if (!timestamp) return null;
  const age = (Date.now() - new Date(timestamp).getTime()) / 1000;
  return Number.isFinite(age) ? Math.max(0, Math.round(age)) : null;
}

function groupMeta(name) {
  const lastUpdated = groupUpdatedAt[name];
  const age = ageSeconds(lastUpdated);
  return {
    lastUpdated,
    ageSeconds: age,
    stale: age == null || age > config.staleTimeoutSeconds,
  };
}

function snapshot() {
  const lastSentenceAge = lastSentenceAtMs == null ? null : Math.max(0, Math.round((Date.now() - lastSentenceAtMs) / 1000));
  const groups = Object.fromEntries(Object.keys(groupFields).map((key) => [key, groupMeta(key)]));
  return {
    gateway: {
      ...latest.gateway,
      lastUpdated: latest.vessel.updatedAt,
      ageSeconds: lastSentenceAge,
      stale: lastSentenceAge == null || lastSentenceAge > config.staleTimeoutSeconds,
      sseClients: clients.size,
    },
    vessel: { ...latest.vessel },
    groups,
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
      node: process.version,
    },
  };
}

function emitState() {
  const payload = snapshot();
  for (const res of clients) {
    res.write("event: gateway-state\n");
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function writeHistory(force = false) {
  const now = Date.now();
  if (!force && now - lastHistoryWriteAt < config.history.intervalSeconds * 1000) return;
  if (latest.vessel.latitude == null && latest.vessel.longitude == null && !latest.vessel.lastSentence) return;
  lastHistoryWriteAt = now;
  fs.appendFile(historyPath, `${JSON.stringify(snapshot())}\n`, (error) => {
    if (error) {
      latest.gateway.lastError = error.message;
      log("error", "Failed to write history", { error: error.message });
      emitState();
    }
  });
}

function markGroups(patch) {
  const now = patch.updatedAt ?? new Date().toISOString();
  for (const [group, fields] of Object.entries(groupFields)) {
    if (fields.some((field) => patch[field] != null)) groupUpdatedAt[group] = now;
  }
}

function ingest(sentence, source = "tcp") {
  const parsed = parseNmea(sentence);
  if (!parsed) {
    latest.gateway.invalidSentenceCount += 1;
    return;
  }
  if (parsed.windReference === "relative" && parsed.windAngleDeg != null && latest.vessel.headingDeg != null && parsed.windDirTrueDeg == null) {
    parsed.windDirTrueDeg = (latest.vessel.headingDeg + parsed.windAngleDeg + 360) % 360;
  }
  latest.gateway.sentenceCount += 1;
  latest.gateway.inputSource = source;
  latest.gateway.status = source === "simulator" || latest.gateway.connectedClients > 0 ? "receiving" : "waiting";
  lastSentenceAtMs = Date.now();
  markGroups(parsed);
  for (const [key, value] of Object.entries(parsed)) {
    if (value != null) latest.vessel[key] = value;
  }
  latest.vessel.updatedAt = parsed.updatedAt ?? new Date().toISOString();
  latest.gateway.lastUpdated = latest.vessel.updatedAt;
  writeHistory();
  emitState();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function nmeaCoord(decimal, isLatitude) {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const degreeWidth = isLatitude ? 2 : 3;
  return `${String(degrees).padStart(degreeWidth, "0")}${minutes.toFixed(3).padStart(6, "0")}`;
}

function nmeaChecksum(body) {
  let checksum = 0;
  for (const ch of body) checksum ^= ch.charCodeAt(0);
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

function nmeaSentence(body) {
  return `$${body}*${nmeaChecksum(body)}`;
}

function simulatorPosition() {
  const elapsedHours = ((Date.now() - simulatorStartedAtMs) / 1000) / 3600;
  const distanceNm = config.simulator.speedKnots * elapsedHours;
  const courseRad = (config.simulator.courseDeg * Math.PI) / 180;
  const latRad = (config.simulator.startLatitude * Math.PI) / 180;
  const deltaLat = (Math.cos(courseRad) * distanceNm) / 60;
  const deltaLon = (Math.sin(courseRad) * distanceNm) / (60 * Math.max(0.2, Math.cos(latRad)));
  return {
    lat: config.simulator.startLatitude + deltaLat,
    lon: config.simulator.startLongitude + deltaLon,
  };
}

function simulatorSentences() {
  const now = new Date();
  const time = `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
  const date = `${pad2(now.getUTCDate())}${pad2(now.getUTCMonth() + 1)}${String(now.getUTCFullYear()).slice(-2)}`;
  const pos = simulatorPosition();
  const latHem = pos.lat < 0 ? "S" : "N";
  const lonHem = pos.lon < 0 ? "W" : "E";
  const lat = nmeaCoord(pos.lat, true);
  const lon = nmeaCoord(pos.lon, false);
  const course = config.simulator.courseDeg.toFixed(1);
  const speed = config.simulator.speedKnots.toFixed(1);
  const windAngle = config.simulator.windAngleDeg.toFixed(1);
  const windSpeed = config.simulator.windSpeedKnots.toFixed(1);
  const depth = config.simulator.depthMeters.toFixed(1);
  const airTemp = config.simulator.airTempC.toFixed(1);
  const waterTemp = config.simulator.waterTempC.toFixed(1);
  const pressureBar = (config.simulator.barometerHpa / 1000).toFixed(4);

  return [
    nmeaSentence(`GPRMC,${time},A,${lat},${latHem},${lon},${lonHem},${speed},${course},${date},,,A`),
    nmeaSentence(`GPGGA,${time},${lat},${latHem},${lon},${lonHem},1,10,0.8,8.0,M,0.0,M,,`),
    nmeaSentence(`GPVTG,${course},T,,M,${speed},N,,K`),
    nmeaSentence(`HEHDT,${course},T`),
    nmeaSentence(`WIMWV,${windAngle},R,${windSpeed},N,A`),
    nmeaSentence(`SDDPT,${depth},0.0`),
    nmeaSentence(`YXMTW,${waterTemp},C`),
    nmeaSentence(`YXMTA,${airTemp},C`),
    nmeaSentence(`YXMMB,,I,${pressureBar},B`),
  ];
}

function startSimulator() {
  if (!config.simulator.enabled || simulatorTimer) return;
  simulatorStartedAtMs = Date.now();
  latest.gateway.simulatorActive = true;
  latest.gateway.inputSource = "simulator";
  log("info", "NMEA simulator started", {
    intervalSeconds: config.simulator.intervalSeconds,
    startLatitude: config.simulator.startLatitude,
    startLongitude: config.simulator.startLongitude,
  });
  const tick = () => {
    for (const sentence of simulatorSentences()) ingest(sentence, "simulator");
  };
  tick();
  simulatorTimer = setInterval(tick, Math.max(1, config.simulator.intervalSeconds) * 1000);
}

function stopSimulator() {
  if (!simulatorTimer) return;
  clearInterval(simulatorTimer);
  simulatorTimer = null;
  latest.gateway.simulatorActive = false;
  latest.gateway.status = latest.gateway.connectedClients > 0 ? "connected" : "waiting";
  log("info", "NMEA simulator stopped");
  emitState();
}
function startNmeaServer() {
  if (nmeaServer) return;
  nmeaServer = net.createServer((socket) => {
    latest.gateway.connectedClients += 1;
    latest.gateway.status = "connected";
    lineBufferBySocket.set(socket, "");
    log("info", "NMEA client connected", { remote: `${socket.remoteAddress}:${socket.remotePort}` });
    emitState();

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      let buffer = `${lineBufferBySocket.get(socket) || ""}${chunk}`;
      const sentences = buffer.split(/\r?\n/);
      buffer = sentences.pop() || "";
      lineBufferBySocket.set(socket, buffer);
      for (const sentence of sentences) ingest(sentence, "tcp");
    });
    socket.on("error", (error) => {
      latest.gateway.lastError = error.message;
      log("error", "NMEA socket error", { error: error.message });
      emitState();
    });
    socket.on("close", () => {
      latest.gateway.connectedClients = Math.max(0, latest.gateway.connectedClients - 1);
      latest.gateway.status = latest.gateway.simulatorActive ? "receiving" : latest.gateway.connectedClients > 0 ? "connected" : "waiting";
      log("info", "NMEA client disconnected");
      emitState();
    });
  });

  nmeaServer.on("error", (error) => {
    latest.gateway.status = "error";
    latest.gateway.lastError = error.message;
    log("error", "NMEA server error", { error: error.message });
    emitState();
    nmeaServer?.close();
    nmeaServer = null;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startNmeaServer();
      }, 5000);
    }
  });

  nmeaServer.listen(config.nmea.port, config.nmea.host, () => {
    latest.gateway.status = "waiting";
    latest.gateway.lastError = null;
    log("info", "NMEA listener started", { host: config.nmea.host, port: config.nmea.port });
    emitState();
  });
}

function originAllowed(origin) {
  if (!origin) return true;
  if (config.cors.allowedOrigins.includes("*")) return true;
  return config.cors.allowedOrigins.includes(origin);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": originAllowed(origin) ? origin || "*" : "null",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
}

function sendJson(req, res, body, status = 200) {
  res.writeHead(status, {
    ...corsHeaders(req),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function diagnostics() {
  const state = snapshot();
  return {
    ok: state.gateway.status !== "error",
    config: {
      vesselName: config.vesselName,
      nmea: config.nmea,
      http: config.http,
      staleTimeoutSeconds: config.staleTimeoutSeconds,
      historyPath,
      logPath,
      webAppDist: distDir,
    },
    state,
    files: {
      configExists: fs.existsSync(configPath),
      historyExists: fs.existsSync(historyPath),
      logExists: fs.existsSync(logPath),
      distExists: fs.existsSync(path.join(distDir, "index.html")),
    },
  };
}

function fmt(value, suffix = "") {
  return value == null ? "--" : `${value}${suffix}`;
}

function dashboardHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BridgeLog Gateway Dashboard</title><style>
body{margin:0;background:#e7f0f2;color:#10262f;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px}.card{background:#fbfefe;border:1px solid #c9dce2;border-radius:10px;padding:16px;margin:12px 0}
h1{margin:0 0 4px;font-size:30px}.muted{color:#5f7680}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.metric{background:#e2f2f3;border:1px solid #c9dce2;border-radius:8px;padding:12px}.metric span{display:block;font-size:11px;text-transform:uppercase;font-weight:800;color:#5f7680}.metric b{font-size:22px}
code{white-space:pre-wrap;word-break:break-word}.stale{color:#a33131}@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><main><h1>BridgeLog Gateway</h1><div class="muted" id="subtitle"></div>
<section class="card"><h2>Status</h2><div class="grid" id="status"></div></section>
<section class="card"><h2>Live Vessel Data</h2><div class="grid" id="vessel"></div></section>
<section class="card"><h2>Last NMEA Sentence</h2><code id="sentence">Waiting for NMEA...</code></section>
<script>
const statusEl = document.getElementById('status');
const vesselEl = document.getElementById('vessel');
const sentenceEl = document.getElementById('sentence');
const subtitleEl = document.getElementById('subtitle');
function metric(label, value, stale){return '<div class="metric '+(stale?'stale':'')+'"><span>'+label+'</span><b>'+value+'</b></div>'}
function render(state){
  const g=state.gateway, v=state.vessel, groups=state.groups||{};
  subtitleEl.textContent = g.vesselName + ' • NMEA ' + g.nmeaListenHost + ':' + g.nmeaListenPort + ' • HTTP ' + g.httpHost + ':' + g.httpPort;
  statusEl.innerHTML = metric('Gateway', g.status, g.stale) + metric('Clients', g.connectedClients) + metric('SSE', g.sseClients) + metric('Sentences', g.sentenceCount) + metric('Invalid', g.invalidSentenceCount) + metric('Age', g.ageSeconds == null ? '--' : g.ageSeconds + ' s', g.stale) + metric('Updated', g.lastUpdated ? new Date(g.lastUpdated).toLocaleTimeString() : '--') + metric('Error', g.lastError || '--');
  vesselEl.innerHTML = metric('GPS', (v.latitude?.toFixed?.(5) || '--') + ', ' + (v.longitude?.toFixed?.(5) || '--'), groups.gps?.stale) + metric('Heading', (v.headingDeg ?? '--') + '°', groups.heading?.stale) + metric('Speed', (v.speedKnots ?? '--') + ' kt', groups.speed?.stale) + metric('Course', (v.courseDeg ?? '--') + '°', groups.speed?.stale) + metric('Wind', (v.windAngleDeg ?? '--') + '° / ' + (v.windSpeedKnots ?? '--') + ' kt', groups.wind?.stale) + metric('Depth', (v.depthMeters ?? '--') + ' m', groups.depth?.stale) + metric('Air', (v.airTempC ?? '--') + ' °C', groups.environment?.stale) + metric('Water', (v.waterTempC ?? '--') + ' °C', groups.environment?.stale) + metric('Baro', (v.barometerHpa ?? '--') + ' hPa', groups.environment?.stale) + metric('Sentence', v.lastSentenceType || '--') + metric('GPS Quality', v.gpsQuality ?? '--', groups.gps?.stale);
  sentenceEl.textContent = v.lastSentence || 'Waiting for NMEA...';
}
fetch('/api/v1/state').then(r=>r.json()).then(render);
new EventSource('/api/v1/events').addEventListener('gateway-state', e => render(JSON.parse(e.data)));
</script></main></body></html>`;
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

function serveWebApp(req, res) {
  if (!config.webApp.serveDist) return false;
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) return false;
  const urlPath = decodeURIComponent(new URL(req.url, "http://gateway.local").pathname);
  const requested = urlPath === "/" ? indexPath : path.join(distDir, urlPath);
  if (!requested.startsWith(distDir)) return false;
  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) serveFile(res, requested);
  else serveFile(res, indexPath);
  return true;
}

function startHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/gateway" || pathname === "/dashboard") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(dashboardHtml());
      return;
    }
    if (pathname === "/api/v1/health" || pathname === "/api/health") return sendJson(req, res, { ok: true, gateway: snapshot().gateway });
    if (pathname === "/api/v1/state" || pathname === "/api/state" || pathname === "/api/gateway/state" || pathname === "/api/vessel-state") return sendJson(req, res, snapshot());
    if (pathname === "/api/v1/diagnostics" || pathname === "/api/diagnostics") return sendJson(req, res, diagnostics());
    if (pathname === "/api/v1/simulator/start" || pathname === "/api/simulator/start") {
      config.simulator.enabled = true;
      latest.gateway.simulatorEnabled = true;
      startSimulator();
      return sendJson(req, res, snapshot());
    }
    if (pathname === "/api/v1/simulator/stop" || pathname === "/api/simulator/stop") {
      config.simulator.enabled = false;
      latest.gateway.simulatorEnabled = false;
      stopSimulator();
      return sendJson(req, res, snapshot());
    }
    if (pathname === "/api/v1/history" || pathname === "/api/history") {
      try {
        const lines = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean).slice(-config.history.maxApiRows) : [];
        return sendJson(req, res, lines.map((line) => JSON.parse(line)));
      } catch (error) {
        return sendJson(req, res, { error: error.message }, 500);
      }
    }
    if (pathname === "/api/v1/events" || pathname === "/api/events") {
      res.writeHead(200, {
        ...corsHeaders(req),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      clients.add(res);
      emitState();
      req.on("close", () => clients.delete(res));
      return;
    }

    if (serveWebApp(req, res)) return;
    sendJson(req, res, { error: "Not found" }, 404);
  });

  server.listen(config.http.port, config.http.host, () => {
    log("info", "HTTP API/dashboard started", { host: config.http.host, port: config.http.port });
  });
}

ensureRuntimeDirs();
log("info", "BridgeLog Gateway starting", { configPath });
startNmeaServer();
startSimulator();
startHttpServer();
process.on("SIGINT", () => {
  stopSimulator();
  writeHistory(true);
  log("info", "BridgeLog Gateway stopped by SIGINT");
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopSimulator();
  writeHistory(true);
  log("info", "BridgeLog Gateway stopped by SIGTERM");
  process.exit(0);
});
