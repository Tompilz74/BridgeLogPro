export type VesselPositionSourceStatus =
  | "BR1 GPS Live"
  | "BR1 GPS Stale"
  | "IP Location Fallback"
  | "Tablet GPS Live"
  | "Tablet GPS Stale"
  | "Tablet GPS Unavailable";

export type VesselPositionSourceType = "br1-gps" | "ip-location" | "tablet-gps";

export type VesselPosition = {
  latitude: number;
  longitude: number;
  timestamp: string;
  speedKts?: number | null;
  headingDeg?: number | null;
  accuracyM?: number | null;
  altitudeM?: number | null;
  altitudeAccuracyM?: number | null;
  sourceStatus: VesselPositionSourceStatus;
  sourceType: VesselPositionSourceType;
  receivedAt: string;
};

export type VesselPositionProvider = {
  getLatestPosition: () => Promise<VesselPosition | null>;
  subscribe: (listener: (position: VesselPosition | null) => void) => () => void;
};

type ApiPosition = {
  source: "BR1_GPS" | "IP_LOCATION";
  status: "live" | "stale" | "unavailable";
  latitude: number | null;
  longitude: number | null;
  timestamp: string | null;
  speedKnots: number | null;
  courseDeg: number | null;
};

type ProviderOptions = {
  pollMs?: number;
  endpoint?: string;
};

const POLL_MS = 30_000;
const TABLET_GPS_STALE_MS = 2 * 60_000;

function sourceStatus(position: ApiPosition): VesselPositionSourceStatus {
  if (position.source === "IP_LOCATION") return "IP Location Fallback";
  return position.status === "live" ? "BR1 GPS Live" : "BR1 GPS Stale";
}

function toVesselPosition(position: ApiPosition): VesselPosition | null {
  if (typeof position.latitude !== "number" || typeof position.longitude !== "number") return null;
  if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return null;

  return {
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp: position.timestamp ?? new Date().toISOString(),
    speedKts: position.speedKnots,
    headingDeg: position.courseDeg,
    accuracyM: null,
    altitudeM: null,
    altitudeAccuracyM: null,
    sourceStatus: sourceStatus(position),
    sourceType: position.source === "IP_LOCATION" ? "ip-location" : "br1-gps",
    receivedAt: new Date().toISOString(),
  };
}

export function createVesselPositionProvider(options: ProviderOptions = {}): VesselPositionProvider {
  const pollMs = options.pollMs ?? POLL_MS;
  const endpoint = options.endpoint ?? "/api/vessel-position";

  async function getLatestPosition(): Promise<VesselPosition | null> {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) return null;
      return toVesselPosition((await response.json()) as ApiPosition);
    } catch {
      return null;
    }
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

export function createTabletGpsPositionProvider(options: ProviderOptions = {}): VesselPositionProvider {
  const pollMs = options.pollMs ?? POLL_MS;
  let lastValid: VesselPosition | null = null;

  function fromGeolocationPosition(position: GeolocationPosition): VesselPosition {
    const timestamp = new Date(position.timestamp).toISOString();
    const next: VesselPosition = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp,
      speedKts: typeof position.coords.speed === "number" && Number.isFinite(position.coords.speed)
        ? position.coords.speed * 1.943844
        : null,
      headingDeg: typeof position.coords.heading === "number" && Number.isFinite(position.coords.heading)
        ? position.coords.heading
        : null,
      accuracyM: typeof position.coords.accuracy === "number" && Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : null,
      altitudeM: typeof position.coords.altitude === "number" && Number.isFinite(position.coords.altitude)
        ? position.coords.altitude
        : null,
      altitudeAccuracyM: typeof position.coords.altitudeAccuracy === "number" && Number.isFinite(position.coords.altitudeAccuracy)
        ? position.coords.altitudeAccuracy
        : null,
      sourceStatus: "Tablet GPS Live",
      sourceType: "tablet-gps",
      receivedAt: new Date().toISOString(),
    };
    lastValid = next;
    return next;
  }

  function stalePosition(): VesselPosition | null {
    if (!lastValid) return null;
    const ageMs = Date.now() - new Date(lastValid.receivedAt).getTime();
    return {
      ...lastValid,
      sourceStatus: ageMs <= TABLET_GPS_STALE_MS ? "Tablet GPS Stale" : "Tablet GPS Unavailable",
    };
  }

  async function getLatestPosition(): Promise<VesselPosition | null> {
    if (!("geolocation" in navigator)) return stalePosition();

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(fromGeolocationPosition(position)),
        () => resolve(stalePosition()),
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 12_000 }
      );
    });
  }

  function subscribe(listener: (position: VesselPosition | null) => void): () => void {
    if (!("geolocation" in navigator)) {
      const timer = window.setInterval(() => listener(stalePosition()), pollMs);
      listener(stalePosition());
      return () => window.clearInterval(timer);
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => listener(fromGeolocationPosition(position)),
      () => listener(stalePosition()),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 12_000 }
    );

    const staleTimer = window.setInterval(() => listener(stalePosition()), pollMs);
    void getLatestPosition().then(listener);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(staleTimer);
    };
  }

  return { getLatestPosition, subscribe };
}
