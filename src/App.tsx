import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  createTabletGpsPositionProvider,
  createVesselPositionProvider,
  type VesselPosition,
} from "./services/VesselPositionProvider";

/* =========================================================
   Supabase Config
========================================================= */
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://hwjxojkkmvqpwsuxbjlw.supabase.co";

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3anhvamtrbXZxcHdzdXhiamx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDgzMTgsImV4cCI6MjA4MTE4NDMxOH0.00_yWsIDZdbdlSMlT5sxubiaEsw6FHXxxzcyt7fW2FI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WEATHER_REFRESH_MS = 10 * 60_000;
const BELUGA_LOGIN_EMAIL = "beluga@morrisnautical.com.au";

/* =========================================================
   Types
========================================================= */
type Theme = "dark" | "light";
type PositionSourceMode = "auto" | "tablet" | "network";

type VesselDetails = {
  name?: string;
  callSign?: string;
  mmsi?: string;
  imo?: string;
  officialNo?: string;
  master?: string;
  notes?: string;
};

type PosState = {
  latDeg: string;
  latMin: string;
  latMinDec: string; // decimal minutes (0–999)
  latHem: "N" | "S";
  lonDeg: string;
  lonMin: string;
  lonMinDec: string; // decimal minutes (0–999)
  lonHem: "E" | "W";
};

type DailyState = {
  date: string; // YYYY-MM-DD
  location: string;
  mode: "Along" | "@Anchor" | "Underway" | "Moored";
};

type Note = { date: string; time: string; text: string };

type RunningEntry = {
  date: string;
  time: string;
  position: string;

  courseMagnetic: string;
  courseGyro: string;
  courseSteering: string;

  speed: string;
  windDir: string;
  windForce: string;
  sea: string;
  sky: string;
  visibility: string;
  barometer: string;
  airTemp: string;
  seaTemp: string;
  engines: string;
  watchkeeper: string;
  remarks: string;

  totalFuel: string;
};

type WeatherState = {
  tempC?: number | null;
  windKts?: number | null;
  windDir?: number | null;
  windGustKts?: number | null;
  pressure?: number | null;
  visibilityKm?: number | null;
  weatherCode?: number | null;
  condition?: string | null;
  precipMmHr?: number | null;
  humidityPct?: number | null;
  cloudPct?: number | null;
  dewPointC?: number | null;
  waveHeightM?: number | null;
  wavePeriodS?: number | null;
  waveDirDeg?: number | null;
};

type NmeaConnectionStatus = "waiting" | "connected" | "receiving" | "simulator" | "error";

type NmeaSnapshot = {
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

type NmeaFeedState = {
  status: NmeaConnectionStatus;
  listenHost: string;
  listenPort: number;
  simulatorEnabled: boolean;
  connectedClients: number;
  sentenceCount: number;
  lastError: string | null;
  snapshot: NmeaSnapshot;
};

type HistoryDay = {
  date: string;
  location: string;
  vesselMode: DailyState["mode"];
  vessel: VesselDetails;
  notes: Note[];
  weather: WeatherState;
  runningLog: RunningEntry[];
  fuelSummary?: {
    usedLitres?: number;
    lastTotalFuel?: number | null;
  };
};

type AppState = {
  vessel: VesselDetails;
  watchkeeper: string;
  notes: Note[];
  log: RunningEntry[];
  history: HistoryDay[];
  pos: PosState;
  daily: DailyState;
  coords: { lat: number | null; lon: number | null };
  locLabel: string;
  lastWeather: WeatherState;
  updatedAtISO?: string;
};

/* =========================================================
   Constants
========================================================= */
const BEAUFORT: Array<{ force: number; wind: string; wave: string }> = [
  { force: 0, wind: "<1 kt", wave: "0 m" },
  { force: 1, wind: "1–3 kt", wave: "0–0.1 m" },
  { force: 2, wind: "4–6 kt", wave: "0.1–0.5 m" },
  { force: 3, wind: "7–10 kt", wave: "0.5–1.25 m" },
  { force: 4, wind: "11–16 kt", wave: "1–2 m" },
  { force: 5, wind: "17–21 kt", wave: "2–3 m" },
  { force: 6, wind: "22–27 kt", wave: "3–4 m" },
  { force: 7, wind: "28–33 kt", wave: "4–5.5 m" },
  { force: 8, wind: "34–40 kt", wave: "5.5–7.5 m" },
  { force: 9, wind: "41–47 kt", wave: "7–10 m" },
  { force: 10, wind: "48–55 kt", wave: "9–12.5 m" },
  { force: 11, wind: "56–63 kt", wave: "11.5–16 m" },
  { force: 12, wind: "64+ kt", wave: ">14 m" },
];

const VIS: Array<{ label: string; range: string }> = [
  { label: "Very poor", range: "<0.5 nm" },
  { label: "Poor", range: "0.5–2 nm" },
  { label: "Moderate", range: "2–5 nm" },
  { label: "Good", range: "5–10 nm" },
  { label: "Very good", range: "10–25 nm" },
  { label: "Excellent", range: ">25 nm" },
];

const SKY: Array<{ code: string; label: string }> = [
  { code: "bc", label: "Blue/clear" },
  { code: "ci", label: "Cirrus" },
  { code: "cs", label: "Cirrostratus" },
  { code: "st", label: "Stratus" },
  { code: "sc", label: "Stratocumulus" },
  { code: "cu", label: "Cumulus" },
  { code: "cb", label: "Cumulonimbus" },
  { code: "fg", label: "Fog" },
  { code: "hz", label: "Haze" },
  { code: "dz", label: "Drizzle" },
  { code: "ra", label: "Rain" },
  { code: "+ra", label: "Heavy rain" },
  { code: "ts", label: "Thunderstorm" },
];

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ hail",
  99: "Severe thunderstorm w/ hail",
};

function wxIcon(code?: number | null): string {
  const m: Record<number, string> = {
    0: "☀️",
    1: "🌤️",
    2: "⛅",
    3: "☁️",
    45: "🌫️",
    48: "🌫️",
    51: "🌦️",
    53: "🌦️",
    55: "🌧️",
    56: "🌧️",
    57: "🌧️",
    61: "🌧️",
    63: "🌧️",
    65: "🌧️",
    66: "🌧️",
    67: "🌧️",
    80: "🌧️",
    81: "🌧️",
    82: "🌧️",
    95: "⛈️",
    96: "⛈️",
    99: "⛈️",
  };
  if (code == null) return "☁️";
  return m[code] ?? "☁️";
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function prettyDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function downloadJSON(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
  }, 0);
}

function safeParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseNumberLoose(s: string): number | null {
  const t = (s ?? "").toString().trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function emptyNmeaSnapshot(): NmeaSnapshot {
  return {
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
}

function defaultNmeaFeedState(): NmeaFeedState {
  return {
    status: "waiting",
    listenHost: "0.0.0.0",
    listenPort: 10110,
    simulatorEnabled: false,
    connectedClients: 0,
    sentenceCount: 0,
    lastError: null,
    snapshot: emptyNmeaSnapshot(),
  };
}

function formatMaybe(value: number | null | undefined, suffix = "", digits = 1): string {
  return value == null ? "--" : `${value.toFixed(digits)}${suffix}`;
}

/* =========================================================
   State normalize (backward compatible)
========================================================= */
function normalizeBackupToState(obj: unknown): AppState | null {
  const fallback: AppState = defaultState();

  if (!obj || typeof obj !== "object") return null;

  const asAny = obj as Record<string, unknown>;
  const src = (asAny.kind === "BridgeLogProBackup" && asAny.state ? asAny.state : obj) as unknown;

  if (!src || typeof src !== "object") return null;
  const s = src as Record<string, unknown>;

  const vessel = s.vessel && typeof s.vessel === "object" ? (s.vessel as VesselDetails) : {};
  const notes = Array.isArray(s.notes) ? (s.notes as Note[]) : [];
  const log = Array.isArray(s.log) ? (s.log as any[]) : [];
  const history = Array.isArray(s.history) ? (s.history as any[]) : [];

  const pos = s.pos && typeof s.pos === "object" ? (s.pos as PosState) : fallback.pos;
  const daily = s.daily && typeof s.daily === "object" ? (s.daily as DailyState) : fallback.daily;

  const coords =
    s.coords && typeof s.coords === "object"
      ? (s.coords as { lat: number | null; lon: number | null })
      : fallback.coords;

  const watchkeeper = typeof s.watchkeeper === "string" ? s.watchkeeper : "";
  const locLabel = typeof s.locLabel === "string" ? s.locLabel : fallback.locLabel;

  const lastWeather =
    s.lastWeather && typeof s.lastWeather === "object" ? (s.lastWeather as WeatherState) : fallback.lastWeather;

  const normalizedLog: RunningEntry[] = log
    .filter((r) => r && typeof r === "object")
    .map((r: any) => {
      const courseMagnetic =
        typeof r.courseMagnetic === "string"
          ? r.courseMagnetic
          : typeof r.courseTrue === "string"
          ? r.courseTrue
          : "";

      return {
        date: String(r.date ?? daily.date ?? todayISO()),
        time: String(r.time ?? ""),
        position: String(r.position ?? ""),
        courseMagnetic,
        courseGyro: String(r.courseGyro ?? ""),
        courseSteering: String(r.courseSteering ?? ""),
        speed: String(r.speed ?? ""),
        windDir: String(r.windDir ?? ""),
        windForce: String(r.windForce ?? ""),
        sea: String(r.sea ?? ""),
        sky: String(r.sky ?? ""),
        visibility: String(r.visibility ?? ""),
        barometer: String(r.barometer ?? ""),
        airTemp: String(r.airTemp ?? ""),
        seaTemp: String(r.seaTemp ?? ""),
        engines: String(r.engines ?? ""),
        watchkeeper: String(r.watchkeeper ?? watchkeeper ?? ""),
        remarks: String(r.remarks ?? ""),
        totalFuel: String(r.totalFuel ?? ""),
      };
    });

  const normalizedHistory: HistoryDay[] = history
    .filter((h) => h && typeof h === "object" && typeof (h as any).date === "string")
    .map((h: any) => ({
      date: String(h.date ?? ""),
      location: String(h.location ?? ""),
      vesselMode: (String(h.vesselMode ?? "Along") as DailyState["mode"]) ?? "Along",
      vessel: h.vessel && typeof h.vessel === "object" ? (h.vessel as VesselDetails) : vessel,
      notes: Array.isArray(h.notes) ? (h.notes as Note[]) : [],
      weather: h.weather && typeof h.weather === "object" ? (h.weather as WeatherState) : {},
      runningLog: Array.isArray(h.runningLog)
        ? (h.runningLog as any[]).map((r: any) => {
            const courseMagnetic =
              typeof r.courseMagnetic === "string"
                ? r.courseMagnetic
                : typeof r.courseTrue === "string"
                ? r.courseTrue
                : "";
            return {
              date: String(r.date ?? h.date ?? ""),
              time: String(r.time ?? ""),
              position: String(r.position ?? ""),
              courseMagnetic,
              courseGyro: String(r.courseGyro ?? ""),
              courseSteering: String(r.courseSteering ?? ""),
              speed: String(r.speed ?? ""),
              windDir: String(r.windDir ?? ""),
              windForce: String(r.windForce ?? ""),
              sea: String(r.sea ?? ""),
              sky: String(r.sky ?? ""),
              visibility: String(r.visibility ?? ""),
              barometer: String(r.barometer ?? ""),
              airTemp: String(r.airTemp ?? ""),
              seaTemp: String(r.seaTemp ?? ""),
              engines: String(r.engines ?? ""),
              watchkeeper: String(r.watchkeeper ?? ""),
              remarks: String(r.remarks ?? ""),
              totalFuel: String(r.totalFuel ?? ""),
            } as RunningEntry;
          })
        : [],
      fuelSummary:
        h.fuelSummary && typeof h.fuelSummary === "object"
          ? {
              usedLitres:
                typeof h.fuelSummary.usedLitres === "number" ? (h.fuelSummary.usedLitres as number) : undefined,
              lastTotalFuel:
                typeof h.fuelSummary.lastTotalFuel === "number"
                  ? (h.fuelSummary.lastTotalFuel as number)
                  : h.fuelSummary.lastTotalFuel === null
                  ? null
                  : undefined,
            }
          : undefined,
    }));

  const normalized: AppState = {
    vessel: vessel ?? {},
    watchkeeper,
    notes: notes
      .filter((n) => n && typeof n === "object" && typeof (n as Note).text === "string")
      .map((n) => ({
        date: String((n as Note).date ?? daily.date ?? todayISO()),
        time: String((n as Note).time ?? ""),
        text: String((n as Note).text ?? ""),
      })),
    log: normalizedLog,
    history: normalizedHistory,
    pos: {
      latDeg: String((pos as any).latDeg ?? ""),
      latMin: String((pos as any).latMin ?? ""),
      latMinDec: String((pos as any).latMinDec ?? ""),
      latHem: ((pos as any).latHem ?? "S") as "N" | "S",
      lonDeg: String((pos as any).lonDeg ?? ""),
      lonMin: String((pos as any).lonMin ?? ""),
      lonMinDec: String((pos as any).lonMinDec ?? ""),
      lonHem: ((pos as any).lonHem ?? "E") as "E" | "W",
    },
    daily: {
      date: String((daily as DailyState).date ?? todayISO()),
      location: String((daily as DailyState).location ?? ""),
      mode: ((daily as DailyState).mode ?? "Along") as DailyState["mode"],
    },
    coords: {
      lat: typeof coords.lat === "number" ? coords.lat : null,
      lon: typeof coords.lon === "number" ? coords.lon : null,
    },
    locLabel,
    lastWeather,
    updatedAtISO: new Date().toISOString(),
  };

  return normalized;
}

function defaultState(): AppState {
  return {
    vessel: {},
    watchkeeper: "",
    notes: [],
    log: [],
    history: [],
    pos: {
      latDeg: "",
      latMin: "",
      latMinDec: "",
      latHem: "S",
      lonDeg: "",
      lonMin: "",
      lonMinDec: "",
      lonHem: "E",
    },
    daily: { date: todayISO(), location: "", mode: "Along" },
    coords: { lat: null, lon: null },
    locLabel: "Cairns, QLD",
    lastWeather: {},
    updatedAtISO: new Date().toISOString(),
  };
}

/* =========================================================
   Supabase Storage
========================================================= */
async function loadStateFromSupabase(userId: string): Promise<{ state: AppState | null; error: string | null }> {
  const { data, error } = await supabase.from("blp_state").select("state").eq("user_id", userId).maybeSingle();
  if (error) return { state: null, error: error.message };
  if (!data || !data.state) return { state: null, error: null };

  const norm = normalizeBackupToState(data.state);
  return { state: norm ?? null, error: norm ? null : "Saved vessel data could not be read." };
}

async function upsertStateToSupabase(userId: string, state: AppState): Promise<void> {
  const payload = {
    user_id: userId,
    state,
    updated_at: new Date().toISOString(),
  };
  await supabase.from("blp_state").upsert(payload, { onConflict: "user_id" });
}

/* =========================================================
   Styles (UPDATED: tablet-fit tables + no page side-scroll)
========================================================= */
function GlobalStyles() {
  return (
    <style>{`
      :root {
        color-scheme: light;
        --bg:#e7f0f2; --fg:#10262f; --muted:#5f7680; --card:#fbfefe; --card-border:#c9dce2;
        --input-bg:#f6fbfc; --input-border:#b8cfd6; --badge-bg:#e2f2f3; --btn-bg:#0b5260;
        --btn-border:#083d47; --btn-hover:#073f4b; --table-head:#dcecef; --accent:#0d9488;
        --accent-soft:#d9f2ee; --danger:#a33131; --shadow:0 16px 40px rgba(9,50,62,.12);
      }
      html[data-theme="dark"] {
        color-scheme: dark;
        --bg:#051216; --fg:#edf8f8; --muted:#91a9af; --card:#0b2026; --card-border:#21434b;
        --input-bg:#07181d; --input-border:#315861; --badge-bg:#102a31; --btn-bg:#d6a84f;
        --btn-border:#ebc875; --btn-hover:#c99634; --table-head:#102a31; --accent:#5eead4;
        --accent-soft:#12383c; --danger:#c24a4a; --shadow:0 20px 50px rgba(0,0,0,.34);
      }

      html,body{margin:0;padding:0;background:
        radial-gradient(circle at top left, rgba(13,148,136,.2), transparent 34rem),
        linear-gradient(180deg, var(--bg), color-mix(in srgb, var(--bg) 92%, #000 8%));
        color:var(--fg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,Noto Sans; height:auto; min-height:100%;}
      body{overflow:auto; overflow-x:hidden;}

      .container{max-width:1180px;margin:0 auto;padding:18px}
      .grid{display:grid;gap:14px}
      .col{background:color-mix(in srgb, var(--card) 96%, transparent);border:1px solid var(--card-border);border-radius:8px;overflow:hidden;box-shadow:var(--shadow)}
      .section{padding:14px 16px}
      h2{font-size:13px;margin:0 0 10px 0;font-weight:800;color:var(--fg);letter-spacing:.08em;text-transform:uppercase}
      h1{font-size:24px;margin:0 0 8px 0;font-weight:800;color:var(--fg)}
      .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      input,select,textarea{background:var(--input-bg);border:1px solid var(--input-border);color:var(--fg);padding:9px 10px;border-radius:7px;width:100%;box-sizing:border-box;outline:none;transition:border-color .16s ease, box-shadow .16s ease, background .16s ease}
      input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)}
      input::placeholder,textarea::placeholder{color:var(--muted)}
      textarea{min-height:80px}
      .btn{background:var(--btn-bg);color:#fff;border:1px solid var(--btn-border);padding:8px 12px;border-radius:7px;cursor:pointer;font-weight:700;font-size:12px;line-height:1.2;transition:transform .14s ease, background .14s ease, border-color .14s ease, box-shadow .14s ease}
      html[data-theme="dark"] .btn{color:#081113}
      .btn:hover{background:var(--btn-hover);transform:translateY(-1px);box-shadow:0 8px 18px color-mix(in srgb, var(--btn-bg) 24%, transparent)}
      .muted{color:var(--muted);font-size:12px;line-height:1.45}

      table{width:100%;border-collapse:collapse;font-size:12px;color:var(--fg)}
      th,td{text-align:left;padding:8px 9px;white-space:nowrap;border-color:var(--card-border)}
      thead{background:var(--table-head);position:sticky;top:0;z-index:1}
      th{font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.05em}
      tbody tr{border-top:1px solid var(--card-border)}
      tbody tr:hover{background:color-mix(in srgb, var(--accent-soft) 52%, transparent)}

      .pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid var(--card-border);background:var(--badge-bg);font-size:12px;font-weight:800;color:var(--fg)}
      .badge{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;border:1px solid var(--card-border);background:var(--badge-bg);font-size:11px;color:var(--fg)}
      .grid-2{display:grid;grid-template-columns:1fr;gap:12px}
      .grid-3{display:grid;grid-template-columns:1fr;gap:12px}
      .grid-4{display:grid;grid-template-columns:1fr;gap:12px}
      @media(min-width:900px){.grid-2{grid-template-columns:320px minmax(0,1fr)}.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}}

      .table-wrap{overflow:auto; max-width:100%;border:1px solid var(--card-border);border-radius:8px}
      .stack{display:flex;flex-direction:column;gap:12px}
      .right{margin-left:auto}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace}
      #toast{position:fixed;left:16px;right:16px;bottom:16px;background:#16313a;color:#fff;padding:12px 14px;font-family:ui-monospace,monospace;display:none;z-index:999999;border-radius:8px;box-shadow:var(--shadow)}
      details{border:1px solid var(--card-border);border-radius:8px;margin:8px 0;padding:8px;background:color-mix(in srgb, var(--badge-bg) 58%, transparent)}
      summary{cursor:pointer;line-height:1.45}
      .modal-backdrop{position:fixed;inset:0;background:rgba(3,12,15,.68);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(8px)}
      .modal{background:var(--card);border:1px solid var(--card-border);border-radius:8px;max-width:760px;width:100%;padding:16px;box-shadow:var(--shadow)}
      .danger{background:var(--danger) !important;border-color:color-mix(in srgb, var(--danger) 78%, #000 22%) !important;color:#fff !important}
      .app-header{align-items:flex-start;justify-content:space-between;margin-bottom:14px;padding:12px 14px;border:1px solid var(--card-border);border-radius:8px;background:color-mix(in srgb, var(--card) 88%, transparent);box-shadow:var(--shadow)}
      .brand-mark{display:inline-flex;align-items:center;gap:10px}
      .brand-mark::before{content:"";width:12px;height:32px;border-radius:3px;background:linear-gradient(180deg,var(--accent),color-mix(in srgb, var(--accent) 48%, #fff 52%));box-shadow:0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent)}
      .brand-title{display:flex;flex-direction:column;gap:3px}
      .brand-title strong{font-size:18px;line-height:1;font-weight:900}
      .brand-title span{font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.12em;text-transform:uppercase}
      .header-actions{justify-content:flex-end}
      .metric-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}
      .metric{display:flex;flex-direction:column;gap:3px;padding:8px;border:1px solid var(--card-border);border-radius:7px;background:var(--badge-bg)}
      .metric span:first-child{font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.08em}
      .metric b{font-size:14px}
      .login-shell{max-width:760px;margin:9vh auto 0}
      .loading-shell{max-width:420px;margin:18vh auto 0}
      .command-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:-4px 0 14px}
      .command-card{border:1px solid var(--card-border);border-radius:8px;background:color-mix(in srgb,var(--card) 90%,transparent);box-shadow:var(--shadow);padding:12px}
      .command-card span{display:block;color:var(--muted);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
      .command-card strong{display:block;margin-top:5px;color:var(--fg);font-size:18px;line-height:1.1}
      .command-card em{display:block;margin-top:4px;color:var(--muted);font-size:11px;font-style:normal;line-height:1.35}
      .login-panel{overflow:hidden;position:relative}
      .login-panel::before{content:"";position:absolute;inset:0 0 auto 0;height:5px;background:linear-gradient(90deg,var(--accent),#d6a84f)}
      .login-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(220px,.9fr);gap:16px;align-items:start}
      .login-preview{display:grid;gap:8px;border:1px solid var(--card-border);border-radius:8px;background:var(--badge-bg);padding:12px}
      .preview-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid color-mix(in srgb,var(--card-border) 70%,transparent);padding-bottom:8px}
      .preview-row:last-child{border-bottom:0;padding-bottom:0}
      .preview-row span{color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .preview-row strong{font-size:13px;text-align:right}
      .btn.secondary{background:var(--badge-bg);border-color:var(--card-border);color:var(--fg)}
      html[data-theme="dark"] .btn.secondary{color:var(--fg)}
      .btn.secondary:hover{background:var(--accent-soft)}
      .weather-hero{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:center;border:1px solid var(--card-border);border-radius:8px;background:linear-gradient(135deg,var(--accent-soft),color-mix(in srgb,var(--card) 88%,transparent));padding:12px}
      .weather-icon{font-size:34px;text-align:center}
      .weather-hero strong{display:block;font-size:18px}
      .weather-hero span{display:block;color:var(--muted);font-size:12px;margin-top:3px}
      .track-panel{display:grid;gap:10px}
      .track-map{height:340px;border:1px solid var(--card-border);border-radius:8px;background:var(--badge-bg);overflow:hidden;position:relative;isolation:isolate;cursor:grab;touch-action:none}
      .track-map:active{cursor:grabbing}
      .track-map.compact{height:185px;margin-top:8px}
      .track-map.large{height:min(70vh,640px)}
      .track-modal{max-width:min(1180px,96vw);width:100%;max-height:92vh;overflow:auto}
      .map-tiles{position:absolute;inset:0;overflow:hidden;background:linear-gradient(180deg,color-mix(in srgb,var(--badge-bg) 80%,transparent),color-mix(in srgb,var(--card) 92%,transparent))}
      .map-tiles::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.05)),radial-gradient(circle at 50% 44%,transparent 0 55%,rgba(8,42,50,.16) 100%);pointer-events:none}
      html[data-theme="dark"] .map-tiles::after{background:linear-gradient(180deg,rgba(5,18,22,.1),rgba(5,18,22,.34)),radial-gradient(circle at 50% 44%,transparent 0 55%,rgba(0,0,0,.34) 100%)}
      .map-tile{position:absolute;width:256px;height:256px;max-width:none;user-select:none;filter:saturate(.82) contrast(.96) brightness(1.04)}
      html[data-theme="dark"] .map-tile{filter:saturate(.72) contrast(.92) brightness(.72)}
      .map-attribution{position:absolute;right:8px;bottom:6px;z-index:3;border:1px solid var(--card-border);border-radius:6px;background:color-mix(in srgb,var(--card) 88%,transparent);color:var(--muted);font-size:10px;padding:2px 6px}
      .map-controls{position:absolute;left:8px;top:8px;z-index:4;display:flex;gap:6px;align-items:center;border:1px solid var(--card-border);border-radius:8px;background:color-mix(in srgb,var(--card) 88%,transparent);padding:5px;box-shadow:0 8px 18px rgba(0,0,0,.12)}
      .map-control-btn{min-width:30px;height:28px;border:1px solid var(--card-border);border-radius:6px;background:var(--badge-bg);color:var(--fg);font-weight:900;cursor:pointer;line-height:1;padding:0 7px}
      .map-control-btn:hover{background:var(--accent-soft)}
      .map-control-label{font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:0 4px;white-space:nowrap}
      .track-map svg{position:relative;z-index:2;display:block;width:100%;height:100%}
      .track-line-under{fill:none;stroke:rgba(255,255,255,.84);stroke-width:8;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 2px 4px rgba(0,0,0,.28))}
      .track-line{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
      .track-dot{fill:var(--btn-bg);stroke:var(--card);stroke-width:2.5}
      .track-dot.start{fill:#fff;stroke:var(--accent);stroke-width:3}
      .track-dot.latest{fill:var(--accent);stroke:#fff;stroke-width:3;filter:drop-shadow(0 2px 4px rgba(0,0,0,.28))}
      html[data-theme="dark"] .track-dot{fill:var(--btn-bg)}
      .track-label{font-weight:800;paint-order:stroke;stroke:var(--card);stroke-width:4px;stroke-linejoin:round}
      .track-label.subtle{font-weight:700;fill:var(--muted);stroke:var(--card);stroke-width:3px}
      .track-bearing-label{font-weight:800;paint-order:stroke;stroke:var(--card);stroke-width:4px;stroke-linejoin:round;fill:var(--fg)}
      .track-grid{stroke:color-mix(in srgb,var(--fg) 16%,transparent);stroke-width:1;stroke-dasharray:3 6}
      .track-empty{display:grid;min-height:170px;place-items:center;text-align:center;color:var(--muted);font-size:12px;line-height:1.45;padding:18px}
      .track-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .entry-card{order:1}.running-log-card{order:2}.daily-log-card{order:3}.track-card{order:4}.history-card{order:5}
      .course-leg-list{display:grid;gap:6px;margin-top:10px}
      .course-leg{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;border:1px solid var(--card-border);border-radius:7px;background:var(--badge-bg);padding:7px 8px;font-size:12px}
      .course-leg b{font-size:13px}
      .trip-list{display:grid;gap:8px;margin-top:10px}
      .trip-card{border:1px solid var(--card-border);border-radius:8px;background:var(--badge-bg);padding:0;overflow:hidden}
      .trip-card summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;cursor:pointer;list-style:none;padding:10px}
      .trip-card summary::-webkit-details-marker{display:none}
      .trip-card summary::after{content:"Plot";align-self:start;grid-column:2;color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .trip-card[open] summary::after{content:"Hide"}
      .trip-plot{border-top:1px solid var(--card-border);padding:10px;background:color-mix(in srgb,var(--card) 62%,transparent)}
      .trip-card strong{display:block;font-size:14px;margin-bottom:4px}
      .trip-meta{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:12px}
      .trip-metrics{display:grid;grid-template-columns:repeat(2,minmax(80px,1fr));gap:8px;min-width:180px}
      .trip-metrics .metric{background:var(--card)}
      .nmea-panel{grid-column:1 / -1;border:1px solid var(--card-border);background:var(--badge-bg);border-radius:10px;padding:10px;display:grid;gap:10px}
      .nmea-head{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
      .nmea-status{display:inline-flex;align-items:center;gap:7px;font-weight:800}
      .nmea-dot{width:10px;height:10px;border-radius:999px;background:#94a3b8;box-shadow:0 0 0 4px color-mix(in srgb,#94a3b8 18%,transparent)}
      .nmea-status.receiving .nmea-dot,.nmea-status.simulator .nmea-dot{background:#10b981;box-shadow:0 0 0 4px rgba(16,185,129,.18)}
      .nmea-status.connected .nmea-dot{background:#f59e0b;box-shadow:0 0 0 4px rgba(245,158,11,.18)}
      .nmea-status.error .nmea-dot{background:#ef4444;box-shadow:0 0 0 4px rgba(239,68,68,.18)}
      .nmea-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
      .nmea-value{border:1px solid var(--card-border);background:var(--card);border-radius:8px;padding:8px;min-height:58px}
      .nmea-value span{display:block;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}
      .nmea-value b{display:block;font-size:17px;margin-top:4px}
      .nmea-footer{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
      @media(max-width:1100px){.nmea-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:620px){.nmea-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}

      .pos-row{display:grid;grid-template-columns:minmax(82px,1fr) minmax(82px,1fr) minmax(112px,1.2fr) 76px;gap:10px;align-items:center}
      .pos-row input,.pos-row select{width:100%;min-width:0}
      .entry-card .grid-4 > .pos-row{grid-column:1 / -1}
      .position-autofill{grid-column:1 / -1;display:grid;grid-template-columns:180px 1fr;gap:10px;align-items:center;border:1px solid var(--card-border);background:var(--badge-bg);border-radius:10px;padding:10px}
      .position-autofill .muted{line-height:1.35}
      @media(max-width:720px){.position-autofill{grid-template-columns:1fr}}
      @media(max-width:720px){.pos-row{grid-template-columns:minmax(74px,1fr) minmax(74px,1fr) minmax(96px,1.2fr) 68px;gap:8px}}
      @media(max-width:460px){.pos-row{grid-template-columns:1fr 1fr 76px}.pos-row input:nth-child(3){grid-column:1 / 3}}

      @media (max-width: 1100px){
        .tablet-hide{display:none !important;}
        th,td{padding:6px 6px;font-size:11px;}
        .remarks-cell{white-space:normal;max-width:260px;}
      }
      @media (max-width: 720px){
        .container{padding:10px}
        .section{padding:12px}
        .app-header{padding:10px}
        .header-actions{justify-content:flex-start}
        .btn{padding:8px 10px}
      }    `}</style>
  );
}

/* =========================================================
   Fuel math (daily)
========================================================= */
function getYesterdayISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lastTotalFuelFromEntries(entries: RunningEntry[]): number | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const n = parseNumberLoose(entries[i].totalFuel);
    if (n != null) return n;
  }
  return null;
}

