export type VesselPositionSourceStatus = "BR1 GPS (Live)" | "BR1 GPS (Stale)" | "IP Geolocation (Fallback)";

export type VesselPositionSourceType =
  | "peplink-br1"
  | "nmea-gateway"
  | "furuno-navigation-system"
  | "nmea2000-gateway"
  | "ip-geolocation";

export type VesselPosition = {
  latitude: number;
  longitude: number;
  timestamp: string;
  speedKts?: number | null;
  headingDeg?: number | null;
  sourceStatus: VesselPositionSourceStatus;
  sourceType: VesselPositionSourceType;
  receivedAt: string;
};

export type VesselPositionProvider = {
  getLatestPosition: () => Promise<VesselPosition | null>;
  subscribe: (listener: (position: VesselPosition | null) => void) => () => void;
};

type ProviderOptions = {
  gpsSourceUrl?: string;
  pollMs?: number;
  staleMs?: number;
};

const POLL_MS = 30_000;
const STALE_MS = 30 * 60_000;
const CACHE_KEY = "blp-vessel-position-cache";
const GPS_SOURCE_URL_STORAGE_KEY = "GPS_SOURCE_URL";

type AnyRecord = Record<string, unknown>;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function getConfiguredGpsSourceUrl(): string {
  if (hasWindow()) {
    const stored = window.localStorage.getItem(GPS_SOURCE_URL_STORAGE_KEY)?.trim();
    if (stored) return stored;
  }

  return String(import.meta.env.VITE_GPS_SOURCE_URL ?? import.meta.env.GPS_SOURCE_URL ?? "").trim();
}

export function setConfiguredGpsSourceUrl(value: string): void {
  if (!hasWindow()) return;
  const trimmed = value.trim();
  if (trimmed) window.localStorage.setItem(GPS_SOURCE_URL_STORAGE_KEY, trimmed);
  else window.localStorage.removeItem(GPS_SOURCE_URL_STORAGE_KEY);
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
    [r.data, r.status, r.response, r.result].forEach((child) => {
      if (!child || typeof child !== "object" || Array.isArray(child)) return;
      const c = child as AnyRecord;
      [c.gps, c.gnss, c.location, c.position].forEach(pushRecord);
    });
  }

  return candidates;
}

function parseGpsPayload(payload: unknown): Pick<VesselPosition, "latitude" | "longitude" | "timestamp" | "speedKts" | "headingDeg"> | null {
  const latKeys = ["latitude", "lat", "gpsLatitude", "gps_latitude", "gpsLat", "gps_lat"];
  const lonKeys = ["longitude", "lon", "lng", "gpsLongitude", "gps_longitude", "gpsLon", "gps_lon", "gpsLng"];
  const timeKeys = ["timestamp", "time", "datetime", "dateTime", "gpsTime", "gps_time", "fixTime", "fix_time"];
  const speedKeys = ["speedKts", "speedKnots", "speed_knots", "speed", "sog", "speedOverGround", "speed_over_ground"];
  const headingKeys = ["headingDeg", "heading", "course", "cog", "courseOverGround", "course_over_ground", "bearing"];

  for (const candidate of objectCandidates(payload)) {
    const latitude = parseNumber(pick(candidate, latKeys));
    const longitude = parseNumber(pick(candidate, lonKeys));
    if (latitude == null || longitude == null) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;

    return {
      latitude,
      longitude,
      timestamp: parseTimestamp(pick(candidate, timeKeys)) ?? new Date().toISOString(),
      speedKts: parseNumber(pick(candidate, speedKeys)),
      headingDeg: parseNumber(pick(candidate, headingKeys)),
    };
  }

  return null;
}

function readCachedPosition(): VesselPosition | null {
  if (!hasWindow()) return null;
  const raw = window.localStorage.getItem(CACHE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as VesselPosition;
    if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedPosition(position: VesselPosition): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(position));
}

async function readBr1Gps(gpsSourceUrl: string): Promise<VesselPosition | null> {
  if (!gpsSourceUrl) return null;

  const response = await fetch(gpsSourceUrl, {
    cache: "no-store",
    headers: { Accept: "application/json, text/plain;q=0.8" },
  });
  if (!response.ok) throw new Error(`BR1 GPS HTTP ${response.status}`);

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    const query = new URLSearchParams(text);
    payload = Object.fromEntries(query.entries());
  }

  const parsed = parseGpsPayload(payload);
  if (!parsed) return null;

  return {
    ...parsed,
    sourceStatus: "BR1 GPS (Live)",
    sourceType: "peplink-br1",
    receivedAt: new Date().toISOString(),
  };
}

async function readIpFallback(): Promise<VesselPosition | null> {
  const response = await fetch("https://ipapi.co/json/", { cache: "no-store" });
  if (!response.ok) throw new Error(`IP geolocation HTTP ${response.status}`);
  const payload = (await response.json()) as AnyRecord;
  const latitude = parseNumber(payload.latitude ?? payload.lat);
  const longitude = parseNumber(payload.longitude ?? payload.lon ?? payload.lng);
  if (latitude == null || longitude == null) return null;

  const now = new Date().toISOString();
  return {
    latitude,
    longitude,
    timestamp: now,
    speedKts: null,
    headingDeg: null,
    sourceStatus: "IP Geolocation (Fallback)",
    sourceType: "ip-geolocation",
    receivedAt: now,
  };
}

function withStaleStatus(position: VesselPosition): VesselPosition {
  return { ...position, sourceStatus: "BR1 GPS (Stale)" };
}

function cacheAgeMs(position: VesselPosition, now = Date.now()): number {
  const received = new Date(position.receivedAt).getTime();
  return Number.isFinite(received) ? now - received : Number.POSITIVE_INFINITY;
}

export function createVesselPositionProvider(options: ProviderOptions = {}): VesselPositionProvider {
  const pollMs = options.pollMs ?? POLL_MS;
  const staleMs = options.staleMs ?? STALE_MS;
  const gpsSourceUrl = options.gpsSourceUrl ?? getConfiguredGpsSourceUrl();
  let firstUnavailableAt: number | null = null;

  async function getLatestPosition(): Promise<VesselPosition | null> {
    try {
      const live = await readBr1Gps(gpsSourceUrl);
      if (live) {
        firstUnavailableAt = null;
        writeCachedPosition(live);
        return live;
      }
    } catch {
      // BR1 may be offline, blocked by auth/CORS, or temporarily unavailable. Cached position handles continuity.
    }

    firstUnavailableAt ??= Date.now();
    const cached = readCachedPosition();
    if (cached) {
      if (cacheAgeMs(cached) <= staleMs) return withStaleStatus(cached);

      try {
        const fallback = await readIpFallback();
        if (fallback) return fallback;
      } catch {
        // If fallback is also unavailable, keep showing the last known vessel fix.
      }

      return withStaleStatus(cached);
    }

    if (Date.now() - firstUnavailableAt > staleMs) {
      try {
        return await readIpFallback();
      } catch {
        return null;
      }
    }

    return null;
  }

  function subscribe(listener: (position: VesselPosition | null) => void): () => void {
    let stopped = false;

    const poll = async () => {
      const position = await getLatestPosition();
      if (!stopped) listener(position);
    };

    void poll();
    const timer = window.setInterval(poll, pollMs);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }

  return { getLatestPosition, subscribe };
}

