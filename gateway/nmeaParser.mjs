export function parseNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseLatLon(value, hemi) {
  if (!value || !hemi) return null;
  const dot = value.indexOf(".");
  const degLen = dot > 4 ? 3 : 2;
  const deg = Number(value.slice(0, degLen));
  const min = Number(value.slice(degLen));
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  return (/[SW]/i.test(hemi) ? -1 : 1) * (deg + min / 60);
}

export function parseNmeaTime(dateField, timeField, now = new Date()) {
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

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hh), Number(mm), Number(ss))).toISOString();
}

export function knotsFromWind(speed, unit) {
  const value = parseNumber(speed);
  if (value == null) return null;
  const u = unit?.toUpperCase();
  if (u === "M") return value * 1.943844;
  if (u === "K") return value * 0.539957;
  return value;
}

function degreesFromCardinal(value, side) {
  const deg = parseNumber(value);
  if (deg == null) return null;
  return side?.toUpperCase() === "L" ? (360 - deg) % 360 : deg;
}

export function metersFromDepth(value, unit) {
  const depth = parseNumber(value);
  if (depth == null) return null;
  if (unit?.toUpperCase() === "F") return depth * 0.3048;
  return depth;
}

export function celsiusFromTemp(value, unit) {
  const temp = parseNumber(value);
  if (temp == null) return null;
  if (unit?.toUpperCase() === "F") return (temp - 32) * 5 / 9;
  return temp;
}

export function hpaFromPressure(value, unit) {
  const pressure = parseNumber(value);
  if (pressure == null) return null;
  const u = unit?.toUpperCase();
  if (u === "I") return pressure * 33.8638866667;
  if (u === "B") return pressure * 1000;
  if (u === "P") return pressure / 100;
  return pressure;
}

function applyXdr(patch, fields) {
  for (let i = 1; i + 3 < fields.length; i += 4) {
    const type = fields[i]?.toUpperCase();
    const value = fields[i + 1];
    const unit = fields[i + 2];
    const name = (fields[i + 3] || "").toLowerCase();
    if (type === "C") {
      const temp = celsiusFromTemp(value, unit);
      if (temp == null) continue;
      if (/water|sea|sw|seawater/.test(name)) patch.waterTempC = temp;
      else if (/air|outside|ambient/.test(name)) patch.airTempC = temp;
    } else if (type === "P") {
      const pressure = hpaFromPressure(value, unit);
      if (pressure != null && /bar|press|atmos/.test(name)) patch.barometerHpa = pressure;
    }
  }
}

export function validChecksum(sentence) {
  const clean = sentence.trim();
  const star = clean.indexOf("*");
  if (star === -1) return true;
  let checksum = 0;
  for (const ch of clean.slice(1, star)) checksum ^= ch.charCodeAt(0);
  return checksum.toString(16).toUpperCase().padStart(2, "0") === clean.slice(star + 1).trim().slice(0, 2).toUpperCase();
}

export function parseNmea(sentence, options = {}) {
  const clean = sentence.trim();
  if (!clean.startsWith("$") || !validChecksum(clean)) return null;

  const body = clean.slice(1, clean.includes("*") ? clean.indexOf("*") : undefined);
  const fields = body.split(",");
  const sentenceType = (fields[0] || "").slice(-3).toUpperCase();
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const patch = { lastSentence: clean, lastSentenceType: sentenceType, updatedAt };

  if (sentenceType === "GGA") {
    patch.timestamp = parseNmeaTime(undefined, fields[1], options.now);
    patch.latitude = parseLatLon(fields[2], fields[3]);
    patch.longitude = parseLatLon(fields[4], fields[5]);
    patch.gpsQuality = parseNumber(fields[6]);
    patch.satellites = parseNumber(fields[7]);
    patch.hdop = parseNumber(fields[8]);
    patch.altitudeM = parseNumber(fields[9]);
  } else if (sentenceType === "RMC") {
    patch.timestamp = parseNmeaTime(fields[9], fields[1], options.now);
    patch.latitude = parseLatLon(fields[3], fields[4]);
    patch.longitude = parseLatLon(fields[5], fields[6]);
    patch.speedKnots = parseNumber(fields[7]);
    patch.courseDeg = parseNumber(fields[8]);
  } else if (sentenceType === "VTG") {
    patch.courseDeg = parseNumber(fields[1]);
    patch.speedKnots = parseNumber(fields[5]);
  } else if (sentenceType === "HDT" || sentenceType === "HDG") {
    patch.headingDeg = parseNumber(fields[1]);
  } else if (sentenceType === "MWV") {
    patch.windAngleDeg = parseNumber(fields[1]);
    patch.windReference = fields[2]?.toUpperCase() === "T" ? "true" : fields[2]?.toUpperCase() === "R" ? "relative" : null;
    if (patch.windReference === "true") patch.windDirTrueDeg = patch.windAngleDeg;
    patch.windSpeedKnots = knotsFromWind(fields[3], fields[4]);
  } else if (sentenceType === "MWD") {
    patch.windDirTrueDeg = parseNumber(fields[1]);
    patch.windAngleDeg = patch.windDirTrueDeg;
    patch.windReference = "true";
    patch.windSpeedKnots = parseNumber(fields[5]) ?? knotsFromWind(fields[7], fields[8]);
  } else if (sentenceType === "VWR" || sentenceType === "VWT") {
    patch.windAngleDeg = degreesFromCardinal(fields[1], fields[2]);
    patch.windReference = sentenceType === "VWT" ? "true" : "relative";
    if (sentenceType === "VWT") patch.windDirTrueDeg = patch.windAngleDeg;
    patch.windSpeedKnots = parseNumber(fields[3]) ?? knotsFromWind(fields[5], "M") ?? knotsFromWind(fields[7], "K");
  } else if (sentenceType === "DBT") {
    patch.depthMeters = metersFromDepth(fields[3], fields[4]);
  } else if (sentenceType === "DPT") {
    patch.depthMeters = parseNumber(fields[1]);
  } else if (sentenceType === "MTW") {
    patch.waterTempC = celsiusFromTemp(fields[1], fields[2]);
  } else if (sentenceType === "MTA") {
    patch.airTempC = celsiusFromTemp(fields[1], fields[2]);
  } else if (sentenceType === "MMB") {
    patch.barometerHpa = hpaFromPressure(fields[3] || fields[1], fields[4] || fields[2]);
  } else if (sentenceType === "MDA") {
    patch.barometerHpa = hpaFromPressure(fields[3] || fields[1], fields[4] || fields[2]);
    patch.airTempC = celsiusFromTemp(fields[5], fields[6]);
    patch.waterTempC = celsiusFromTemp(fields[7], fields[8]);
    patch.humidityPct = parseNumber(fields[9]);
    patch.windDirTrueDeg = parseNumber(fields[13]);
    patch.windSpeedKnots = parseNumber(fields[17]);
  } else if (sentenceType === "XDR") {
    applyXdr(patch, fields);
  }

  return patch;
}