function computeFuelForDay(dayEntries: RunningEntry[], prevTotalFuel: number | null) {
  let prev = prevTotalFuel;
  const perEntryUsed: Array<number | null> = [];
  let usedSum = 0;

  const chrono = [...dayEntries].slice().reverse();
  const usedMap = new Map<string, number | null>();

  for (const e of chrono) {
    const cur = parseNumberLoose(e.totalFuel);
    let used: number | null = null;

    if (cur != null && prev != null) {
      const delta = prev - cur;
      if (delta >= 0) {
        used = delta;
        usedSum += delta;
      } else {
        used = null; // refuel
      }
    }
    if (cur != null) prev = cur;

    usedMap.set(`${e.date}__${e.time}__${e.position}`, used);
  }

  for (const e of dayEntries) {
    perEntryUsed.push(usedMap.get(`${e.date}__${e.time}__${e.position}`) ?? null);
  }

  return {
    perEntryUsed,
    usedSum,
    lastTotalFuel: prev != null ? prev : prevTotalFuel,
  };
}

/* =========================================================
   Helpers: entry identity + history fuel recompute
========================================================= */
function entryKey(e: Pick<RunningEntry, "date" | "time" | "position">) {
  return `${e.date}__${e.time}__${e.position}`;
}

function recomputeHistoryFuelSummaries(history: HistoryDay[]): HistoryDay[] {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, HistoryDay>();
  for (const h of sorted) byDate.set(h.date, { ...h });

  for (const h of sorted) {
    const yISO = getYesterdayISO(h.date);
    const y = byDate.get(yISO);

    const prevFuel =
      y?.fuelSummary?.lastTotalFuel ??
      lastTotalFuelFromEntries(y?.runningLog ?? []) ??
      null;

    const fuel = computeFuelForDay(h.runningLog ?? [], prevFuel);

    byDate.set(h.date, {
      ...h,
      fuelSummary: {
        usedLitres: Math.round(fuel.usedSum * 100) / 100,
        lastTotalFuel: fuel.lastTotalFuel ?? null,
      },
    });
  }

  return history.map((h) => byDate.get(h.date) ?? h);
}


type TrackPoint = {
  lat: number;
  lon: number;
  time: string;
  label: string;
  courseMagnetic?: string;
  remarks?: string;
};

function parseLoggedPosition(position: string, time = ""): TrackPoint | null {
  const match = position.match(/(\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)'([NS])\s*\/\s*(\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)'([EW])/i);
  if (!match) return null;

  const latDeg = Number(match[1]);
  const latMin = Number(match[2]);
  const latHem = match[3].toUpperCase();
  const lonDeg = Number(match[4]);
  const lonMin = Number(match[5]);
  const lonHem = match[6].toUpperCase();

  if (![latDeg, latMin, lonDeg, lonMin].every(Number.isFinite)) return null;

  const lat = (latDeg + latMin / 60) * (latHem === "S" ? -1 : 1);
  const lon = (lonDeg + lonMin / 60) * (lonHem === "W" ? -1 : 1);

  return { lat, lon, time, label: position };
}

function distanceNm(a: TrackPoint, b: TrackPoint): number {
  const radiusNm = 3440.065;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(h)));
}


function bearingDeg(a: TrackPoint, b: TrackPoint): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const toDeg = (n: number) => (n * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function fmtDeg(value: number): string {
  return `${String(Math.round(value)).padStart(3, "0")}°`;
}

function buildTrack(entries: RunningEntry[]) {
  const points = entries
    .slice()
    .reverse()
    .map((entry) => {
      const point = parseLoggedPosition(entry.position, entry.time);
      return point ? { ...point, courseMagnetic: entry.courseMagnetic, remarks: entry.remarks } : null;
    })
    .filter((point): point is NonNullable<typeof point> => point != null);

  const legs = points.slice(1).map((point, idx) => {
    const from = points[idx];
    const distance = distanceNm(from, point);
    const bearing = bearingDeg(from, point);
    return { from, to: point, distance, bearing };
  });

  const totalNm = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const lastLegNm = legs.at(-1)?.distance ?? 0;

  return { points, legs, totalNm, lastLegNm };
}

function fmtNm(value: number): string {
  return `${Math.round(value * 10) / 10} NM`;
}

type TrackShape = {
  points: TrackPoint[];
  legs: Array<{ from: TrackPoint; to: TrackPoint; distance: number; bearing: number }>;
  totalNm: number;
  lastLegNm: number;
};

function trackZoom(points: TrackPoint[], width: number, height: number): number {
  const padX = 116;
  const padY = 92;
  for (let zoom = 16; zoom >= 5; zoom -= 1) {
    const pixels = points.map((point) => worldPixel(point.lat, point.lon, zoom));
    const minX = Math.min(...pixels.map((p) => p.x));
    const maxX = Math.max(...pixels.map((p) => p.x));
    const minY = Math.min(...pixels.map((p) => p.y));
    const maxY = Math.max(...pixels.map((p) => p.y));
    if (maxX - minX <= width - padX && maxY - minY <= height - padY) return zoom;
  }
  return 5;
}

function worldPixel(lat: number, lon: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size };
}

