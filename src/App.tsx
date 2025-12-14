import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";


/* =========================================================
   Supabase Config
   - Recommended: set in .env as:
     VITE_SUPABASE_URL=...
     VITE_SUPABASE_ANON_KEY=...
========================================================= */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

// Create client lazily (avoids accidental creation with empty env)
function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* =========================================================
   Types
========================================================= */
type Theme = "dark" | "light";

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
  latHem: "N" | "S";
  lonDeg: string;
  lonMin: string;
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
  courseTrue: string;
  courseGyro: string;
  courseSteering: string;
  speed: string;
  windDir: string;
  windForce: string; // Beaufort number string
  sea: string;
  sky: string;
  visibility: string;
  barometer: string;
  airTemp: string;
  seaTemp: string;
  engines: string;
  watchkeeper: string;
  remarks: string;
};

type WeatherState = {
  tempC?: number | null;
  windKts?: number | null;
  windDir?: number | null;
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

type HistoryDay = {
  date: string;
  location: string;
  vesselMode: DailyState["mode"];
  vessel: VesselDetails;
  notes: Note[];
  weather: WeatherState;
  runningLog: RunningEntry[];
};

/** The full app state we persist */
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
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(
    2,
    "0"
  )}`;
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
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
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
      latHem: "S",
      lonDeg: "",
      lonMin: "",
      lonHem: "E",
    },
    daily: { date: todayISO(), location: "", mode: "Along" },
    coords: { lat: null, lon: null },
    locLabel: "Cairns, QLD",
    lastWeather: {},
    updatedAtISO: new Date().toISOString(),
  };
}

function normalizeBackupToState(obj: unknown): AppState | null {
  const fallback: AppState = defaultState();
  if (!obj || typeof obj !== "object") return null;

  const asAny = obj as Record<string, unknown>;
  const src =
    asAny.kind === "BridgeLogProBackup" && asAny.state ? asAny.state : obj;

  if (!src || typeof src !== "object") return null;
  const s = src as Record<string, unknown>;

  const vessel =
    s.vessel && typeof s.vessel === "object"
      ? (s.vessel as VesselDetails)
      : {};
  const notes = Array.isArray(s.notes) ? (s.notes as Note[]) : [];
  const log = Array.isArray(s.log) ? (s.log as RunningEntry[]) : [];
  const history = Array.isArray(s.history) ? (s.history as HistoryDay[]) : [];

  const pos =
    s.pos && typeof s.pos === "object" ? (s.pos as PosState) : fallback.pos;

  const daily =
    s.daily && typeof s.daily === "object"
      ? (s.daily as DailyState)
      : fallback.daily;

  const coords =
    s.coords && typeof s.coords === "object"
      ? (s.coords as { lat: number | null; lon: number | null })
      : fallback.coords;

  const watchkeeper = typeof s.watchkeeper === "string" ? s.watchkeeper : "";
  const locLabel =
    typeof s.locLabel === "string" ? s.locLabel : fallback.locLabel;

  const lastWeather =
    s.lastWeather && typeof s.lastWeather === "object"
      ? (s.lastWeather as WeatherState)
      : fallback.lastWeather;

  const normalized: AppState = {
    vessel: vessel ?? {},
    watchkeeper,
    notes: notes
      .filter(
        (n) =>
          n &&
          typeof n === "object" &&
          typeof (n as Note).text === "string"
      )
      .map((n) => ({
        date: String((n as Note).date ?? daily.date ?? todayISO()),
        time: String((n as Note).time ?? ""),
        text: String((n as Note).text ?? ""),
      })),
    log: log
      .filter(
        (r) =>
          r &&
          typeof r === "object" &&
          typeof (r as RunningEntry).time === "string"
      )
      .map((r) => ({
        date: String((r as RunningEntry).date ?? daily.date ?? todayISO()),
        time: String((r as RunningEntry).time ?? ""),
        position: String((r as RunningEntry).position ?? ""),
        courseTrue: String((r as RunningEntry).courseTrue ?? ""),
        courseGyro: String((r as RunningEntry).courseGyro ?? ""),
        courseSteering: String((r as RunningEntry).courseSteering ?? ""),
        speed: String((r as RunningEntry).speed ?? ""),
        windDir: String((r as RunningEntry).windDir ?? ""),
        windForce: String((r as RunningEntry).windForce ?? ""),
        sea: String((r as RunningEntry).sea ?? ""),
        sky: String((r as RunningEntry).sky ?? ""),
        visibility: String((r as RunningEntry).visibility ?? ""),
        barometer: String((r as RunningEntry).barometer ?? ""),
        airTemp: String((r as RunningEntry).airTemp ?? ""),
        seaTemp: String((r as RunningEntry).seaTemp ?? ""),
        engines: String((r as RunningEntry).engines ?? ""),
        watchkeeper: String(
          (r as RunningEntry).watchkeeper ?? watchkeeper ?? ""
        ),
        remarks: String((r as RunningEntry).remarks ?? ""),
      })),
    history: history
      .filter(
        (h) =>
          h &&
          typeof h === "object" &&
          typeof (h as HistoryDay).date === "string"
      )
      .map((h) => ({
        date: String((h as HistoryDay).date ?? ""),
        location: String((h as HistoryDay).location ?? ""),
        vesselMode:
          (String((h as HistoryDay).vesselMode ?? "Along") as DailyState["mode"]) ??
          "Along",
        vessel:
          (h as HistoryDay).vessel && typeof (h as HistoryDay).vessel === "object"
            ? (h as HistoryDay).vessel
            : vessel,
        notes: Array.isArray((h as HistoryDay).notes)
          ? (h as HistoryDay).notes
          : [],
        weather:
          (h as HistoryDay).weather && typeof (h as HistoryDay).weather === "object"
            ? (h as HistoryDay).weather
            : {},
        runningLog: Array.isArray((h as HistoryDay).runningLog)
          ? (h as HistoryDay).runningLog
          : [],
      })),
    pos: {
      latDeg: String((pos as PosState).latDeg ?? ""),
      latMin: String((pos as PosState).latMin ?? ""),
      latHem: ((pos as PosState).latHem ?? "S") as "N" | "S",
      lonDeg: String((pos as PosState).lonDeg ?? ""),
      lonMin: String((pos as PosState).lonMin ?? ""),
      lonHem: ((pos as PosState).lonHem ?? "E") as "E" | "W",
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

/* =========================================================
   Supabase Storage (per vessel login)
========================================================= */
async function loadStateFromSupabase(
  supabase: SupabaseClient,
  userId: string
): Promise<AppState | null> {
  const { data, error } = await supabase
    .from("blp_state")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  if (!data || !data.state) return null;

  const norm = normalizeBackupToState(data.state);
  return norm ?? null;
}

async function upsertStateToSupabase(
  supabase: SupabaseClient,
  userId: string,
  state: AppState
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    user_id: userId,
    state,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("blp_state")
    .upsert(payload, { onConflict: "user_id" });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* =========================================================
   Styles
========================================================= */
function GlobalStyles() {
  return (
    <style>{`
      :root { --bg:#f6f7fb; --fg:#0a0a0a; --muted:#60646c; --card:#fff; --card-border:#e7e8ec; --input-bg:#fff; --input-border:#d7d9df; --badge-bg:#f1f3f7; --btn-bg:#111827; --btn-border:#0b1220; --btn-hover:#0d1526; --table-head:#f1f3f7; --warn:#7c2d12; --ok:#14532d; }
      html[data-theme="dark"] { --bg:#0b0b0b; --fg:#fff; --muted:#bbb; --card:#111; --card-border:#2a2a2a; --input-bg:#0b0b0b; --input-border:#2a2a2a; --badge-bg:#1a1a1a; --btn-bg:#222; --btn-border:#3a3a3a; --btn-hover:#2a2a2a; --table-head:#0f0f0f; --warn:#fb923c; --ok:#4ade80; }
      html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,Noto Sans; height:auto; min-height:100%;}
      body{overflow:auto;}
      .container{max-width:1120px;margin:0 auto;padding:16px}
      .grid{display:grid;gap:12px}
      .col{background:var(--card);border:1px solid var(--card-border);border-radius:16px;overflow:hidden}
      .section{padding:12px 14px}
      h2{font-size:14px;margin:0 0 8px 0;font-weight:600;color:var(--fg)}
      h1{font-size:20px;margin:0 0 8px 0;font-weight:700;color:var(--fg)}
      .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      input,select,textarea{background:var(--input-bg);border:1px solid var(--input-border);color:var(--fg);padding:8px 10px;border-radius:8px;width:100%;box-sizing:border-box}
      input::placeholder,textarea::placeholder{color:var(--muted)}
      textarea{min-height:80px}
      .btn{background:var(--btn-bg);color:#fff;border:1px solid var(--btn-border);padding:8px 12px;border-radius:8px;cursor:pointer}
      .btn:hover{background:var(--btn-hover)}
      .muted{color:var(--muted);font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:12px;color:var(--fg)}
      th,td{text-align:left;padding:6px 8px;white-space:nowrap;border-color:var(--card-border)}
      thead{background:var(--table-head)}
      tbody tr{border-top:1px solid var(--card-border)}
      .pill{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;border:1px solid var(--card-border);background:var(--badge-bg);font-size:12px;color:var(--fg)}
      .badge{display:inline-flex;align-items:center;gap:6px;padding:2px 6px;border-radius:6px;border:1px solid var(--card-border);background:var(--badge-bg);font-size:11px;color:var(--fg)}
      .grid-2{display:grid;grid-template-columns:1fr;gap:12px}
      .grid-3{display:grid;grid-template-columns:1fr;gap:12px}
      .grid-4{display:grid;grid-template-columns:1fr;gap:12px}
      @media(min-width:900px){.grid-2{grid-template-columns:300px 1fr}.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}}
      .table-wrap{overflow:auto; max-width:100%}
      .stack{display:flex;flex-direction:column;gap:8px}
      .right{margin-left:auto}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace}
      #toast{position:fixed;left:12px;right:12px;bottom:12px;background:#7f1d1d;color:#fff;padding:10px;font-family:ui-monospace,monospace;display:none;z-index:999999;border-radius:10px}
      details{border:1px solid var(--card-border);border-radius:10px;margin:8px 0;padding:6px;background:transparent}
      summary{cursor:pointer}
      .banner{border:1px solid var(--card-border);border-radius:12px;padding:10px 12px;background:var(--badge-bg);margin-bottom:12px}
      .dot{width:8px;height:8px;border-radius:999px;background:var(--muted);display:inline-block}
      .dot.ok{background:var(--ok)}
      .dot.warn{background:var(--warn)}
    `}</style>
  );
}

/* =========================================================
   App
========================================================= */
export default function App() {
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) supabaseRef.current = getSupabase();
  const supabase = supabaseRef.current;

  const [theme, setTheme] = useState<Theme>(() => {
    const t = localStorage.getItem("blp-theme");
    return t === "light" ? "light" : "dark";
  });

  const [toast, setToast] = useState<string>("");
  const toastTimer = useRef<number | null>(null);

  const [sessionReady, setSessionReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Saving status
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginStatus, setLoginStatus] = useState("Not logged in");

  // main state
  const [state, setState] = useState<AppState>(() => defaultState());

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // theme apply
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("blp-theme", theme);
  }, [theme]);

  // session init
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!supabase) {
        setUserId(null);
        setSessionReady(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      setSessionReady(true);
    })();

    if (!supabase) {
      return () => {
        mounted = false;
      };
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setUserId(sess?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // Load per-user state when logged in
  useEffect(() => {
    if (!supabase || !userId) return;

    let cancelled = false;

    (async () => {
      setSaveError(null);

      const cacheKey = `blp-cache-${userId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = safeParseJSON(cached);
        const norm = normalizeBackupToState(parsed);
        if (norm && !cancelled) setState(norm);
      }

      const remote = await loadStateFromSupabase(supabase, userId);
      if (remote && !cancelled) {
        setState(remote);
        localStorage.setItem(cacheKey, JSON.stringify(remote));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  // Save to Supabase (debounced)
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!supabase || !userId) return;

    const cacheKey = `blp-cache-${userId}`;
    localStorage.setItem(cacheKey, JSON.stringify(state));

    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    setIsSaving(true);
    setSaveError(null);

    // Important: do NOT keep mutating state in the save path
    const toSave: AppState = { ...state, updatedAtISO: new Date().toISOString() };

    saveTimer.current = window.setTimeout(async () => {
      const res = await upsertStateToSupabase(supabase, userId, toSave);
      if (!res.ok) {
        setSaveError(res.error ?? "Save failed");
        showToast(res.error ?? "Save failed");
      }
      setIsSaving(false);
    }, 650);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [supabase, state, userId]);

  // midnight rollover: save snapshot of previous day and roll date
  useEffect(() => {
    if (!userId) return;

    const iv = window.setInterval(() => {
      const d = todayISO();
      if (d !== state.daily.date) {
        setState((prev) => {
          const snap: HistoryDay = {
            date: prev.daily.date,
            location: prev.daily.location,
            vesselMode: prev.daily.mode,
            vessel: { ...prev.vessel },
            notes: prev.notes.filter((n) => n.date === prev.daily.date),
            weather: prev.lastWeather ?? {},
            runningLog: prev.log.filter((e) => e.date === prev.daily.date),
          };

          return {
            ...prev,
            history: [snap, ...prev.history],
            notes: prev.notes.filter((n) => n.date !== prev.daily.date),
            daily: { ...prev.daily, date: d },
          };
        });
        showToast(`Auto-saved at midnight → ${prettyDate(todayISO())}`, true);
      }
    }, 30_000);

    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, state.daily.date]);

  /* -------------------------
     Derived views
  -------------------------- */
  const todaysNotes = useMemo(
    () => state.notes.filter((n) => n.date === state.daily.date),
    [state.notes, state.daily.date]
  );

  const todaysLog = useMemo(
    () => state.log.filter((e) => e.date === state.daily.date),
    [state.log, state.daily.date]
  );

  /* -------------------------
     Weather + Marine
  -------------------------- */
  const lastWxFetchRef = useRef<number>(0);

  async function fetchWeather(lat: number, lon: number) {
    // throttle: max once per 10 seconds
    const now = Date.now();
    if (now - lastWxFetchRef.current < 10_000) return;
    lastWxFetchRef.current = now;

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
        windDir:
          typeof c.wind_direction_10m === "number" ? c.wind_direction_10m : null,
        pressure: typeof c.pressure_msl === "number" ? c.pressure_msl : null,
        visibilityKm:
          typeof c.visibility === "number" ? c.visibility / 1000 : null,
        weatherCode: typeof c.weather_code === "number" ? c.weather_code : null,
        condition: typeof c.weather_code === "number" ? WMO[c.weather_code] : null,
        precipMmHr:
          typeof c.precipitation === "number" ? c.precipitation : null,
        humidityPct:
          typeof c.relative_humidity_2m === "number"
            ? c.relative_humidity_2m
            : null,
        cloudPct: typeof c.cloud_cover === "number" ? c.cloud_cover : null,
        dewPointC: typeof c.dew_point_2m === "number" ? c.dew_point_2m : null,
      };

      // marine
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
          wx.waveHeightM = typeof mc.wave_height === "number" ? mc.wave_height : null;
          wx.wavePeriodS = typeof mc.wave_period === "number" ? mc.wave_period : null;
          wx.waveDirDeg =
            typeof mc.wave_direction === "number" ? mc.wave_direction : null;
        }
      } catch {
        // ignore marine fail
      }

      setState((prev) => ({ ...prev, lastWeather: wx }));
    } catch (e) {
      showToast((e as Error).message ?? "Weather fetch failed");
    }
  }

  function useGeo() {
    if (!("geolocation" in navigator)) {
      showToast("Geolocation unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        setState((prev) => ({
          ...prev,
          coords: { lat, lon },
          locLabel: label,
        }));
        void fetchWeather(lat, lon);
      },
      (err) => showToast(err.message || "Location denied"),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 12000 }
    );
  }

  function fromPosFields() {
    const latDeg = Number(state.pos.latDeg);
    const latMin = Number(state.pos.latMin || 0);
    const lonDeg = Number(state.pos.lonDeg);
    const lonMin = Number(state.pos.lonMin || 0);

    const latSign = state.pos.latHem === "S" ? -1 : 1;
    const lonSign = state.pos.lonHem === "W" ? -1 : 1;

    const lat = (latDeg + latMin / 60) * latSign;
    const lon = (lonDeg + lonMin / 60) * lonSign;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showToast("Enter valid degrees & minutes");
      return;
    }

    const label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    setState((prev) => ({
      ...prev,
      coords: { lat, lon },
      locLabel: label,
    }));
    void fetchWeather(lat, lon);
  }

  // If stored coords exist, load weather once on login
  useEffect(() => {
    if (!userId) return;
    const { lat, lon } = state.coords;
    if (lat != null && lon != null) void fetchWeather(lat, lon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* -------------------------
     Position helpers
  -------------------------- */
  function composedPos(): string {
    const { latDeg, latMin, latHem, lonDeg, lonMin, lonHem } = state.pos;
    const lat =
      latDeg && latMin && latHem ? `${latDeg}°${latMin}'${latHem}` : "";
    const lon =
      lonDeg && lonMin && lonHem ? `${lonDeg}°${lonMin}'${lonHem}` : "";
    return lat && lon ? `${lat} / ${lon}` : "";
  }

  /* -------------------------
     Notes
  -------------------------- */
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

  /* -------------------------
     Running Log
  -------------------------- */
  const [entryFields, setEntryFields] = useState({
    courseTrue: "",
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
          courseTrue: entryFields.courseTrue,
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
          courseTrue: "",
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

  /* -------------------------
     Save Day -> History
  -------------------------- */
  function saveDayToHistory() {
    setState((prev) => {
      const snapshot: HistoryDay = {
        date: prev.daily.date,
        location: prev.daily.location,
        vesselMode: prev.daily.mode,
        vessel: { ...prev.vessel },
        notes: prev.notes.filter((n) => n.date === prev.daily.date),
        weather: prev.lastWeather ?? {},
        runningLog: prev.log.filter((e) => e.date === prev.daily.date),
      };

      return {
        ...prev,
        history: [snapshot, ...prev.history],
        notes: prev.notes.filter((n) => n.date !== prev.daily.date),
      };
    });
    showToast("Saved day to history", true);
  }

  /* -------------------------
     Backup / Restore
  -------------------------- */
  function backupNow() {
    const payload = {
      kind: "BridgeLogProBackup",
      version: 1,
      savedAt: new Date().toISOString(),
      state,
    };
    const ts = new Date();
    const name = `bridge-log-backup-${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(
      2,
      "0"
    )}${String(ts.getDate()).padStart(2, "0")}-${String(ts.getHours()).padStart(
      2,
      "0"
    )}${String(ts.getMinutes()).padStart(2, "0")}.json`;

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

  /* -------------------------
     Auth
  -------------------------- */
  async function doLogin() {
    if (!supabase) {
      setLoginStatus("Missing Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)");
      return;
    }
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
    if (!supabase) return;
    await supabase.auth.signOut();
    setLoginStatus("Not logged in");
    showToast("Logged out", true);
  }

  /* =========================================================
     Render: Session loading
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

  /* =========================================================
     Render: Login gate
========================================================= */
  if (!userId) {
    return (
      <>
        <GlobalStyles />
        <div id="toast">{toast}</div>

        <div className="container">
          {!supabase ? (
            <div className="banner">
              <div className="row">
                <span className="dot warn" />
                <b>Supabase not configured</b>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Add <span className="mono">VITE_SUPABASE_URL</span> and{" "}
                <span className="mono">VITE_SUPABASE_ANON_KEY</span> to your{" "}
                <span className="mono">.env</span> (then restart Vite).
              </div>
            </div>
          ) : null}

          <header className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="row">
              <div className="pill">BridgeLog Pro</div>
              <div className="badge mono">Login</div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
                {(theme === "dark" ? "Light" : "Dark")} mode
              </button>
            </div>
          </header>

          <div className="col">
            <div className="section">
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
          </div>
        </div>
      </>
    );
  }

  /* =========================================================
     Render: Main App
========================================================= */
  const wx = state.lastWeather ?? {};

  return (
    <>
      <GlobalStyles />
      <div id="toast">{toast}</div>

      <div className="container">
        <header className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div className="row">
            <div className="pill">BridgeLog Pro</div>
            <div className="badge mono" title="Location label">
              {state.locLabel}
            </div>

            <div className="badge">
              <span className={`dot ${saveError ? "warn" : isSaving ? "" : "ok"}`} />
              <span className="mono">
                {saveError ? "Save error" : isSaving ? "Saving…" : "Saved"}
              </span>
            </div>
          </div>

          <div className="row">
            <button className="btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
              {(theme === "dark" ? "Light" : "Dark")} mode
            </button>
            <button className="btn" onClick={useGeo}>
              Use my location
            </button>
            <button className="btn" onClick={fromPosFields}>
              From position fields
            </button>
            <button className="btn" onClick={backupNow}>
              Backup JSON
            </button>
            <button className="btn" onClick={() => fileInputRef.current?.click()}>
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
            <button className="btn" onClick={() => void doLogout()}>
              Logout
            </button>
          </div>
        </header>

        {saveError ? (
          <div className="banner">
            <div className="row">
              <span className="dot warn" />
              <b>Cloud save failed</b>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              {saveError} — your local cache is still updating. Check RLS policy on{" "}
              <span className="mono">blp_state</span>.
            </div>
          </div>
        ) : null}

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
                    onChange={(e) =>
                      setState((p) => ({ ...p, vessel: { ...p.vessel, name: e.target.value } }))
                    }
                  />
                  <input
                    placeholder="Call sign"
                    value={state.vessel.callSign ?? ""}
                    onChange={(e) =>
                      setState((p) => ({ ...p, vessel: { ...p.vessel, callSign: e.target.value } }))
                    }
                  />
                  <input
                    placeholder="MMSI"
                    value={state.vessel.mmsi ?? ""}
                    onChange={(e) =>
                      setState((p) => ({ ...p, vessel: { ...p.vessel, mmsi: e.target.value } }))
                    }
                  />
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="IMO Number"
                    value={state.vessel.imo ?? ""}
                    onChange={(e) =>
                      setState((p) => ({ ...p, vessel: { ...p.vessel, imo: e.target.value } }))
                    }
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
                    onChange={(e) =>
                      setState((p) => ({ ...p, vessel: { ...p.vessel, master: e.target.value } }))
                    }
                  />
                </div>

                <textarea
                  placeholder="Vessel notes…"
                  style={{ marginTop: 8 }}
                  value={state.vessel.notes ?? ""}
                  onChange={(e) =>
                    setState((p) => ({ ...p, vessel: { ...p.vessel, notes: e.target.value } }))
                  }
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
                  <button className="btn" onClick={useGeo}>
                    Use my location
                  </button>
                  <button className="btn" onClick={fromPosFields}>
                    From position fields
                  </button>
                  <span className="muted right">
                    {state.coords.lat != null && state.coords.lon != null
                      ? `For ${state.coords.lat.toFixed(4)}, ${state.coords.lon.toFixed(4)}`
                      : "Set location"}
                  </span>
                </div>

                <div className="row" style={{ marginTop: 8 }}>
                  <span>{wxIcon(wx.weatherCode)}</span>&nbsp;
                  <b>{wx.condition ?? "—"}</b>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div className="badge">
                    Temp <span className="right">{wx.tempC != null ? `${wx.tempC}°C` : "—°C"}</span>
                  </div>
                  <div className="badge">
                    Wind{" "}
                    <span className="right">
                      {wx.windKts != null ? `${wx.windKts} kt` : "— kt"} /{" "}
                      {wx.windDir != null ? `${wx.windDir}°` : "—°"}
                    </span>
                  </div>
                  <div className="badge">
                    Pressure{" "}
                    <span className="right">{wx.pressure != null ? `${wx.pressure} hPa` : "— hPa"}</span>
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
                    Humidity{" "}
                    <span className="right">{wx.humidityPct != null ? `${wx.humidityPct}%` : "—%"}</span>
                  </div>
                  <div className="badge">
                    Cloud <span className="right">{wx.cloudPct != null ? `${wx.cloudPct}%` : "—%"}</span>
                  </div>
                  <div className="badge">
                    Precip{" "}
                    <span className="right">{wx.precipMmHr != null ? `${wx.precipMmHr} mm/h` : "— mm/h"}</span>
                  </div>
                  <div className="badge">
                    Dew Pt{" "}
                    <span className="right">{wx.dewPointC != null ? `${wx.dewPointC}°C` : "—°C"}</span>
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
            <div className="col">
              <div className="section">
                <h2>New Running Log Entry</h2>

                <div className="grid-4">
                  <div className="row">
                    <input className="mono" readOnly value={nowHHMM()} />
                    <button className="btn" onClick={() => showToast("Time stamps automatically", true)}>
                      Stamp time
                    </button>
                  </div>

                  <div className="muted">Position</div>

                  <div className="row">
                    <input
                      className="mono"
                      placeholder="Lat°"
                      value={state.pos.latDeg}
                      onChange={(e) =>
                        setState((p) => ({ ...p, pos: { ...p.pos, latDeg: e.target.value } }))
                      }
                    />
                    <input
                      className="mono"
                      placeholder="Lat'"
                      value={state.pos.latMin}
                      onChange={(e) =>
                        setState((p) => ({ ...p, pos: { ...p.pos, latMin: e.target.value } }))
                      }
                    />
                    <select
                      value={state.pos.latHem}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          pos: { ...p.pos, latHem: e.target.value as "N" | "S" },
                        }))
                      }
                    >
                      <option value="N">N</option>
                      <option value="S">S</option>
                    </select>
                  </div>

                  <div className="row">
                    <input
                      className="mono"
                      placeholder="Lon°"
                      value={state.pos.lonDeg}
                      onChange={(e) =>
                        setState((p) => ({ ...p, pos: { ...p.pos, lonDeg: e.target.value } }))
                      }
                    />
                    <input
                      className="mono"
                      placeholder="Lon'"
                      value={state.pos.lonMin}
                      onChange={(e) =>
                        setState((p) => ({ ...p, pos: { ...p.pos, lonMin: e.target.value } }))
                      }
                    />
                    <select
                      value={state.pos.lonHem}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          pos: { ...p.pos, lonHem: e.target.value as "E" | "W" },
                        }))
                      }
                    >
                      <option value="E">E</option>
                      <option value="W">W</option>
                    </select>
                  </div>
                </div>

                <div className="grid-4" style={{ marginTop: 6 }}>
                  <input
                    placeholder="Course True (°)"
                    value={entryFields.courseTrue}
                    onChange={(e) => setEntryFields((p) => ({ ...p, courseTrue: e.target.value }))}
                  />
                  <input
                    placeholder="Course Gyro (°)"
                    value={entryFields.courseGyro}
                    onChange={(e) => setEntryFields((p) => ({ ...p, courseGyro: e.target.value }))}
                  />
                  <input
                    placeholder="Steering (°)"
                    value={entryFields.courseSteering}
                    onChange={(e) =>
                      setEntryFields((p) => ({ ...p, courseSteering: e.target.value }))
                    }
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
                    placeholder="Remarks"
                    value={entryFields.remarks}
                    onChange={(e) => setEntryFields((p) => ({ ...p, remarks: e.target.value }))}
                  />
                  <button className="btn" onClick={addEntry}>
                    Add Entry
                  </button>
                </div>
              </div>
            </div>

            <div className="col">
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
                  <button className="btn" onClick={() => addMovement("Along")}>Along</button>
                  <button className="btn" onClick={() => addMovement("Cast Off")}>Cast Off</button>
                  <button className="btn" onClick={() => addMovement("Anchor Down")}>Anchor Down</button>
                  <button className="btn" onClick={() => addMovement("Anchor Up")}>Anchor Up</button>
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

            <div className="col">
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
                        <th>C(T)</th>
                        <th>C(G)</th>
                        <th>Steer</th>
                        <th>Spd</th>
                        <th>Wind°</th>
                        <th>B</th>
                        <th>Sea</th>
                        <th>Sky</th>
                        <th>Vis</th>
                        <th>Baro</th>
                        <th>Air</th>
                        <th>SeaT</th>
                        <th>Eng</th>
                        <th>Watch</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todaysLog.length === 0 ? (
                        <tr>
                          <td colSpan={17} style={{ textAlign: "center", opacity: 0.7, padding: "10px 0" }}>
                            No entries yet.
                          </td>
                        </tr>
                      ) : (
                        todaysLog.map((r, idx) => (
                          <tr key={`${r.time}-${idx}`}>
                            <td>{r.time}</td>
                            <td>{r.position}</td>
                            <td>{r.courseTrue}</td>
                            <td>{r.courseGyro}</td>
                            <td>{r.courseSteering}</td>
                            <td>{r.speed}</td>
                            <td>{r.windDir}</td>
                            <td>{r.windForce}</td>
                            <td>{r.sea}</td>
                            <td>{r.sky}</td>
                            <td>{r.visibility}</td>
                            <td>{r.barometer}</td>
                            <td>{r.airTemp}</td>
                            <td>{r.seaTemp}</td>
                            <td>{r.engines}</td>
                            <td>{r.watchkeeper}</td>
                            <td
                              title={r.remarks}
                              style={{
                                maxWidth: 420,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {r.remarks || "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="muted" style={{ marginTop: 8 }}>
                  Entries are saved per vessel login (Supabase user).
                </div>
              </div>
            </div>

            <div className="col">
              <div className="section">
                <h2>Daily History</h2>

                {state.history.length === 0 ? (
                  <div className="muted">No history saved yet.</div>
                ) : (
                  state.history.map((h, idx) => (
                    <details key={`${h.date}-${idx}`}>
                      <summary>
                        <b>{prettyDate(h.date)}</b> — {h.location || "(no location)"} • {h.vesselMode}
                      </summary>

                      <div className="grid-3" style={{ marginTop: 6 }}>
                        <div>
                          <div><b>Weather</b></div>
                          <div>Cond: {h.weather?.condition ?? "—"}</div>
                          <div>Temp: {h.weather?.tempC ?? "—"}°C</div>
                          <div>Wind: {h.weather?.windKts ?? "—"} kt / {h.weather?.windDir ?? "—"}°</div>
                          <div>Pressure: {h.weather?.pressure ?? "—"} hPa</div>
                          <div>Vis: {h.weather?.visibilityKm ?? "—"} km</div>
                          <div><b>Marine</b></div>
                          <div>
                            Hs {h.weather?.waveHeightM != null ? h.weather.waveHeightM.toFixed(1) : "—"} m • Tp{" "}
                            {h.weather?.wavePeriodS != null ? h.weather.wavePeriodS.toFixed(0) : "—"} s • Dir{" "}
                            {h.weather?.waveDirDeg ?? "—"}°
                          </div>
                        </div>

                        <div>
                          <div><b>Vessel</b></div>
                          <div>
                            {h.vessel?.name || "—"} • {h.vessel?.callSign || ""} • {h.vessel?.mmsi || ""}
                          </div>
                          {h.vessel?.notes ? <div className="muted">Notes: {h.vessel.notes}</div> : null}
                        </div>

                        <div>
                          <div><b>Notes</b></div>
                          <div className="badge" style={{ display: "block", maxHeight: 120, overflow: "auto", padding: 8 }}>
                            {(h.notes || []).map((n, j) => (
                              <div key={`${n.time}-${j}`}>[{n.time}] {n.text}</div>
                            ))}
                          </div>
                        </div>

                        <div style={{ gridColumn: "1 / -1" }}>
                          <div><b>Running Log</b></div>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Time</th><th>Position</th><th>C(T)</th><th>C(G)</th><th>Steer</th><th>Spd</th>
                                  <th>Wind°</th><th>B</th><th>Sea</th><th>Sky</th><th>Vis</th><th>Baro</th>
                                  <th>Air</th><th>SeaT</th><th>Eng</th><th>Watch</th><th>Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(h.runningLog || []).map((r, j) => (
                                  <tr key={`${r.time}-${j}`}>
                                    <td>{r.time}</td>
                                    <td>{r.position}</td>
                                    <td>{r.courseTrue}</td>
                                    <td>{r.courseGyro}</td>
                                    <td>{r.courseSteering}</td>
                                    <td>{r.speed}</td>
                                    <td>{r.windDir}</td>
                                    <td>{r.windForce}</td>
                                    <td>{r.sea}</td>
                                    <td>{r.sky}</td>
                                    <td>{r.visibility}</td>
                                    <td>{r.barometer}</td>
                                    <td>{r.airTemp}</td>
                                    <td>{r.seaTemp}</td>
                                    <td>{r.engines}</td>
                                    <td>{r.watchkeeper}</td>
                                    <td>{r.remarks}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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

        <footer className="muted" style={{ marginTop: 10 }}>
          © {new Date().getFullYear()} Obsidian Marine — BridgeLog Pro.
        </footer>
      </div>
    </>
  );
}
