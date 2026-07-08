import { EventEmitter } from "node:events";
import net from "node:net";

export type ConnectionStatus = "waiting" | "connected" | "receiving" | "simulator" | "error";

export type NavSnapshot = {
  latitude: number | null;
  longitude: number | null;
  timestamp: string | null;
  speedKnots: number | null;
  courseDeg: number | null;
  headingDeg: number | null;
  windAngleDeg: number | null;
  windSpeedKnots: number | null;
  windReference: "relative" | "true" | null;
  depthMeters: number | null;
  lastSentence: string | null;
  updatedAt: string | null;
};

export type NmeaFeedState = {
  status: ConnectionStatus;
  listenHost: string;
  listenPort: number;
  simulatorEnabled: boolean;
  connectedClients: number;
  sentenceCount: number;
  lastError: string | null;
  snapshot: NavSnapshot;
};

export type NmeaTcpServerOptions = {
  listenHost: string;
  listenPort: number;
  simulatorEnabled?: boolean;
  reconnectMs?: number;
};

const emptySnapshot: NavSnapshot = {
  latitude: null,
  longitude: null,
  timestamp: null,
  speedKnots: null,
  courseDeg: null,
  headingDeg: null,
  windAngleDeg: null,
  windSpeedKnots: null,
  windReference: null,
  depthMeters: null,
  lastSentence: null,
  updatedAt: null,
};

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLatLon(value: string | undefined, hemi: string | undefined): number | null {
  if (!value || !hemi) return null;
  const dot = value.indexOf(".");
  const degLen = dot > 4 ? 3 : 2;
  const deg = Number(value.slice(0, degLen));
  const min = Number(value.slice(degLen));
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  const sign = /[SW]/i.test(hemi) ? -1 : 1;
  return sign * (deg + min / 60);
}