function clampPlotLabel(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampMapZoom(value: number): number {
  return Math.max(5, Math.min(17, value));
}

function TrackPlotView({ track, emptyText, compact = false, large = false }: { track: TrackShape; emptyText: string; compact?: boolean; large?: boolean }) {
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const fallbackHeight = large ? 420 : compact ? 190 : 340;
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapSize, setMapSize] = useState({ width: 520, height: fallbackHeight });

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setMapSize({
        width: Math.max(520, Math.round(rect.width)),
        height: Math.max(160, Math.round(rect.height || fallbackHeight)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallbackHeight]);
  if (track.points.length < 2) return <div className="track-empty">{emptyText}</div>;

  const width = mapSize.width;
  const height = mapSize.height;
  const fittedZoom = trackZoom(track.points, width, height);
  const zoom = clampMapZoom(fittedZoom + zoomOffset);
  const projected = track.points.map((point) => worldPixel(point.lat, point.lon, zoom));
  const minX = Math.min(...projected.map((p) => p.x));
  const maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y));
  const maxY = Math.max(...projected.map((p) => p.y));
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const topLeft = { x: center.x - width / 2 - pan.x, y: center.y - height / 2 - pan.y };
  const tileMinX = Math.floor(topLeft.x / 256);
  const tileMaxX = Math.floor((topLeft.x + width) / 256);
  const tileMinY = Math.floor(topLeft.y / 256);
  const tileMaxY = Math.floor((topLeft.y + height) / 256);
  const tileLimit = 2 ** zoom;
  const tiles: Array<{ key: string; left: number; top: number; url: string }> = [];
  for (let x = tileMinX; x <= tileMaxX; x += 1) {
    for (let y = tileMinY; y <= tileMaxY; y += 1) {
      if (y < 0 || y >= tileLimit) continue;
      const wrappedX = ((x % tileLimit) + tileLimit) % tileLimit;
      tiles.push({ key: `${zoom}-${wrappedX}-${y}`, left: x * 256 - topLeft.x, top: y * 256 - topLeft.y, url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png` });
    }
  }
  const pts = track.points.map((point) => {
    const px = worldPixel(point.lat, point.lon, zoom);
    return { x: px.x - topLeft.x, y: px.y - topLeft.y, time: point.time, courseMagnetic: point.courseMagnetic };
  });
  const linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const className = large ? "track-map large" : compact ? "track-map compact" : "track-map";
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".map-controls")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, pan };
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
  };
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <>
      <div ref={mapRef} className={className} aria-label="Position track plot over map" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onDoubleClick={resetView}>
        <div className="map-tiles" aria-hidden="true">
          {tiles.map((tile) => <img className="map-tile" key={tile.key} src={tile.url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ left: tile.left, top: tile.top }} />)}
        </div>
        <div className="map-controls" aria-label="Map controls">
          <button className="map-control-btn" type="button" onClick={() => setZoomOffset((z) => Math.min(z + 1, 4))}>+</button>
          <button className="map-control-btn" type="button" onClick={() => setZoomOffset((z) => Math.max(z - 1, -2))}>-</button>
          <button className="map-control-btn" type="button" onClick={resetView} title="Fit track">Fit</button>
          <span className="map-control-label">z{zoom}</span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          {[0.25, 0.5, 0.75].map((ratio) => <g key={ratio}><line className="track-grid" x1={width * ratio} y1="18" x2={width * ratio} y2={height - 18} /><line className="track-grid" x1="18" y1={height * ratio} x2={width - 18} y2={height * ratio} /></g>)}
          <polyline className="track-line-under" points={linePoints} />
          <polyline className="track-line" points={linePoints} />
          {track.legs.map((leg, idx) => {
            const a = pts[idx];
            const b = pts[idx + 1];
            if (!a || !b) return null;
            const labelX = clampPlotLabel((a.x + b.x) / 2 + 6, 26, width - 96);
            const labelY = clampPlotLabel((a.y + b.y) / 2 + 12, 24, height - 18);
            return <text className="track-bearing-label" key={`${leg.from.time}-${leg.to.time}`} x={labelX} y={labelY} fontSize={large ? "11" : "10"}>{fmtDeg(leg.bearing)} / {fmtNm(leg.distance)}</text>;
          })}
          {pts.map((p, idx) => {
            const isStart = idx === 0;
            const isLatest = idx === pts.length - 1;
            const label = isStart ? "Start" : isLatest ? "Latest" : p.time;
            const labelX = clampPlotLabel(p.x + 9, 14, width - 74);
            const labelY = clampPlotLabel(p.y - 10, 18, height - 26);
            return <g key={`${p.time}-${idx}`}><circle className={`track-dot ${isStart ? "start" : ""} ${isLatest ? "latest" : ""}`} cx={p.x} cy={p.y} r={isLatest ? 6.5 : isStart ? 5.5 : 4} /><text className="track-label" x={labelX} y={labelY} fontSize={large ? "11" : "10"} fill="currentColor">{label} {isStart || isLatest ? p.time : ""}</text>{p.courseMagnetic ? <text className="track-label subtle" x={labelX} y={labelY + 13} fontSize="9">C {p.courseMagnetic}M</text> : null}</g>;
          })}
        </svg>
        <div className="map-attribution">OSM • z{zoom}</div>
      </div>
      <div className="track-stats"><div className="metric"><span>Total Track</span><b>{fmtNm(track.totalNm)}</b></div><div className="metric"><span>Last Leg</span><b>{fmtNm(track.lastLegNm)}</b></div><div className="metric"><span>Fixes</span><b>{track.points.length}</b></div></div>
      <div className="course-leg-list" aria-label="Course legs">{track.legs.map((leg, idx) => <div className="course-leg" key={`${leg.from.time}-${leg.to.time}-${idx}`}><b>{fmtDeg(leg.bearing)}</b><span>{leg.from.time} - {leg.to.time}</span><span className="mono">{fmtNm(leg.distance)}</span></div>)}</div>
    </>
  );
}function windSummary(wx: WeatherState): string {
  if (wx.windKts == null) return "Set position for live wind";
  const gust = wx.windGustKts != null ? `, gust ${wx.windGustKts} kt` : "";
  return `${wx.windKts} kt @ ${wx.windDir ?? "--"}°${gust}`;
}
/* =========================================================
   App
========================================================= */
export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = localStorage.getItem("blp-theme");
    return t === "light" ? "light" : "dark";
  });

  const [toast, setToast] = useState<string>("");
  const toastTimer = useRef<number | null>(null);

  const [sessionReady, setSessionReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [stateHydrated, setStateHydrated] = useState(false);
  const [stateLoadError, setStateLoadError] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginStatus, setLoginStatus] = useState("Not logged in");

  const [state, setState] = useState<AppState>(() => defaultState());
  const [mapOpen, setMapOpen] = useState(false);
  const [vesselPosition, setVesselPosition] = useState<VesselPosition | null>(null);
  const [manualPositionOverride, setManualPositionOverride] = useState(false);
  const [nmeaFeed, setNmeaFeed] = useState<NmeaFeedState>(() => defaultNmeaFeedState());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const remoteSaveArmed = useRef(false);
  const weatherPositionRef = useRef<{ lat: number; lon: number; fetchedAt: number } | null>(null);
  const br1PositionProvider = useMemo(() => createVesselPositionProvider(), []);
  const tabletGpsPositionProvider = useMemo(() => createTabletGpsPositionProvider(), []);
  const [positionSourceMode, setPositionSourceMode] = useState<PositionSourceMode>(() => {
    const saved = localStorage.getItem("blp-position-source");
    return saved === "tablet" || saved === "network" ? saved : "auto";
  });
  const isBeluga =
    userEmail.trim().toLowerCase() === BELUGA_LOGIN_EMAIL ||
    loginEmail.trim().toLowerCase() === BELUGA_LOGIN_EMAIL;
  const useTabletGps = positionSourceMode === "tablet" || (positionSourceMode === "auto" && isBeluga);
  const vesselPositionProvider = useTabletGps ? tabletGpsPositionProvider : br1PositionProvider;
  const autoPositionLabel = useTabletGps ? "Tablet GPS" : "Northern Escape GPS";
  const autoPositionBackendLabel = useTabletGps ? "Tablet / Garmin GLO via device location" : "/api/vessel-position";

  function showToast(msg: string, ok = false) {
    setToast(ok ? `✓ ${msg}` : `BridgeLog Pro: ${msg}`);
    const el = document.getElementById("toast");
    if (el) el.style.display = "block";
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      const t = document.getElementById("toast");
      if (t) t.style.display = "none";
      setToast("");
    }, 2200);
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("blp-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("blp-position-source", positionSourceMode);
  }, [positionSourceMode]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      setUserEmail(data.session?.user?.email ?? "");
      setSessionReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setUserId(sess?.user?.id ?? null);
      setUserEmail(sess?.user?.email ?? "");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    if (!userId) {
      setStateHydrated(false);
      setStateLoadError(null);
      setState(defaultState());
      return;
    }

    let cancelled = false;
    setStateHydrated(false);
    setStateLoadError(null);

    (async () => {
      const cacheKey = `blp-cache-${userId}`;
      let loadedState: AppState | null = null;
      const cached = localStorage.getItem(cacheKey);

      if (cached) {
        const parsed = safeParseJSON(cached);
        const norm = normalizeBackupToState(parsed);
        if (norm && !cancelled) {
          loadedState = norm;
          setState(norm);
        }
      }

      const remote = await loadStateFromSupabase(userId);
      if (cancelled) return;

      if (remote.error) {
        setStateLoadError(remote.error);
        return;
      }

      if (remote.state) {
        loadedState = remote.state;
        setState(remote.state);
        localStorage.setItem(cacheKey, JSON.stringify(remote.state));
      }

      if (!loadedState) setState(defaultState());
      setStateHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!userId || !stateHydrated || stateLoadError) return;
    if (!remoteSaveArmed.current) {
      remoteSaveArmed.current = true;
      return;
    }
    const cacheKey = `blp-cache-${userId}`;
    localStorage.setItem(cacheKey, JSON.stringify(state));

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void upsertStateToSupabase(userId, { ...state, updatedAtISO: new Date().toISOString() });
    }, 700);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state, userId, stateHydrated, stateLoadError]);

  useEffect(() => {
    if (!userId) return;

    const iv = window.setInterval(() => {
      const d = todayISO();
      if (d !== state.daily.date) {
        setState((prev) => {
          const todays = prev.log.filter((e) => e.date === prev.daily.date);

          const yISO = getYesterdayISO(prev.daily.date);
          const yHist = prev.history.find((h) => h.date === yISO);
          const prevFuel =
            yHist?.fuelSummary?.lastTotalFuel ??
            lastTotalFuelFromEntries(yHist?.runningLog ?? []) ??
            null;

          const fuel = computeFuelForDay(todays, prevFuel);

          const snap: HistoryDay = {
            date: prev.daily.date,
            location: prev.daily.location,
            vesselMode: prev.daily.mode,
            vessel: { ...prev.vessel },
            notes: prev.notes.filter((n) => n.date === prev.daily.date),
            weather: prev.lastWeather ?? {},
            runningLog: todays,
            fuelSummary: {
              usedLitres: Math.round(fuel.usedSum * 100) / 100,
              lastTotalFuel: fuel.lastTotalFuel ?? null,
            },
          };

          const nextHistory = [snap, ...prev.history];
          const nextNotes = prev.notes.filter((n) => n.date !== prev.daily.date);

          return {
            ...prev,
            history: nextHistory,
            notes: nextNotes,
            daily: { ...prev.daily, date: d },
          };
        });
        showToast(`Auto-saved at midnight → ${prettyDate(todayISO())}`, true);
      }
    }, 30_000);

    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, state.daily.date]);

  const todaysNotes = useMemo(
    () => state.notes.filter((n) => n.date === state.daily.date),
    [state.notes, state.daily.date]
  );

  const todaysLog = useMemo(
    () => state.log.filter((e) => e.date === state.daily.date),
    [state.log, state.daily.date]
  );

  const todaysFuel = useMemo(() => {
    const yISO = getYesterdayISO(state.daily.date);
    const yHist = state.history.find((h) => h.date === yISO);
    const prevFuel =
      yHist?.fuelSummary?.lastTotalFuel ??
      lastTotalFuelFromEntries(yHist?.runningLog ?? []) ??
      null;

    return computeFuelForDay(todaysLog, prevFuel);
  }, [todaysLog, state.history, state.daily.date]);

  const todaysTrack = useMemo(() => buildTrack(todaysLog), [todaysLog]);
  const activeCoords = vesselPosition && !manualPositionOverride
    ? { lat: vesselPosition.latitude, lon: vesselPosition.longitude }
    : state.coords;
  const activeLocLabel = vesselPosition && !manualPositionOverride
    ? `${vesselPosition.latitude.toFixed(4)}, ${vesselPosition.longitude.toFixed(4)}`
    : state.locLabel;
  const gpsStatus = vesselPosition?.sourceStatus ?? (useTabletGps ? "Tablet GPS Stale" : "BR1 GPS Stale");
  const gpsTelemetry = vesselPosition
    ? [
        vesselPosition.speedKts != null ? `${vesselPosition.speedKts} kt` : null,
        vesselPosition.headingDeg != null ? `${Math.round(vesselPosition.headingDeg)}°` : null,
        vesselPosition.accuracyM != null ? `±${Math.round(vesselPosition.accuracyM)} m` : null,
        vesselPosition.altitudeM != null ? `Alt ${Math.round(vesselPosition.altitudeM)} m` : null,
        vesselPosition.timestamp ? new Date(vesselPosition.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null,
      ]
        .filter(Boolean)
        .join(" • ")
    : `Waiting for ${autoPositionLabel}`;
  const nmea = nmeaFeed.snapshot;
  const nmeaStatusLabel =
    nmeaFeed.status === "receiving"
      ? "Receiving"
      : nmeaFeed.status === "connected"
      ? "Connected"
      : nmeaFeed.status === "simulator"
      ? "Simulator"
      : nmeaFeed.status === "error"
      ? "Error"
      : "Waiting";
  const nmeaEndpoint = `${nmeaFeed.listenHost === "0.0.0.0" ? "BridgeLog PC IP" : nmeaFeed.listenHost}:${nmeaFeed.listenPort}`;

  async function fetchWeather(lat: number, lon: number) {
    try {
      const u = new URL("https://api.open-meteo.com/v1/forecast");
      u.searchParams.set("latitude", String(lat));
      u.searchParams.set("longitude", String(lon));
      u.searchParams.set(
        "current",
        [
          "temperature_2m",
          "wind_speed_10m",
          "wind_direction_10m",
          "wind_gusts_10m",
          "pressure_msl",
          "visibility",
          "weather_code",
          "precipitation",
          "relative_humidity_2m",
          "cloud_cover",
          "dew_point_2m",
        ].join(",")
      );
      u.searchParams.set("wind_speed_unit", "kn");
      u.searchParams.set("timezone", "auto");

      const r = await fetch(String(u));
      if (!r.ok) throw new Error(`Weather HTTP ${r.status}`);
      const d = (await r.json()) as { current?: Record<string, unknown> };

      const c = d.current ?? {};
      const wx: WeatherState = {
        tempC: typeof c.temperature_2m === "number" ? c.temperature_2m : null,
        windKts: typeof c.wind_speed_10m === "number" ? c.wind_speed_10m : null,
        windDir: typeof c.wind_direction_10m === "number" ? c.wind_direction_10m : null,
        windGustKts: typeof c.wind_gusts_10m === "number" ? c.wind_gusts_10m : null,
        pressure: typeof c.pressure_msl === "number" ? c.pressure_msl : null,
        visibilityKm: typeof c.visibility === "number" ? (c.visibility as number) / 1000 : null,
        weatherCode: typeof c.weather_code === "number" ? c.weather_code : null,
        condition: typeof c.weather_code === "number" ? WMO[c.weather_code as number] : null,
        precipMmHr: typeof c.precipitation === "number" ? c.precipitation : null,
        humidityPct: typeof c.relative_humidity_2m === "number" ? (c.relative_humidity_2m as number) : null,
        cloudPct: typeof c.cloud_cover === "number" ? (c.cloud_cover as number) : null,
        dewPointC: typeof c.dew_point_2m === "number" ? (c.dew_point_2m as number) : null,
      };

      try {
        const m = new URL("https://marine-api.open-meteo.com/v1/marine");
        m.searchParams.set("latitude", String(lat));
        m.searchParams.set("longitude", String(lon));
        m.searchParams.set("current", "wave_height,wave_period,wave_direction");
        m.searchParams.set("timezone", "auto");
        const mr = await fetch(String(m));
        if (mr.ok) {
          const md = (await mr.json()) as { current?: Record<string, unknown> };
          const mc = md.current ?? {};
          wx.waveHeightM = typeof mc.wave_height === "number" ? (mc.wave_height as number) : null;
          wx.wavePeriodS = typeof mc.wave_period === "number" ? (mc.wave_period as number) : null;
          wx.waveDirDeg = typeof mc.wave_direction === "number" ? (mc.wave_direction as number) : null;
        }
      } catch {
        // ignore
      }

      setState((prev) => ({ ...prev, lastWeather: wx }));
    } catch (e) {
      showToast((e as Error).message ?? "Weather fetch failed");
    }
  }

  function posFieldsFromDecimal(lat: number, lon: number): PosState {
    const toParts = (value: number, positive: "N" | "E", negative: "S" | "W") => {
      const abs = Math.abs(value);
      const deg = Math.floor(abs);
      const minutesTotal = (abs - deg) * 60;
      const min = Math.floor(minutesTotal);
      const minDec = Math.round((minutesTotal - min) * 1000);
      return {
        deg: String(deg),
        min: String(min).padStart(2, "0"),
        minDec: String(minDec).padStart(3, "0"),
        hem: value >= 0 ? positive : negative,
      };
    };

    const latParts = toParts(lat, "N", "S");
    const lonParts = toParts(lon, "E", "W");
    return {
      latDeg: latParts.deg,
      latMin: latParts.min,
      latMinDec: latParts.minDec,
      latHem: latParts.hem as "N" | "S",
      lonDeg: lonParts.deg,
      lonMin: lonParts.min,
      lonMinDec: lonParts.minDec,
      lonHem: lonParts.hem as "E" | "W",
    };
  }

  function applyDecimalPosition(latInput: number, lonInput: number, okMessage = "Auto position applied") {
    const lat = Number(latInput.toFixed(6));
    const lon = Number(lonInput.toFixed(6));
    const label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    setManualPositionOverride(false);
    setState((prev) => ({
      ...prev,
      pos: posFieldsFromDecimal(lat, lon),
      coords: { lat, lon },
      locLabel: label,
    }));
    void fetchWeather(lat, lon);
    showToast(okMessage, true);
  }

  function applyProviderPosition(position: VesselPosition, okMessage = "Auto position applied") {
    applyDecimalPosition(position.latitude, position.longitude, okMessage);
    setEntryFields((prev) => ({
      ...prev,
      courseMagnetic: position.headingDeg != null ? String(Math.round(position.headingDeg)) : prev.courseMagnetic,
      courseGyro: position.headingDeg != null ? String(Math.round(position.headingDeg)) : prev.courseGyro,
      courseSteering: position.headingDeg != null ? String(Math.round(position.headingDeg)) : prev.courseSteering,
      speed: position.speedKts != null ? position.speedKts.toFixed(1) : prev.speed,
    }));
  }

  async function useVesselPosition() {
    const position = await vesselPositionProvider.getLatestPosition();
    setVesselPosition(position);
    if (position) {
      applyProviderPosition(position, `${position.sourceStatus} position applied`);
      return;
    }

    if (vesselPosition) {
      applyProviderPosition(vesselPosition, `${vesselPosition.sourceStatus} cached position applied`);
      return;
    }

    if (activeCoords.lat != null && activeCoords.lon != null) {
      applyDecimalPosition(activeCoords.lat, activeCoords.lon, "Displayed position applied");
      return;
    }

    showToast(`No vessel position from ${autoPositionLabel} yet`);
  }

  function autoFillFromNmea() {
    const hasPosition = nmea.latitude != null && nmea.longitude != null;
    if (hasPosition) {
      applyDecimalPosition(nmea.latitude as number, nmea.longitude as number, "NMEA position applied");
    }

    setEntryFields((prev) => ({
      ...prev,
      courseMagnetic: nmea.courseDeg != null ? String(Math.round(nmea.courseDeg)) : prev.courseMagnetic,
      courseGyro: nmea.headingDeg != null ? String(Math.round(nmea.headingDeg)) : prev.courseGyro,
      courseSteering: nmea.headingDeg != null ? String(Math.round(nmea.headingDeg)) : prev.courseSteering,
      speed: nmea.speedKnots != null ? nmea.speedKnots.toFixed(1) : prev.speed,
      windDir: nmea.windAngleDeg != null ? String(Math.round(nmea.windAngleDeg)) : prev.windDir,
      remarks:
        nmea.depthMeters != null
          ? `${prev.remarks ? `${prev.remarks} • ` : ""}Depth ${nmea.depthMeters.toFixed(1)} m`
          : prev.remarks,
    }));

    if (!hasPosition && nmea.speedKnots == null && nmea.courseDeg == null && nmea.headingDeg == null) {
      showToast("No live NMEA navigation data yet");
      return;
    }

    showToast("NMEA bridge log fields filled", true);
  }

  function fromPosFields() {
    const latDeg = Number(state.pos.latDeg);
    const latMin = Number(state.pos.latMin || 0);
    const latDec = Number(state.pos.latMinDec || 0);

    const lonDeg = Number(state.pos.lonDeg);
    const lonMin = Number(state.pos.lonMin || 0);
    const lonDec = Number(state.pos.lonMinDec || 0);

    const latSign = state.pos.latHem === "S" ? -1 : 1;
    const lonSign = state.pos.lonHem === "W" ? -1 : 1;

    const latMinutesTotal = latMin + latDec / 1000;
    const lonMinutesTotal = lonMin + lonDec / 1000;

    const lat = (latDeg + latMinutesTotal / 60) * latSign;
    const lon = (lonDeg + lonMinutesTotal / 60) * lonSign;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showToast("Enter valid degrees & minutes");
      return;
    }

    const label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    setManualPositionOverride(true);
    setState((prev) => ({
      ...prev,
      coords: { lat, lon },
      locLabel: label,
    }));
    void fetchWeather(lat, lon);
  }

  useEffect(() => {
    if (!userId || !stateHydrated || stateLoadError) return;
    return vesselPositionProvider.subscribe((position) => {
      setVesselPosition(position);
    });
  }, [userId, stateHydrated, stateLoadError, vesselPositionProvider]);

  useEffect(() => {
    if (!userId || !stateHydrated || stateLoadError) return;

    let stopped = false;
    const loadInitial = async () => {
      try {
        const response = await fetch("/api/nmea/state", { cache: "no-store" });
        if (!response.ok) return;
        const feed = (await response.json()) as NmeaFeedState;
        if (!stopped) setNmeaFeed(feed);
      } catch {
        if (!stopped) {
          setNmeaFeed((prev) => ({ ...prev, status: "waiting", lastError: "NMEA backend not available" }));
        }
      }
    };

    void loadInitial();

    const events = new EventSource("/api/nmea/events");
    events.addEventListener("nmea-state", (event) => {
      try {
        setNmeaFeed(JSON.parse((event as MessageEvent).data) as NmeaFeedState);
      } catch {
        // Ignore malformed event payloads and keep the previous snapshot visible.
      }
    });
    events.onerror = () => {
      setNmeaFeed((prev) => ({ ...prev, status: prev.status === "receiving" ? "connected" : prev.status, lastError: "NMEA event stream interrupted" }));
    };

    return () => {
      stopped = true;
      events.close();
    };
  }, [userId, stateHydrated, stateLoadError]);

  useEffect(() => {
    if (!userId || !stateHydrated || stateLoadError || !vesselPosition || manualPositionOverride) return;
    const previous = weatherPositionRef.current;
    const now = Date.now();
    const moved =
      !previous ||
      Math.abs(previous.lat - vesselPosition.latitude) > 0.02 ||
      Math.abs(previous.lon - vesselPosition.longitude) > 0.02;
    const expired = !previous || now - previous.fetchedAt > WEATHER_REFRESH_MS;
    if (!moved && !expired) return;

    weatherPositionRef.current = { lat: vesselPosition.latitude, lon: vesselPosition.longitude, fetchedAt: now };
    void fetchWeather(vesselPosition.latitude, vesselPosition.longitude);
  }, [userId, stateHydrated, stateLoadError, vesselPosition, manualPositionOverride]);

  function composedPos(): string {
    const { latDeg, latMin, latMinDec, latHem, lonDeg, lonMin, lonMinDec, lonHem } = state.pos;
    const latDec = String(latMinDec ?? "").padStart(3, "0");
    const lonDec = String(lonMinDec ?? "").padStart(3, "0");
    const lat = latDeg && latMin && latHem ? `${latDeg}°${latMin}.${latDec}'${latHem}` : "";
    const lon = lonDeg && lonMin && lonHem ? `${lonDeg}°${lonMin}.${lonDec}'${lonHem}` : "";
    return lat && lon ? `${lat} / ${lon}` : "";
  }

  const [noteDraft, setNoteDraft] = useState("");

  function addNote() {
    const v = noteDraft.trim();
    if (!v) return;
    setState((prev) => ({
      ...prev,
      notes: [{ date: prev.daily.date, time: nowHHMM(), text: v }, ...prev.notes],
    }));
    setNoteDraft("");
  }

  const [entryFields, setEntryFields] = useState({
    courseMagnetic: "",
    courseGyro: "",
    courseSteering: "",
    speed: "",
    windDir: "",
    windForce: "",
    sea: "",
    sky: "",
    visibility: "",
    barometer: "",
    airTemp: "",
    seaTemp: "",
    engines: "",
    watchkeeper: "",
    remarks: "",
    totalFuel: "",
  });

  function addEntry() {
    const p = composedPos();
    if (!p) {
      showToast("Enter a position (degrees + minutes)");
      return;
    }

    const windForce = entryFields.windForce;
    let sea = entryFields.sea;
    if (!sea) {
      const b = Number(windForce || 0);
      const bf = BEAUFORT.find((x) => x.force === b);
      if (bf) sea = bf.wave;
    }

    setState((prev) => ({
      ...prev,
      log: [
        {
          date: prev.daily.date,
          time: nowHHMM(),
          position: p,
          courseMagnetic: entryFields.courseMagnetic,
          courseGyro: entryFields.courseGyro,
          courseSteering: entryFields.courseSteering,
          speed: entryFields.speed,
          windDir: entryFields.windDir,
          windForce,
          sea,
          sky: entryFields.sky,
          visibility: entryFields.visibility,
          barometer: entryFields.barometer,
          airTemp: entryFields.airTemp,
          seaTemp: entryFields.seaTemp,
          engines: entryFields.engines,
          watchkeeper: entryFields.watchkeeper || prev.watchkeeper || "",
          remarks: entryFields.remarks,
          totalFuel: entryFields.totalFuel,
        },
        ...prev.log,
      ],
    }));
  }

  function addMovement(kind: "Along" | "Cast Off" | "Anchor Down" | "Anchor Up") {
    const p = composedPos() || (todaysLog[0]?.position ?? "(pos TBD)");
    const text = `${kind} at ${p}`;

    setState((prev) => {
      const nextNotes = [{ date: prev.daily.date, time: nowHHMM(), text }, ...prev.notes];

      const nextLog = [
        {
          date: prev.daily.date,
          time: nowHHMM(),
          position: p,
          courseMagnetic: "",
          courseGyro: "",
          courseSteering: "",
          speed: "",
          windDir: "",
          windForce: "",
          sea: "",
          sky: "",
          visibility: "",
          barometer: "",
          airTemp: "",
          seaTemp: "",
          engines: "",
          watchkeeper: prev.watchkeeper || "",
          remarks: text,
          totalFuel: "",
        },
        ...prev.log,
      ];

      const nextMode: DailyState["mode"] =
        kind === "Cast Off" || kind === "Anchor Up"
          ? "Underway"
          : kind === "Anchor Down"
          ? "@Anchor"
          : "Along";

      return {
        ...prev,
        notes: nextNotes,
        log: nextLog,
        daily: { ...prev.daily, mode: nextMode },
      };
    });
  }

  function saveDayToHistory() {
    setState((prev) => {
      const todays = prev.log.filter((e) => e.date === prev.daily.date);

      const yISO = getYesterdayISO(prev.daily.date);
      const yHist = prev.history.find((h) => h.date === yISO);
      const prevFuel =
        yHist?.fuelSummary?.lastTotalFuel ??
        lastTotalFuelFromEntries(yHist?.runningLog ?? []) ??
        null;

      const fuel = computeFuelForDay(todays, prevFuel);

      const snapshot: HistoryDay = {
        date: prev.daily.date,
        location: prev.daily.location,
        vesselMode: prev.daily.mode,
        vessel: { ...prev.vessel },
        notes: prev.notes.filter((n) => n.date === prev.daily.date),
        weather: prev.lastWeather ?? {},
        runningLog: todays,
        fuelSummary: {
          usedLitres: Math.round(fuel.usedSum * 100) / 100,
          lastTotalFuel: fuel.lastTotalFuel ?? null,
        },
      };

      return {
        ...prev,
        history: [snapshot, ...prev.history],
        notes: prev.notes.filter((n) => n.date !== prev.daily.date),
      };
    });
    showToast("Saved day to history", true);
  }

  function backupNow() {
    const payload = {
      kind: "BridgeLogProBackup",
      version: 2,
      savedAt: new Date().toISOString(),
      state,
    };
    const ts = new Date();
    const name = `bridge-log-backup-${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(
      ts.getDate()
    ).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}.json`;

    downloadJSON(name, payload);
  }

  async function restoreFromFile(file: File) {
    const text = await file.text();
    const parsed = safeParseJSON(text);
    const norm = normalizeBackupToState(parsed);
    if (!norm) {
      showToast("Invalid backup file");
      return;
    }
    setState(norm);
    showToast("Restore complete", true);
  }

  async function doLogin() {
    if (!loginEmail.trim()) {
      setLoginStatus("Enter email");
      return;
    }
    if (!loginPass) {
      setLoginStatus("Enter password");
      return;
    }

    setLoginStatus("Signing in…");

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPass,
    });

    if (error) {
      setLoginStatus(error.message);
      return;
    }

    setLoginStatus("Logged in ✓");
  }

  async function doLogout() {
    await supabase.auth.signOut();
    setLoginStatus("Not logged in");
    showToast("Logged out", true);
  }

  /* =========================================================
     Edit/Delete Running Log Entries
========================================================= */
  type EditScope = "today" | "history";
  type EditCtx = { scope: EditScope; dayISO: string; key: string };

  const [editOpen, setEditOpen] = useState(false);
  const [editCtx, setEditCtx] = useState<EditCtx | null>(null);
  const [editDraft, setEditDraft] = useState<RunningEntry | null>(null);

  function openEdit(scope: EditScope, dayISO: string, entry: RunningEntry) {
    setEditCtx({ scope, dayISO, key: entryKey(entry) });
    setEditDraft({ ...entry });
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditCtx(null);
    setEditDraft(null);
  }

  function applyEditedEntry(prev: AppState, ctx: EditCtx, draft: RunningEntry): AppState {
    if (ctx.scope === "today") {
      const nextLog = prev.log.map((e) => (entryKey(e) === ctx.key ? { ...draft } : e));
      return { ...prev, log: nextLog };
    }

    const nextHistory = prev.history.map((h) => {
      if (h.date !== ctx.dayISO) return h;
      const nextRunningLog = (h.runningLog ?? []).map((e) => (entryKey(e) === ctx.key ? { ...draft } : e));
      return { ...h, runningLog: nextRunningLog };
    });

    return { ...prev, history: recomputeHistoryFuelSummaries(nextHistory) };
  }

  function applyDeletedEntry(prev: AppState, ctx: EditCtx): AppState {
    if (ctx.scope === "today") {
      const nextLog = prev.log.filter((e) => entryKey(e) !== ctx.key);
      return { ...prev, log: nextLog };
    }

    const nextHistory = prev.history.map((h) => {
      if (h.date !== ctx.dayISO) return h;
      const nextRunningLog = (h.runningLog ?? []).filter((e) => entryKey(e) !== ctx.key);
      return { ...h, runningLog: nextRunningLog };
    });

    return { ...prev, history: recomputeHistoryFuelSummaries(nextHistory) };
  }

  function saveEditEntry() {
    if (!editCtx || !editDraft) return;

    const tf = editDraft.totalFuel?.trim() ?? "";
    if (tf && parseNumberLoose(tf) == null) {
      showToast("Total Fuel must be a number (or blank)");
      return;
    }

    setState((prev) => applyEditedEntry(prev, editCtx, editDraft));
    closeEdit();
    showToast("Entry updated", true);
  }

  function deleteEntry(scope: EditScope, dayISO: string, entry: RunningEntry) {
    const ok = confirm("Delete this log entry? This cannot be undone.");
    if (!ok) return;

    const ctx: EditCtx = { scope, dayISO, key: entryKey(entry) };
    setState((prev) => applyDeletedEntry(prev, ctx));
    showToast("Entry deleted", true);
  }

  /* =========================================================
     Render: Login gate
========================================================= */
  if (!sessionReady) {
    return (
      <>
        <GlobalStyles />
        <div className="container">
          <div className="col">
            <div className="section">
              <h1>BridgeLog Pro</h1>
              <div className="muted">Loading session…</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!userId) {
    return (
      <>
        <GlobalStyles />
        <div id="toast">{toast}</div>

        <div className="container">
          <header className="row app-header">
            <div className="row">
              <div className="brand-mark"><div className="brand-title"><strong>BridgeLog Pro</strong><span>Vessel logbook</span></div></div>
              <div className="badge mono">Login</div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
                {theme === "dark" ? "Light" : "Dark"} mode
              </button>
            </div>
          </header>

          <div className="col login-panel">
            <div className="section login-grid">
              <div>
                <h2>Vessel Login</h2>
              <div className="grid-3">
                <input
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="Vessel email (Supabase Auth user)"
                />
                <input
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  type="password"
                  placeholder="Password"
                />
                <button className="btn" onClick={() => void doLogin()}>
                  Login
                </button>
              </div>

              <div className="muted" style={{ marginTop: 8 }}>
                {loginStatus}
              </div>

              
              <div className="muted" style={{ marginTop: 8 }}>
                One login per vessel → each login has its own saved data automatically.
              </div>
              </div>
              <div className="login-preview" aria-label="Logbook preview">
                <div className="preview-row"><span>Today</span><strong>{prettyDate(todayISO())}</strong></div>
                <div className="preview-row"><span>Mode</span><strong>Daily bridge log</strong></div>
                <div className="preview-row"><span>Weather</span><strong>Ready for position</strong></div>
                <div className="preview-row"><span>Storage</span><strong>Cloud + local cache</strong></div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!stateHydrated || stateLoadError) {
    return (
      <>
        <GlobalStyles />
        <div id="toast">{toast}</div>
        <div className="container loading-shell">
          <div className="col">
            <div className="section">
              <h1>BridgeLog Pro</h1>
              <div className="muted">
                {stateLoadError
                  ? `Supabase load failed: ${stateLoadError}. Autosave is paused so existing vessel data is not overwritten.`
                  : "Loading vessel log from Supabase…"}
              </div>
              {stateLoadError ? (
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => window.location.reload()}>
                    Retry
                  </button>
                  <button className="btn secondary" onClick={() => void doLogout()}>
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </>
    );
  }

  const wx = state.lastWeather ?? {};

  return (
    <>
      <GlobalStyles />
      <div id="toast">{toast}</div>

      <div className="container">
        <header className="row app-header">
          <div className="row">
            <div className="brand-mark"><div className="brand-title"><strong>BridgeLog Pro</strong><span>Vessel logbook</span></div></div>
            <div className="badge mono" title="Location label">
              {activeLocLabel}
            </div>
          </div>

          <div className="row">
            <button className="btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
              {theme === "dark" ? "Light" : "Dark"} mode
            </button>
            <button className="btn" onClick={() => void useVesselPosition()}>
              Auto position
            </button>
            <button className="btn" onClick={fromPosFields}>
              From position fields
            </button>
            <button className="btn secondary" onClick={backupNow}>
              Backup JSON
            </button>
            <button className="btn secondary" onClick={() => fileInputRef.current?.click()}>
              Restore JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void restoreFromFile(f);
                e.currentTarget.value = "";
              }}
            />
            <button className="btn secondary" onClick={() => void doLogout()}>
              Logout
            </button>
          </div>
        </header>

        <div className="command-strip" aria-label="Operational glance">
          <div className="command-card"><span>Today</span><strong>{todaysLog.length}</strong><em>running entries</em></div>
          <div className="command-card"><span>Notes</span><strong>{todaysNotes.length}</strong><em>daily handover items</em></div>
          <div className="command-card"><span>Fuel Used</span><strong>{Math.round(todaysFuel.usedSum * 100) / 100} L</strong><em>computed from totals</em></div>
          <div className="command-card"><span>Weather</span><strong>{wx.condition ?? "Unset"}</strong><em>{activeLocLabel}</em></div>
        </div>

        <div className="grid grid-2">
          {/* Left column */}
          <div className="stack">
            <div className="col">
              <div className="section">
                <h2>Vessel Details</h2>
                <div className="grid-3">
                  <input
                    placeholder="Vessel name"
                    value={state.vessel.name ?? ""}
                    onChange={(e) => setState((p) => ({ ...p, vessel: { ...p.vessel, name: e.target.value } }))}
                  />
                  <input
                    placeholder="Call sign"
                    value={state.vessel.callSign ?? ""}
                    onChange={(e) => setState((p) => ({ ...p, vessel: { ...p.vessel, callSign: e.target.value } }))}
                  />
                  <input
                    placeholder="MMSI"
                    value={state.vessel.mmsi ?? ""}
                    onChange={(e) => setState((p) => ({ ...p, vessel: { ...p.vessel, mmsi: e.target.value } }))}
                  />
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="IMO Number"
                    value={state.vessel.imo ?? ""}
                    onChange={(e) => setState((p) => ({ ...p, vessel: { ...p.vessel, imo: e.target.value } }))}
                  />
                  <input
                    placeholder="Official Number (ON)"
                    value={state.vessel.officialNo ?? ""}
                    onChange={(e) =>
                      setState((p) => ({ ...p, vessel: { ...p.vessel, officialNo: e.target.value } }))
                    }
                  />
                  <input
                    placeholder="Master"
                    value={state.vessel.master ?? ""}
                    onChange={(e) => setState((p) => ({ ...p, vessel: { ...p.vessel, master: e.target.value } }))}
                  />
                </div>

                <textarea
                  placeholder="Vessel notes…"
                  style={{ marginTop: 8 }}
                  value={state.vessel.notes ?? ""}
                  onChange={(e) => setState((p) => ({ ...p, vessel: { ...p.vessel, notes: e.target.value } }))}
                />

                <div className="muted" style={{ marginTop: 6 }}>
                  Saved with daily snapshots.
                </div>
              </div>
            </div>

            <div className="col">
              <div className="section">
                <h2>Watchkeeper</h2>
                <input
                  placeholder="Active watchkeeper"
                  value={state.watchkeeper}
                  onChange={(e) => setState((p) => ({ ...p, watchkeeper: e.target.value }))}
                />
                <div className="muted" style={{ marginTop: 6 }}>
                  Auto-fills Running Log; can override per-entry.
                </div>
              </div>
            </div>

            <div className="col">
              <div className="section">
                <h2>Local Weather</h2>

                <div className="row">
                  <span>📍</span>
                  <input
                    placeholder="Location label"
                    value={state.locLabel}
                    onChange={(e) => setState((p) => ({ ...p, locLabel: e.target.value }))}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <select
                    value={positionSourceMode}
                    onChange={(e) => setPositionSourceMode(e.target.value as PositionSourceMode)}
                    style={{ maxWidth: 260 }}
                    title="Auto position source"
                  >
                    <option value="auto">Auto source</option>
                    <option value="tablet">Tablet GPS</option>
                    <option value="network">Vessel network GPS</option>
                  </select>
                  <button className="btn" onClick={() => void useVesselPosition()}>
                    Auto position
                  </button>
                  <button className="btn" onClick={fromPosFields}>
                    From position fields
                  </button>
                  <span className="muted right">
                    {activeCoords.lat != null && activeCoords.lon != null
                      ? `For ${activeCoords.lat.toFixed(4)}, ${activeCoords.lon.toFixed(4)}`
                      : "Use auto position or manual entry"}
                  </span>
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <div className="badge">GPS source: <span className="right">{gpsStatus}</span></div>
                  <div className="muted">Auto source: <span className="mono">{autoPositionBackendLabel}</span></div>
                  <div className="muted">{gpsTelemetry}</div>
                </div>

                <div className="weather-hero" style={{ marginTop: 8 }}>
                  <div className="weather-icon">{wxIcon(wx.weatherCode)}</div>
                  <div>
                    <strong>{wx.condition ?? "Weather not set"}</strong>
                    <span>{windSummary(wx)}</span>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div className="badge">
                    Temp <span className="right">{wx.tempC != null ? `${wx.tempC}°C` : "—°C"}</span>
                  </div>
                  <div className="badge">
                    Wind{" "}
                    <span className="right">
                      {wx.windKts != null ? `${wx.windKts} kt` : "— kt"} / {wx.windDir != null ? `${wx.windDir}°` : "—°"}
                    </span>
                  </div>
                  <div className="badge">
                    Pressure <span className="right">{wx.pressure != null ? `${wx.pressure} hPa` : "— hPa"}</span>
                  </div>
                  <div className="badge">
                    Vis{" "}
                    <span className="right">
                      {wx.visibilityKm != null ? `${wx.visibilityKm.toFixed(1)} km` : "— km"}
                    </span>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div className="badge">
                    Humidity <span className="right">{wx.humidityPct != null ? `${wx.humidityPct}%` : "—%"}</span>
                  </div>
                  <div className="badge">
                    Cloud <span className="right">{wx.cloudPct != null ? `${wx.cloudPct}%` : "—%"}</span>
                  </div>
                  <div className="badge">
                    Precip <span className="right">{wx.precipMmHr != null ? `${wx.precipMmHr} mm/h` : "— mm/h"}</span>
                  </div>
                  <div className="badge">
                    Dew Pt <span className="right">{wx.dewPointC != null ? `${wx.dewPointC}°C` : "—°C"}</span>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <b>🌊 Marine</b>
                  <span className="right">
                    Hs {wx.waveHeightM != null ? wx.waveHeightM.toFixed(1) : "—"} m • Tp{" "}
                    {wx.wavePeriodS != null ? wx.wavePeriodS.toFixed(0) : "—"} s • Dir{" "}
                    {wx.waveDirDeg != null ? wx.waveDirDeg : "—"}°
                  </span>
                </div>
              </div>
            </div>

            <div className="col">
              <div className="section">
                <h2>Reference Scales</h2>

                <div className="stack">
                  <div>
                    <div className="muted" style={{ marginBottom: 6 }}>
                      Beaufort (wind / wave)
                    </div>
                    {BEAUFORT.map((b) => (
                      <div className="row" key={b.force}>
                        <div className="pill">B {b.force}</div>
                        <span>{b.wind}</span>
                        <span className="right">{b.wave}</span>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="muted" style={{ marginBottom: 6 }}>
                      Visibility
                    </div>
                    {VIS.map((v) => (
                      <div className="row" style={{ justifyContent: "space-between" }} key={v.label}>
                        <span>{v.label}</span>
                        <span className="muted">{v.range}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="stack">
            <div className="col entry-card">
              <div className="section">
                <h2>New Running Log Entry</h2>

                <div className="nmea-panel">
                  <div className="nmea-head">
                    <div className={`nmea-status ${nmeaFeed.status}`}>
                      <span className="nmea-dot" />
                      NMEA TCP {nmeaStatusLabel}
                    </div>
                    <div className="muted">
                      Send to <span className="mono">{nmeaEndpoint}</span> • {nmeaFeed.connectedClients} client
                      {nmeaFeed.connectedClients === 1 ? "" : "s"} • {nmeaFeed.sentenceCount} sentences
                    </div>
                  </div>

                  <div className="nmea-grid">
                    <div className="nmea-value">
                      <span>Position</span>
                      <b>
                        {nmea.latitude != null && nmea.longitude != null
                          ? `${nmea.latitude.toFixed(5)}, ${nmea.longitude.toFixed(5)}`
                          : "--"}
                      </b>
                    </div>
                    <div className="nmea-value">
                      <span>SOG</span>
                      <b>{formatMaybe(nmea.speedKnots, " kt")}</b>
                    </div>
                    <div className="nmea-value">
                      <span>COG</span>
                      <b>{formatMaybe(nmea.courseDeg, "°", 0)}</b>
                    </div>
                    <div className="nmea-value">
                      <span>Heading</span>
                      <b>{formatMaybe(nmea.headingDeg, "°", 0)}</b>
                    </div>
                    <div className="nmea-value">
                      <span>Wind</span>
                      <b>
                        {nmea.windAngleDeg != null || nmea.windSpeedKnots != null
                          ? `${formatMaybe(nmea.windAngleDeg, "°", 0)} / ${formatMaybe(nmea.windSpeedKnots, " kt")}`
                          : "--"}
                      </b>
                    </div>
                    <div className="nmea-value">
                      <span>Depth</span>
                      <b>{formatMaybe(nmea.depthMeters, " m")}</b>
                    </div>
                  </div>

                  <div className="nmea-footer">
                    <button className="btn" type="button" onClick={autoFillFromNmea}>
                      Auto-fill Bridge Log
                    </button>
                    <span className="muted">
                      {nmea.updatedAt
                        ? `Latest ${new Date(nmea.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                        : nmeaFeed.lastError || "Waiting for GGA/RMC/VTG/HDT/HDG/MWV/DBT/DPT"}
                    </span>
                  </div>
                </div>

                <div className="grid-4">
                  <div className="row">
                    <input className="mono" readOnly value={nowHHMM()} />
                    <button className="btn" onClick={() => showToast("Time stamps automatically", true)}>
                      Stamp time
                    </button>
                  </div>

                  <div className="muted">Position</div>

                  <div className="position-autofill">
                    <button className="btn" onClick={() => void useVesselPosition()}>
                      Auto-fill position
                    </button>
                    <div>
                      <div>
                        <b>{gpsStatus}</b>
                        <span className="muted"> • {activeCoords.lat != null && activeCoords.lon != null ? `${activeCoords.lat.toFixed(5)}, ${activeCoords.lon.toFixed(5)}` : "No position yet"}</span>
                      </div>
                      <div className="muted">
                        {gpsTelemetry || `Waiting for ${autoPositionLabel}`} • Manual lat/long below remains editable.
                      </div>
                    </div>
                  </div>
                  <div className="pos-row">
                    <input
                      className="mono"
                      placeholder="Lat°"
                      value={state.pos.latDeg}
                      onChange={(e) => setState((p) => ({ ...p, pos: { ...p.pos, latDeg: e.target.value } }))}
                    />
                    <input
                      className="mono"
                      placeholder="Lat'"
                      value={state.pos.latMin}
                      onChange={(e) => setState((p) => ({ ...p, pos: { ...p.pos, latMin: e.target.value } }))}
                    />
                    <input
                      className="mono"
                      placeholder="Lat .mmm"
                      value={state.pos.latMinDec}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          pos: { ...p.pos, latMinDec: e.target.value },
                        }))
                      }
                    />
                    <select
                      value={state.pos.latHem}
                      onChange={(e) =>
                        setState((p) => ({ ...p, pos: { ...p.pos, latHem: e.target.value as "N" | "S" } }))
                      }
                    >
                      <option value="N">N</option>
                      <option value="S">S</option>
                    </select>
                  </div>

                  <div className="pos-row">
                    <input
                      className="mono"
                      placeholder="Lon°"
                      value={state.pos.lonDeg}
                      onChange={(e) => setState((p) => ({ ...p, pos: { ...p.pos, lonDeg: e.target.value } }))}
                    />
                    <input
                      className="mono"
                      placeholder="Lon'"
                      value={state.pos.lonMin}
                      onChange={(e) => setState((p) => ({ ...p, pos: { ...p.pos, lonMin: e.target.value } }))}
                    />
                    <input
                      className="mono"
                      placeholder="Lon .mmm"
                      value={state.pos.lonMinDec}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          pos: { ...p.pos, lonMinDec: e.target.value },
                        }))
                      }
                    />
                    <select
                      value={state.pos.lonHem}
                      onChange={(e) =>
                        setState((p) => ({ ...p, pos: { ...p.pos, lonHem: e.target.value as "E" | "W" } }))
                      }
                    >
                      <option value="E">E</option>
                      <option value="W">W</option>
                    </select>
                  </div>
                </div>

                <div className="grid-4" style={{ marginTop: 6 }}>
                  <input
                    placeholder="Course Magnetic (°M)"
                    value={entryFields.courseMagnetic}
                    onChange={(e) => setEntryFields((p) => ({ ...p, courseMagnetic: e.target.value }))}
                  />
                  <input
                    placeholder="Course Gyro (°)"
                    value={entryFields.courseGyro}
                    onChange={(e) => setEntryFields((p) => ({ ...p, courseGyro: e.target.value }))}
                  />
                  <input
                    placeholder="Steering (°)"
                    value={entryFields.courseSteering}
                    onChange={(e) => setEntryFields((p) => ({ ...p, courseSteering: e.target.value }))}
                  />
                  <input
                    placeholder="Speed (kt)"
                    value={entryFields.speed}
                    onChange={(e) => setEntryFields((p) => ({ ...p, speed: e.target.value }))}
                  />
                </div>

                <div className="grid-4" style={{ marginTop: 6 }}>
                  <input
                    placeholder="Wind Dir (°true)"
                    value={entryFields.windDir}
                    onChange={(e) => setEntryFields((p) => ({ ...p, windDir: e.target.value }))}
                  />
                  <select
                    value={entryFields.windForce}
                    onChange={(e) => {
                      const v = e.target.value;
                      const bf = BEAUFORT.find((x) => String(x.force) === v);
                      setEntryFields((p) => ({ ...p, windForce: v, sea: p.sea || (bf?.wave ?? "") }));
                    }}
                  >
                    <option value="">Beaufort B#…</option>
                    {BEAUFORT.map((b) => (
                      <option key={b.force} value={String(b.force)}>
                        {`B ${b.force} — ${b.wind}`}
                      </option>
                    ))}
                  </select>

                  <select value={entryFields.sea} onChange={(e) => setEntryFields((p) => ({ ...p, sea: e.target.value }))}>
                    <option value="">Sea (m)…</option>
                    {BEAUFORT.map((b) => (
                      <option key={b.force} value={b.wave}>
                        {`${b.wave} — B ${b.force} ${b.wind}`}
                      </option>
                    ))}
                  </select>

                  <select value={entryFields.sky} onChange={(e) => setEntryFields((p) => ({ ...p, sky: e.target.value }))}>
                    <option value="">Sky (Beaufort notation)…</option>
                    {SKY.map((s) => (
                      <option key={s.code} value={s.code}>
                        {`${s.code} — ${s.label}`}
                      </option>
                    ))}
                  </select>
                </div>
               
                <div className="grid-4" style={{ marginTop: 6 }}>
                  <select
                    value={entryFields.visibility}
                    onChange={(e) => setEntryFields((p) => ({ ...p, visibility: e.target.value }))}
                  >
                    <option value="">Visibility…</option>
                    {VIS.map((v) => (
                      <option key={v.label} value={`${v.label} (${v.range})`}>
                        {`${v.label} (${v.range})`}
                      </option>
                    ))}
                  </select>

                  <input
                    placeholder="Barometer (hPa)"
                    value={entryFields.barometer}
                    onChange={(e) => setEntryFields((p) => ({ ...p, barometer: e.target.value }))}
                  />
                  <input
                    placeholder="Air Temp (°C)"
                    value={entryFields.airTemp}
                    onChange={(e) => setEntryFields((p) => ({ ...p, airTemp: e.target.value }))}
                  />
                  <input
                    placeholder="Sea Temp (°C)"
                    value={entryFields.seaTemp}
                    onChange={(e) => setEntryFields((p) => ({ ...p, seaTemp: e.target.value }))}
                  />
                </div>

                <div className="grid-4" style={{ marginTop: 6 }}>
                  <input
                    placeholder="Engines"
                    value={entryFields.engines}
                    onChange={(e) => setEntryFields((p) => ({ ...p, engines: e.target.value }))}
                  />
                  <input
                    placeholder="Watchkeeper"
                    value={entryFields.watchkeeper}
                    onChange={(e) => setEntryFields((p) => ({ ...p, watchkeeper: e.target.value }))}
                  />
                  <input
                    placeholder="Total Fuel (L)"
                    value={entryFields.totalFuel}
                    onChange={(e) => setEntryFields((p) => ({ ...p, totalFuel: e.target.value }))}
                  />
                  <button className="btn" onClick={addEntry}>
                    Add Entry
                  </button>
                </div>

                <div className="grid-3" style={{ marginTop: 6 }}>
                  <input
                    placeholder="Remarks"
                    value={entryFields.remarks}
                    onChange={(e) => setEntryFields((p) => ({ ...p, remarks: e.target.value }))}
                  />
                  <div className="muted">
                    Fuel Used is calculated as <span className="mono">prev total − current total</span>.
                  </div>
                  <div className="muted right">Tip: first entry uses yesterday’s saved total fuel (if present).</div>
                </div>
              </div>
            </div>

            <div className="col daily-log-card">
              <div className="section">
                <h2>Daily Log</h2>

                <div className="grid-3">
                  <input
                    type="date"
                    value={state.daily.date}
                    onChange={(e) => setState((p) => ({ ...p, daily: { ...p.daily, date: e.target.value } }))}
                  />
                  <input
                    placeholder="Location"
                    value={state.daily.location}
                    onChange={(e) => setState((p) => ({ ...p, daily: { ...p.daily, location: e.target.value } }))}
                  />
                  <select
                    value={state.daily.mode}
                    onChange={(e) =>
                      setState((p) => ({
                        ...p,
                        daily: { ...p.daily, mode: e.target.value as DailyState["mode"] },
                      }))
                    }
                  >
                    <option value="Along">Along</option>
                    <option value="@Anchor">@Anchor</option>
                    <option value="Underway">Underway</option>
                    <option value="Moored">Moored</option>
                  </select>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn" onClick={() => addMovement("Along")}>
                    Along
                  </button>
                  <button className="btn" onClick={() => addMovement("Cast Off")}>
                    Cast Off
                  </button>
                  <button className="btn" onClick={() => addMovement("Anchor Down")}>
                    Anchor Down
                  </button>
                  <button className="btn" onClick={() => addMovement("Anchor Up")}>
                    Anchor Up
                  </button>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div className="badge">
                    ⛽ Fuel used today: <span className="right">{Math.round(todaysFuel.usedSum * 100) / 100} L</span>
                  </div>
                  <div className="badge">
                    Daily NM: <span className="right">{fmtNm(todaysTrack.totalNm)}</span>
                  </div>
                  <span className="muted right">
                    Last total fuel: {todaysFuel.lastTotalFuel != null ? todaysFuel.lastTotalFuel : "—"}
                  </span>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <input
                    placeholder="Add note…"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addNote();
                    }}
                  />
                  <button className="btn" onClick={addNote}>
                    Add
                  </button>
                </div>

                <div
                  className="badge"
                  style={{
                    display: todaysNotes.length ? "block" : "none",
                    maxHeight: 120,
                    overflow: "auto",
                    marginTop: 6,
                    padding: 8,
                  }}
                >
                  {todaysNotes.map((n, idx) => (
                    <div key={`${n.time}-${idx}`} style={{ padding: "2px 0" }}>
                      <span className="mono" style={{ opacity: 0.7, marginRight: 8 }}>
                        [{n.time}]
                      </span>
                      {n.text}
                    </div>
                  ))}
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn" onClick={saveDayToHistory}>
                    Save Day to History
                  </button>
                </div>

                <div className="muted" style={{ marginTop: 6 }}>
                  Auto-saves at midnight (device timezone) and starts a new day.
                </div>
              </div>
            </div>

            <div className="col track-card">
              <div className="section track-panel">
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Track Plot
                  <button className="btn secondary right" type="button" onClick={() => setMapOpen(true)}>
                    Large Chart
                  </button>
                  <span className="muted">{todaysTrack.points.length} fixes</span>
                </h2>

                <TrackPlotView
                  track={todaysTrack}
                  emptyText="Add two running log entries with positions and BridgeLog Pro will plot the day track over a map and calculate NM between fixes."
                />
              </div>
            </div>
            {/* Running Log (Tablet-fit columns) */}
            <div className="col running-log-card">
              <div className="section">
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Running Log
                  <span className="right muted">{prettyDate(state.daily.date)}</span>
                </h2>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Position</th>
                        <th>C(M)</th>

                        {/* hide on tablet */}
                        <th className="tablet-hide">C(G)</th>
                        <th className="tablet-hide">Steer</th>

                        <th>Spd</th>

                        {/* hide on tablet */}
                        <th className="tablet-hide">Wind°</th>

                        <th>B</th>

                        {/* hide on tablet */}
                        <th className="tablet-hide">Sea</th>
                        <th className="tablet-hide">Sky</th>

                        <th>Vis</th>
                        <th>Baro</th>
                        <th>Air</th>

                        {/* hide on tablet */}
                        <th className="tablet-hide">SeaT</th>
                        <th className="tablet-hide">Eng</th>
                        <th className="tablet-hide">Watch</th>

                        <th>Total Fuel (L)</th>
                        <th>Used (L)</th>
                        <th>Remarks</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todaysLog.length === 0 ? (
                        <tr>
                          <td colSpan={20} style={{ textAlign: "center", opacity: 0.7, padding: "10px 0" }}>
                            No entries yet.
                          </td>
                        </tr>
                      ) : (
                        todaysLog.map((r, idx) => {
                          const used = todaysFuel.perEntryUsed[idx];
                          return (
                            <tr key={`${r.time}-${idx}`}>
                              <td>{r.time}</td>
                              <td>{r.position}</td>
                              <td>{r.courseMagnetic}</td>

                              <td className="tablet-hide">{r.courseGyro}</td>
                              <td className="tablet-hide">{r.courseSteering}</td>

                              <td>{r.speed}</td>

                              <td className="tablet-hide">{r.windDir}</td>

                              <td>{r.windForce}</td>

                              <td className="tablet-hide">{r.sea}</td>
                              <td className="tablet-hide">{r.sky}</td>

                              <td>{r.visibility}</td>
                              <td>{r.barometer}</td>
                              <td>{r.airTemp}</td>

                              <td className="tablet-hide">{r.seaTemp}</td>
                              <td className="tablet-hide">{r.engines}</td>
                              <td className="tablet-hide">{r.watchkeeper}</td>

                              <td className="mono">{r.totalFuel || "—"}</td>
                              <td className="mono">{used != null ? (Math.round(used * 100) / 100).toString() : "—"}</td>

                              <td className="remarks-cell" title={r.remarks}>
                                {r.remarks || "—"}
                              </td>

                              <td style={{ whiteSpace: "nowrap" }}>
                                <button className="btn" onClick={() => openEdit("today", state.daily.date, r)}>
                                  Edit
                                </button>{" "}
                                <button className="btn danger" onClick={() => deleteEntry("today", state.daily.date, r)}>
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="muted" style={{ marginTop: 8 }}>
                  Fuel Used per entry = previous total fuel − current total fuel (first entry uses yesterday’s saved total if available).
                </div>
              </div>
            </div>

            {/* Daily History (Tablet-fit columns) */}
            <div className="col history-card">
              <div className="section">
                <h2>Daily History</h2>

                {state.history.length === 0 ? (
                  <div className="muted">No history saved yet.</div>
                ) : (
                  state.history.map((h, idx) => (
                    <details key={`${h.date}-${idx}`}>
                      <summary>
                        <b>{prettyDate(h.date)}</b> — {h.location || "(no location)"} • {h.vesselMode}
                        {h.fuelSummary?.usedLitres != null ? (
                          <span className="muted"> • ⛽ {h.fuelSummary.usedLitres} L</span>
                        ) : null}
                        <span className="muted"> • {fmtNm(buildTrack(h.runningLog || []).totalNm)}</span>
                      </summary>

                      <div className="grid-3" style={{ marginTop: 6 }}>
                        <div>
                          <div>
                            <b>Weather</b>
                          </div>
                          <div>Cond: {h.weather?.condition ?? "—"}</div>
                          <div>Temp: {h.weather?.tempC ?? "—"}°C</div>
                          <div>
                            Wind: {h.weather?.windKts ?? "—"} kt / {h.weather?.windDir ?? "—"}°
                          </div>
                          <div>Pressure: {h.weather?.pressure ?? "—"} hPa</div>
                          <div>Vis: {h.weather?.visibilityKm ?? "—"} km</div>
                          <div>
                            <b>Fuel</b>
                          </div>
                          <div>Used: {h.fuelSummary?.usedLitres != null ? `${h.fuelSummary.usedLitres} L` : "—"}</div>
                          <div>
                            Last Total: {h.fuelSummary?.lastTotalFuel != null ? `${h.fuelSummary.lastTotalFuel}` : "—"}
                          </div>
                          <div>
                            <b>Marine</b>
                          </div>
                          <div>
                            Hs {h.weather?.waveHeightM != null ? h.weather.waveHeightM.toFixed(1) : "—"} m • Tp{" "}
                            {h.weather?.wavePeriodS != null ? h.weather.wavePeriodS.toFixed(0) : "—"} s • Dir{" "}
                            {h.weather?.waveDirDeg ?? "—"}°
                          </div>
                        </div>

                        <div>
                          <div>
                            <b>Vessel</b>
                          </div>
                          <div>
                            {h.vessel?.name || "—"} • {h.vessel?.callSign || ""} • {h.vessel?.mmsi || ""}
                          </div>
                          {h.vessel?.notes ? <div className="muted">Notes: {h.vessel.notes}</div> : null}
                        </div>

                        <div>
                          <div>
                            <b>Notes</b>
                          </div>
                          <div className="badge" style={{ display: "block", maxHeight: 120, overflow: "auto", padding: 8 }}>
                            {(h.notes || []).map((n, j) => (
                              <div key={`${n.time}-${j}`}>
                                [{n.time}] {n.text}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div style={{ gridColumn: "1 / -1" }}>
                          <div>
                            <b>Track Plot</b>
                          </div>
                          <TrackPlotView
                            track={buildTrack(h.runningLog || [])}
                            emptyText="No plotted positions saved for this day."
                            compact
                          />
                        </div>

                        <div style={{ gridColumn: "1 / -1" }}>
                          <div>
                            <b>Running Log</b>
                          </div>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Time</th>
                                  <th>Position</th>
                                  <th>C(M)</th>

                                  <th className="tablet-hide">C(G)</th>
                                  <th className="tablet-hide">Steer</th>

                                  <th>Spd</th>

                                  <th className="tablet-hide">Wind°</th>

                                  <th>B</th>

                                  <th className="tablet-hide">Sea</th>
                                  <th className="tablet-hide">Sky</th>

                                  <th>Vis</th>
                                  <th>Baro</th>
                                  <th>Air</th>

                                  <th className="tablet-hide">SeaT</th>
                                  <th className="tablet-hide">Eng</th>
                                  <th className="tablet-hide">Watch</th>

                                  <th>Total Fuel</th>
                                  <th>Remarks</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(h.runningLog || []).map((r, j) => (
                                  <tr key={`${r.time}-${j}`}>
                                    <td>{r.time}</td>
                                    <td>{r.position}</td>
                                    <td>{r.courseMagnetic}</td>

                                    <td className="tablet-hide">{r.courseGyro}</td>
                                    <td className="tablet-hide">{r.courseSteering}</td>

                                    <td>{r.speed}</td>

                                    <td className="tablet-hide">{r.windDir}</td>

                                    <td>{r.windForce}</td>

                                    <td className="tablet-hide">{r.sea}</td>
                                    <td className="tablet-hide">{r.sky}</td>

                                    <td>{r.visibility}</td>
                                    <td>{r.barometer}</td>
                                    <td>{r.airTemp}</td>

                                    <td className="tablet-hide">{r.seaTemp}</td>
                                    <td className="tablet-hide">{r.engines}</td>
                                    <td className="tablet-hide">{r.watchkeeper}</td>

                                    <td className="mono">{r.totalFuel || "—"}</td>
                                    <td className="remarks-cell">{r.remarks}</td>
                                    <td style={{ whiteSpace: "nowrap" }}>
                                      <button className="btn" onClick={() => openEdit("history", h.date, r)}>
                                        Edit
                                      </button>{" "}
                                      <button className="btn danger" onClick={() => deleteEntry("history", h.date, r)}>
                                        Delete
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="muted" style={{ marginTop: 6 }}>
                            Editing history re-computes fuel summaries forward in time.
                          </div>
                        </div>
                      </div>
                    </details>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {mapOpen && (
          <div className="modal-backdrop" onClick={() => setMapOpen(false)}>
            <div className="modal track-modal" onClick={(e) => e.stopPropagation()}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>Large Track Plot</h2>
                <button className="btn secondary" type="button" onClick={() => setMapOpen(false)}>
                  Close
                </button>
              </div>
              <TrackPlotView
                track={todaysTrack}
                emptyText="Add two running log entries with positions and BridgeLog Pro will plot the day track over a map."
                large
              />
            </div>
          </div>
        )}
        {/* Edit Modal */}
        {editOpen && editDraft && editCtx && (
          <div className="modal-backdrop" onClick={closeEdit}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginTop: 0 }}>
                Edit Log Entry{" "}
                <span className="muted">
                  ({editCtx.scope === "today" ? "Today" : "History"} • {prettyDate(editCtx.dayISO)})
                </span>
              </h2>

              <div className="grid-3">
                <input className="mono" readOnly value={editDraft.date} />
                <input className="mono" readOnly value={editDraft.time} />
                <input className="mono" readOnly value={editDraft.position} />
              </div>

              <div className="grid-4" style={{ marginTop: 8 }}>
                <input
                  placeholder="Course Magnetic (°M)"
                  value={editDraft.courseMagnetic}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, courseMagnetic: e.target.value } : p))}
                />
                <input
                  placeholder="Course Gyro (°)"
                  value={editDraft.courseGyro}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, courseGyro: e.target.value } : p))}
                />
                <input
                  placeholder="Steering (°)"
                  value={editDraft.courseSteering}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, courseSteering: e.target.value } : p))}
                />
                <input
                  placeholder="Speed (kt)"
                  value={editDraft.speed}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, speed: e.target.value } : p))}
                />
              </div>

              <div className="grid-4" style={{ marginTop: 8 }}>
                <input
                  placeholder="Wind Dir (°true)"
                  value={editDraft.windDir}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, windDir: e.target.value } : p))}
                />
                <input
                  placeholder="Beaufort (B#)"
                  value={editDraft.windForce}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, windForce: e.target.value } : p))}
                />
                <input
                  placeholder="Sea"
                  value={editDraft.sea}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, sea: e.target.value } : p))}
                />
                <input
                  placeholder="Sky"
                  value={editDraft.sky}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, sky: e.target.value } : p))}
                />
              </div>

              <div className="grid-4" style={{ marginTop: 8 }}>
                <input
                  placeholder="Visibility"
                  value={editDraft.visibility}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, visibility: e.target.value } : p))}
                />
                <input
                  placeholder="Barometer (hPa)"
                  value={editDraft.barometer}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, barometer: e.target.value } : p))}
                />
                <input
                  placeholder="Air Temp (°C)"
                  value={editDraft.airTemp}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, airTemp: e.target.value } : p))}
                />
                <input
                  placeholder="Sea Temp (°C)"
                  value={editDraft.seaTemp}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, seaTemp: e.target.value } : p))}
                />
              </div>

              <div className="grid-4" style={{ marginTop: 8 }}>
                <input
                  placeholder="Engines"
                  value={editDraft.engines}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, engines: e.target.value } : p))}
                />
                <input
                  placeholder="Watchkeeper"
                  value={editDraft.watchkeeper}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, watchkeeper: e.target.value } : p))}
                />
                <input
                  placeholder="Total Fuel (L)"
                  value={editDraft.totalFuel}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, totalFuel: e.target.value } : p))}
                />
                <input
                  placeholder="Remarks"
                  value={editDraft.remarks}
                  onChange={(e) => setEditDraft((p) => (p ? { ...p, remarks: e.target.value } : p))}
                />
              </div>

              <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                <button className="btn" onClick={closeEdit}>
                  Cancel
                </button>
                <button className="btn" onClick={saveEditEntry}>
                  Save
                </button>
              </div>

              <div className="muted" style={{ marginTop: 8 }}>
                Tip: fixing <span className="mono">Total Fuel (L)</span> will immediately correct “Used (L)” and daily totals.
              </div>
            </div>
          </div>
        )}

        <footer className="muted" style={{ marginTop: 10 }}>
          © {new Date().getFullYear()} Obsidian Marine — BridgeLog Pro.
        </footer>
      </div>
    </>
  );
}

