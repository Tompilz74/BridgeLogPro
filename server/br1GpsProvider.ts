import http from "node:http";
import https from "node:https";
type Br1PositionStatus = "live" | "stale" | "unavailable";
type Br1PositionSource = "BR1_GPS" | "IP_LOCATION";

export type VesselPositionApiResponse = {
  source: Br1PositionSource;
  status: Br1PositionStatus;
  latitude: number | null;
  longitude: number | null;
  timestamp: string | null;
  speedKnots: number | null;
  courseDeg: number | null;
};

type BR1GpsProviderOptions = {
  baseUrl: string;
  username?: string;
  password?: string;
  gpsPath?: string;
  staleMs?: number;
};

type GpsFix = {
  latitude: number;
  longitude: number;
  timestamp: string;
  speedKnots: number | null;
  courseDeg: number | null;
  receivedAt: number;
};

type AnyRecord = Record<string, unknown>;

const DEFAULT_BR1_BASE_URL = "http://192.168.50.1";
const STALE_MS = 30 * 60_000;

function jsonResponse(res: http.ServerResponse, status: number, body: VesselPositionApiResponse) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function validBaseUrl(value: string | undefined): string {
  const raw = (value || DEFAULT_BR1_BASE_URL).trim();
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_BR1_BASE_URL;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return parseTimestamp(numeric);

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function pick(record: AnyRecord, names: string[]): unknown {
  for (const name of names) {
    if (name in record) return record[name];
  }
  return undefined;
}

function objectCandidates(payload: unknown): AnyRecord[] {
  const roots = Array.isArray(payload) ? payload : [payload];
  const candidates: AnyRecord[] = [];
  const pushRecord = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) candidates.push(value as AnyRecord);
  };

  for (const root of roots) {
    pushRecord(root);
    if (!root || typeof root !== "object" || Array.isArray(root)) continue;
    const r = root as AnyRecord;
    [r.gps, r.gnss, r.location, r.position, r.data, r.status, r.response, r.result].forEach(pushRecord);
    [r.response, r.data, r.result].forEach((child) => {
      if (!child || typeof child !== "object" || Array.isArray(child)) return;
      const c = child as AnyRecord;
      [c.location, c.gps, c.gnss, c.position].forEach(pushRecord);
    });
    [r.data, r.status, r.response, r.result].forEach((child) => {
      if (!child || typeof child !== "object" || Array.isArray(child)) return;
      const c = child as AnyRecord;
      [c.gps, c.gnss, c.location, c.position].forEach(pushRecord);
    });
  }

  return candidates;
}

function parseJsonPosition(payload: unknown): Omit<GpsFix, "receivedAt"> | null {
  const latKeys = ["latitude", "lat", "gpsLatitude", "gps_latitude", "gpsLat", "gps_lat"];
  const lonKeys = ["longitude", "lon", "lng", "gpsLongitude", "gps_longitude", "gpsLon", "gps_lon", "gpsLng"];
  const timeKeys = ["timestamp", "time", "datetime", "dateTime", "gpsTime", "gps_time", "fixTime", "fix_time"];
  const speedKeys = ["speedKnots", "speedKts", "speed_knots", "speed", "sog", "speedOverGround", "speed_over_ground"];
  const courseKeys = ["courseDeg", "headingDeg", "heading", "course", "cog", "courseOverGround", "course_over_ground", "bearing"];

  for (const candidate of objectCandidates(payload)) {
    const latitude = parseNumber(pick(candidate, latKeys));
    const longitude = parseNumber(pick(candidate, lonKeys));
    if (latitude == null || longitude == null) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;

    return {
      latitude,
      longitude,
      timestamp: parseTimestamp(pick(candidate, timeKeys)) ?? new Date().toISOString(),
      speedKnots: parseNumber(pick(candidate, speedKeys)),
      courseDeg: parseNumber(pick(candidate, courseKeys)),
    };
  }

  return null;
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']+)["']/g)) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