function parseTime(dateField: string | undefined, timeField: string | undefined): string | null {
  if (!timeField || timeField.length < 6) return null;
  const hh = timeField.slice(0, 2);
  const mm = timeField.slice(2, 4);
  const ss = timeField.slice(4, 6);

  if (dateField && dateField.length >= 6) {
    const dd = dateField.slice(0, 2);
    const mo = dateField.slice(2, 4);
    const yy = Number(dateField.slice(4, 6));
    const yyyy = yy >= 80 ? 1900 + yy : 2000 + yy;
    return new Date(`${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`).toISOString();
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return new Date(`${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`).toISOString();
}

function knotsFromWind(speed: string | undefined, unit: string | undefined): number | null {
  const value = parseNumber(speed);
  if (value == null) return null;
  if (unit?.toUpperCase() === "M") return value * 1.943844;
  if (unit?.toUpperCase() === "K") return value * 0.539957;
  return value;
}

function metersFromDepth(value: string | undefined, unit: string | undefined): number | null {
  const depth = parseNumber(value);
  if (depth == null) return null;
  if (unit?.toUpperCase() === "f".toUpperCase()) return depth * 0.3048;
  if (unit?.toUpperCase() === "M") return depth;
  return depth;
}

function validChecksum(sentence: string): boolean {
  const star = sentence.indexOf("*");
  if (star === -1) return true;
  const provided = sentence.slice(star + 1).trim().slice(0, 2).toUpperCase();
  let checksum = 0;
  for (const ch of sentence.slice(1, star)) checksum ^= ch.charCodeAt(0);
  return checksum.toString(16).toUpperCase().padStart(2, "0") === provided;
}

function sentenceWithChecksum(body: string): string {
  let checksum = 0;
  for (const ch of body) checksum ^= ch.charCodeAt(0);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, "0")}`;
}

export function parseNmeaSentence(sentence: string, previous: NavSnapshot): NavSnapshot | null {
  const clean = sentence.trim();
  if (!clean.startsWith("$") || !validChecksum(clean)) return null;

  const body = clean.slice(1, clean.indexOf("*") === -1 ? undefined : clean.indexOf("*"));
  const fields = body.split(",");
  const formatter = fields[0] ?? "";
  const type = formatter.slice(-3).toUpperCase();
  const next: NavSnapshot = { ...previous, lastSentence: clean, updatedAt: new Date().toISOString() };

  if (type === "GGA") {
    next.timestamp = parseTime(undefined, fields[1]) ?? next.timestamp;
    next.latitude = parseLatLon(fields[2], fields[3]) ?? next.latitude;
    next.longitude = parseLatLon(fields[4], fields[5]) ?? next.longitude;
    return next;
  }

  if (type === "RMC") {
    next.timestamp = parseTime(fields[9], fields[1]) ?? next.timestamp;
    next.latitude = parseLatLon(fields[3], fields[4]) ?? next.latitude;
    next.longitude = parseLatLon(fields[5], fields[6]) ?? next.longitude;
    next.speedKnots = parseNumber(fields[7]) ?? next.speedKnots;
    next.courseDeg = parseNumber(fields[8]) ?? next.courseDeg;
    return next;
  }

  if (type === "VTG") {
    next.courseDeg = parseNumber(fields[1]) ?? next.courseDeg;
    next.speedKnots = parseNumber(fields[5]) ?? next.speedKnots;
    return next;
  }

  if (type === "HDT" || type === "HDG") {
    next.headingDeg = parseNumber(fields[1]) ?? next.headingDeg;
    return next;
  }

  if (type === "MWV") {
    next.windAngleDeg = parseNumber(fields[1]) ?? next.windAngleDeg;
    next.windReference = fields[2]?.toUpperCase() === "T" ? "true" : fields[2]?.toUpperCase() === "R" ? "relative" : next.windReference;
    next.windSpeedKnots = knotsFromWind(fields[3], fields[4]) ?? next.windSpeedKnots;
    return next;
  }

  if (type === "DBT") {
    next.depthMeters = metersFromDepth(fields[3], fields[4]) ?? next.depthMeters;
    return next;
  }

  if (type === "DPT") {
    next.depthMeters = parseNumber(fields[1]) ?? next.depthMeters;
    return next;
  }

  return null;
}

export class NmeaTcpServer extends EventEmitter {
  private readonly options: NmeaTcpServerOptions;
  private server: net.Server | null = null;
  private simulatorTimer: NodeJS.Timeout | null = null;
  private status: ConnectionStatus = "waiting";
  private connectedClients = 0;
  private sentenceCount = 0;
  private lastError: string | null = null;
  private snapshot: NavSnapshot = { ...emptySnapshot };

  constructor(options: NmeaTcpServerOptions) {
    super();
    this.options = options;
  }

  start(): void {
    if (this.server) return;
    this.server = net.createServer((socket) => this.handleSocket(socket));
    this.server.on("error", (error) => {
      this.lastError = error.message;
      this.status = "error";
      this.emitState();
    });
    this.server.listen(this.options.listenPort, this.options.listenHost, () => {
      this.status = this.options.simulatorEnabled ? "simulator" : "waiting";
      this.emitState();
    });

    if (this.options.simulatorEnabled) this.startSimulator();
  }

  getState(): NmeaFeedState {
    return {
      status: this.status,
      listenHost: this.options.listenHost,
      listenPort: this.options.listenPort,
      simulatorEnabled: Boolean(this.options.simulatorEnabled),
      connectedClients: this.connectedClients,
      sentenceCount: this.sentenceCount,
      lastError: this.lastError,
      snapshot: this.snapshot,
    };
  }

  private handleSocket(socket: net.Socket): void {
    this.connectedClients += 1;
    this.status = "connected";
    this.emitState();

    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const sentences = buffer.split(/\r?\n/);
      buffer = sentences.pop() ?? "";
      for (const sentence of sentences) this.ingest(sentence);
    });
    socket.on("error", (error) => {
      this.lastError = error.message;
      this.emitState();
    });
    socket.on("close", () => {
      this.connectedClients = Math.max(0, this.connectedClients - 1);
      this.status = this.connectedClients > 0 ? "connected" : this.options.simulatorEnabled ? "simulator" : "waiting";
      this.emitState();
    });
  }

  private ingest(sentence: string): void {
    const parsed = parseNmeaSentence(sentence, this.snapshot);
    if (!parsed) return;
    this.snapshot = parsed;
    this.sentenceCount += 1;
    this.status = this.connectedClients > 0 ? "receiving" : this.options.simulatorEnabled ? "simulator" : this.status;
    this.emitState();
  }

  private startSimulator(): void {
    if (this.simulatorTimer) return;
    let tick = 0;
    const baseLat = -17.7726;
    const baseLon = 177.3835;
    this.simulatorTimer = setInterval(() => {
      tick += 1;
      const lat = baseLat + Math.sin(tick / 18) * 0.006;
      const lon = baseLon + Math.cos(tick / 22) * 0.008;
      const speed = 8.2 + Math.sin(tick / 8) * 1.3;
      const course = (72 + tick * 2) % 360;
      const heading = (course + 3) % 360;
      this.ingest(sentenceWithChecksum(`GPRMC,${this.nmeaTime()},A,${this.nmeaLat(lat)},${lat < 0 ? "S" : "N"},${this.nmeaLon(lon)},${lon < 0 ? "W" : "E"},${speed.toFixed(1)},${course.toFixed(0)},${this.nmeaDate()},,,A`));
      this.ingest(sentenceWithChecksum(`GPVTG,${course.toFixed(0)},T,,M,${speed.toFixed(1)},N,,K,A`));
      this.ingest(sentenceWithChecksum(`GPHDT,${heading.toFixed(0)},T`));
      this.ingest(sentenceWithChecksum(`IIMWV,045,R,12.4,N,A`));
      this.ingest(sentenceWithChecksum(`SDDPT,18.7,0.4`));
    }, 2000);
  }

  private nmeaTime(): string {
    const d = new Date();
    return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}${String(d.getUTCSeconds()).padStart(2, "0")}`;
  }

  private nmeaDate(): string {
    const d = new Date();
    return `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCFullYear()).slice(-2)}`;
  }

  private nmeaLat(lat: number): string {
    const abs = Math.abs(lat);
    const deg = Math.floor(abs);
    return `${String(deg).padStart(2, "0")}${((abs - deg) * 60).toFixed(4).padStart(7, "0")}`;
  }

  private nmeaLon(lon: number): string {
    const abs = Math.abs(lon);
    const deg = Math.floor(abs);
    return `${String(deg).padStart(3, "0")}${((abs - deg) * 60).toFixed(4).padStart(7, "0")}`;
  }

  private emitState(): void {
    this.emit("state", this.getState());
  }
}