function tagValue(body: string, names: string[]): string | null {
  for (const name of names) {
    const match = body.match(new RegExp(`<[^:>]*(?::)?${name}[^>]*>([^<]+)<\\/[^>]+>`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function parseGpxPosition(text: string): Omit<GpsFix, "receivedAt"> | null {
  const points: Array<Omit<GpsFix, "receivedAt">> = [];
  const pointPattern = /<(trkpt|wpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  for (const match of text.matchAll(pointPattern)) {
    const attrs = parseAttributes(match[2]);
    const latitude = parseNumber(attrs.lat);
    const longitude = parseNumber(attrs.lon);
    if (latitude == null || longitude == null) continue;

    const body = match[3] ?? "";
    points.push({
      latitude,
      longitude,
      timestamp: parseTimestamp(tagValue(body, ["time", "timestamp"])) ?? new Date().toISOString(),
      speedKnots: parseNumber(tagValue(body, ["speed", "speedKnots", "sog"])),
      courseDeg: parseNumber(tagValue(body, ["course", "courseDeg", "cog", "heading"])),
    });
  }

  return points.at(-1) ?? null;
}

function parseGpsText(text: string): Omit<GpsFix, "receivedAt"> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    const jsonPosition = parseJsonPosition(parsed);
    if (jsonPosition) return jsonPosition;
  } catch {
    // Not JSON; try GPX/XML/form-style data below.
  }

  const gpxPosition = parseGpxPosition(text);
  if (gpxPosition) return gpxPosition;

  const query = new URLSearchParams(text);
  return parseJsonPosition(Object.fromEntries(query.entries()));
}

type Br1RequestOptions = {
  method: string;
  headers: Record<string, string>;
  body?: string;
};

function requestText(url: string, options: Br1RequestOptions, redirects = 0): Promise<{ status: number; ok: boolean; headers: Record<string, string | string[]>; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isHttps = target.protocol === "https:";
    const request = (isHttps ? https : http).request(
      target,
      {
        method: options.method,
        headers: options.headers,
        timeout: 10_000,
        rejectUnauthorized: false,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (location && status >= 300 && status < 400 && redirects < 3) {
          response.resume();
          const nextUrl = new URL(location, target).toString();
          requestText(nextUrl, options, redirects + 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const headers: Record<string, string | string[]> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string" || Array.isArray(value)) headers[key.toLowerCase()] = value;
          }
          resolve({ status, ok: status >= 200 && status < 300, headers, text: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error(`BR1 request timeout for ${target.origin}`));
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}
function toResponse(source: Br1PositionSource, status: Br1PositionStatus, fix: GpsFix | null): VesselPositionApiResponse {
  return {
    source,
    status,
    latitude: fix?.latitude ?? null,
    longitude: fix?.longitude ?? null,
    timestamp: fix?.timestamp ?? null,
    speedKnots: fix?.speedKnots ?? null,
    courseDeg: fix?.courseDeg ?? null,
  };
}

export class BR1GpsProvider {
  private readonly baseUrl: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly gpsPath?: string;
  private readonly staleMs: number;
  private cookieHeader = "";
  private lastValid: GpsFix | null = null;

  constructor(options: BR1GpsProviderOptions) {
    this.baseUrl = validBaseUrl(options.baseUrl);
    this.username = options.username?.trim() || undefined;
    this.password = options.password || undefined;
    this.gpsPath = options.gpsPath?.trim() || undefined;
    this.staleMs = options.staleMs ?? STALE_MS;
  }

  async getPosition(): Promise<VesselPositionApiResponse> {
    const live = await this.readLivePosition();
    if (live) {
      this.lastValid = { ...live, receivedAt: Date.now() };
      return toResponse("BR1_GPS", "live", this.lastValid);
    }

    if (this.lastValid) {
      const ageMs = Date.now() - this.lastValid.receivedAt;
      return toResponse("BR1_GPS", ageMs < this.staleMs ? "stale" : "unavailable", this.lastValid);
    }

    const fallback = await this.readIpFallback();
    if (fallback) return toResponse("IP_LOCATION", "live", fallback);

    return toResponse("BR1_GPS", "unavailable", null);
  }

  private async readLivePosition(): Promise<Omit<GpsFix, "receivedAt"> | null> {
    if (this.username && this.password && !this.cookieHeader) await this.authenticate();

    const paths = this.gpsPath
      ? [this.gpsPath]
      : [
          "/cgi-bin/MANGA/api.cgi?func=info.location",
          "/gps.gpx",
          "/gps.xml",
          "/gps",
          "/api/gps",
          "/api/status/gps",
          "/api/status.gps",
          "/cgi-bin/MANGA/api.cgi?func=status.gps",
          "/cgi-bin/MANGA/api.cgi?func=gps",
          "/cgi-bin/MANGA/gps.gpx",
        ];

    for (const path of paths) {
      const text = await this.fetchText(path);
      if (!text) continue;
      const parsed = parseGpsText(text);
      if (parsed) return parsed;
    }

    return null;
  }

  private async fetchText(path: string): Promise<string | null> {
    const response = await this.fetchBr1(path);
    if (response.status === 401 || response.status === 403 || this.looksLikeLogin(response)) {
      await this.authenticate();
      const retry = await this.fetchBr1(path);
      if (!retry.ok) return null;
      return retry.text;
    }

    if (!response.ok) return null;
    return response.text;
  }

  private async fetchBr1(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    const headers: Record<string, string> = {
      Accept: "application/json, application/gpx+xml, application/xml, text/xml, text/plain;q=0.8",
      ...(init.headers ?? {}),
    };
    if (this.cookieHeader) headers.Cookie = this.cookieHeader;
    if (this.username && this.password && !headers.Authorization) {
      headers.Authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
    }

    const response = await requestText(joinUrl(this.baseUrl, path), {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    });
    this.storeCookies(response.headers["set-cookie"]);
    return response;
  }

  private async authenticate(): Promise<void> {
    if (!this.username || !this.password) return;

    const form = new URLSearchParams({ username: this.username, password: this.password }).toString();
    const loginPaths = ["/api/login", "/cgi-bin/MANGA/index.cgi", "/cgi-bin/MANGA/api.cgi"];

    for (const path of loginPaths) {
      try {
        const response = await this.fetchBr1(path, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
        if (response.ok || response.status === 302 || response.status === 303) return;
      } catch {
        // Try the next known login path.
      }
    }
  }

  private storeCookies(setCookie: string | string[] | undefined): void {
    if (!setCookie) return;
    const values = Array.isArray(setCookie) ? setCookie : [setCookie];
    this.cookieHeader = values
      .flatMap((value) => value.split(/,(?=\s*[^;=]+=[^;]+)/))
      .map((cookie) => cookie.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  }

  private looksLikeLogin(response: Awaited<ReturnType<typeof requestText>>): boolean {
    const contentType = response.headers["content-type"] ?? "";
    if (!contentType.includes("text/html")) return false;
    return /password|login|sign in/i.test(response.text);
  }

  private async readIpFallback(): Promise<GpsFix | null> {
    try {
      const response = await fetch("https://ipapi.co/json/", { cache: "no-store" });
      if (!response.ok) return null;
      const payload = (await response.json()) as AnyRecord;
      const latitude = parseNumber(payload.latitude ?? payload.lat);
      const longitude = parseNumber(payload.longitude ?? payload.lon ?? payload.lng);
      if (latitude == null || longitude == null) return null;
      const now = new Date().toISOString();
      return { latitude, longitude, timestamp: now, speedKnots: null, courseDeg: null, receivedAt: Date.now() };
    } catch {
      return null;
    }
  }
}

export function createVesselPositionApiHandler(options: BR1GpsProviderOptions) {
  const provider = new BR1GpsProvider(options);

  return async (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
    if (req.method !== "GET") {
      next();
      return;
    }

    try {
      const position = await provider.getPosition();
      jsonResponse(res, 200, position);
    } catch {
      jsonResponse(res, 200, toResponse("BR1_GPS", "unavailable", null));
    }
  };
}

