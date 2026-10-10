/**
 * Fetch Ecowitt cloud data into data/*.json for the public site.
 * Env: ECOWITT_APPLICATION_KEY, ECOWITT_API_KEY, ECOWITT_DEVICE_MAC
 */
const fs = require("fs");
const path = require("path");

const CALL_BACK = "outdoor,indoor,pressure,wind,solar_and_uvi,rainfall";

function creds() {
  const applicationKey = process.env.ECOWITT_APPLICATION_KEY;
  const apiKey = process.env.ECOWITT_API_KEY;
  const mac = process.env.ECOWITT_DEVICE_MAC;
  if (!applicationKey || !apiKey || !mac) {
    throw new Error("Missing ECOWITT_APPLICATION_KEY, ECOWITT_API_KEY, or ECOWITT_DEVICE_MAC");
  }
  return { applicationKey, apiKey, mac };
}

function formatEcowittDate(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const g = (type) => parts.find((p) => p.type === type)?.value;
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

function londonYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const g = (type) => parts.find((p) => p.type === type)?.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function dateFromLondonWall(ymd, hms = "00:00:00") {
  const want = `${ymd} ${hms}`;
  const parseWall = (str) => {
    const [date, time] = str.split(" ");
    const [yy, mm, dd] = date.split("-").map(Number);
    const [hh, mi, ss] = time.split(":").map(Number);
    return Date.UTC(yy, mm - 1, dd, hh, mi, ss || 0);
  };
  let utc = parseWall(want);
  for (let i = 0; i < 4; i += 1) {
    const shown = formatEcowittDate(new Date(utc));
    const delta = parseWall(want) - parseWall(shown);
    utc += delta;
    if (delta === 0) break;
  }
  return new Date(utc);
}

function rangeWindow(range) {
  const end = new Date();
  if (range === "day") {
    return {
      start: dateFromLondonWall(londonYmd(end), "00:00:00"),
      end,
      cycleType: "5min",
    };
  }
  const days = range === "year" ? 365 : range === "month" ? 30 : 7;
  const cycleType = range === "year" ? "4hour" : range === "month" ? "30min" : "5min";
  return {
    start: new Date(end.getTime() - days * 24 * 3600 * 1000),
    end,
    cycleType,
  };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function leaf(obj) {
  if (obj == null) return null;
  if (typeof obj === "object" && obj.value != null) return num(obj.value);
  return num(obj);
}

function listMap(leafObj) {
  if (!leafObj) return {};
  if (leafObj.list && typeof leafObj.list === "object") return leafObj.list;
  if (typeof leafObj === "object" && !Array.isArray(leafObj)) return leafObj;
  return {};
}

function conditionFrom(outdoor, rainRate) {
  if (outdoor?.tempC == null) return "—";
  if (rainRate != null && rainRate > 0.2) return "Rain";
  if (outdoor.tempC < 8) return "Cool";
  if (outdoor.humidity != null && outdoor.humidity > 85) return "Damp";
  return "Fair";
}

function normalizeRealtime(data) {
  const outdoor = data.outdoor || {};
  const indoor = data.indoor || {};
  const wind = data.wind || {};
  const pressure = data.pressure || {};
  const rain = data.rainfall || {};
  const solar = data.solar_and_uvi || {};

  const out = {
    tempC: leaf(outdoor.temperature),
    humidity: leaf(outdoor.humidity),
    feelsLikeC: leaf(outdoor.feels_like),
    dewPointC: leaf(outdoor.dew_point),
  };

  const rainOut = {
    rateMm: leaf(rain.rain_rate) ?? 0,
    eventMm: leaf(rain.event) ?? 0,
    hourMm: leaf(rain["1_hour"]) ?? 0,
    dailyMm: leaf(rain.daily) ?? 0,
    weekMm: leaf(rain.weekly) ?? 0,
    monthMm: leaf(rain.monthly) ?? 0,
    yearMm: leaf(rain.yearly) ?? 0,
  };

  return {
    source: "cloud",
    station: "3rd Albans Weather",
    updatedAt: new Date().toISOString(),
    outdoor: out,
    indoor: {
      tempC: leaf(indoor.temperature),
      humidity: leaf(indoor.humidity),
    },
    wind: {
      speedMs: leaf(wind.wind_speed),
      gustMs: leaf(wind.wind_gust),
      directionDeg: leaf(wind.wind_direction),
      dayMaxMs: null,
    },
    rain: rainOut,
    pressure: {
      absHpa: leaf(pressure.absolute),
      relHpa: leaf(pressure.relative),
    },
    solar: {
      uvi: leaf(solar.uvi),
      wm2: leaf(solar.solar),
    },
    sensor: {
      status: out.tempC != null ? "OK" : "Bad",
    },
    condition: conditionFrom(out, rainOut.rateMm),
  };
}

function summarize(points) {
  if (!points.length) {
    return {
      temp: { high: null, low: null, avg: null },
      humidity: { high: null, low: null, avg: null },
      rainTotalMm: null,
      wind: { high: null, avg: null },
    };
  }
  const temps = points.map((p) => p.tempC).filter((n) => n != null);
  const hum = points.map((p) => p.humidity).filter((n) => n != null);
  const wind = points.map((p) => p.windMs).filter((n) => n != null);
  const gust = points.map((p) => p.gustMs).filter((n) => n != null);
  const rain = points.map((p) => p.rainMm).filter((n) => n != null);
  const solar = points.map((p) => p.wm2).filter((n) => n != null);
  const avg = (arr) =>
    arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
  const peak = [...wind, ...gust];
  const rainSum = rain.length
    ? Number(rain.reduce((a, b) => a + b, 0).toFixed(1))
    : null;
  return {
    temp: {
      high: temps.length ? Math.max(...temps) : null,
      low: temps.length ? Math.min(...temps) : null,
      avg: avg(temps),
    },
    humidity: {
      high: hum.length ? Math.max(...hum) : null,
      low: hum.length ? Math.min(...hum) : null,
      avg: hum.length ? Math.round(avg(hum)) : null,
    },
    // Period rainfall (sum of per-interval tipper amounts), not peak rain rate
    rainTotalMm: rainSum,
    solarHighWm2: solar.length ? Math.max(...solar) : null,
    wind: {
      high: peak.length ? Math.max(...peak) : null,
      avg: avg(wind),
    },
  };
}

/** Nearest list value within maxSkewSec of ts (unix seconds). */
function nearestNum(list, ts, maxSkewSec = 900) {
  if (!list || typeof list !== "object") return null;
  const exact = num(list[String(ts)]);
  if (exact != null) return exact;
  let best = null;
  let bestSkew = Infinity;
  for (const [k, v] of Object.entries(list)) {
    const t = Number(k);
    if (!Number.isFinite(t)) continue;
    const skew = Math.abs(t - ts);
    if (skew <= maxSkewSec && skew < bestSkew) {
      const n = num(v);
      if (n != null) {
        best = n;
        bestSkew = skew;
      }
    }
  }
  return best;
}

/**
 * Interval rain (mm) from cumulative yearly tipper totals.
 * Yearly resets → negative delta clamped to 0 for that step.
 */
function applyYearlyRainDeltas(points) {
  let prevYearly = null;
  for (const p of points) {
    const y = p._yearlyMm;
    if (y == null || prevYearly == null) {
      p.rainMm = 0;
    } else {
      const delta = y - prevYearly;
      p.rainMm = Number((delta > 0 ? delta : 0).toFixed(2));
    }
    if (y != null) prevYearly = y;
    delete p._yearlyMm;
  }
  return points;
}

/** Downsample; sum rain in each bin, take max for gust/wind/solar. */
function downsample(points, maxPoints = 180) {
  if (points.length <= maxPoints) return points;
  const out = [];
  const step = points.length / maxPoints;
  let prevIdx = 0;
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.min(points.length - 1, Math.floor(i * step));
    const p = { ...points[idx] };
    if (i > 0 && idx > prevIdx) {
      let rainSum = 0;
      let maxGust = null;
      let maxWind = null;
      let maxSolar = null;
      for (let j = prevIdx + 1; j <= idx; j += 1) {
        const q = points[j];
        if (q.rainMm != null) rainSum += q.rainMm;
        if (q.gustMs != null) maxGust = maxGust == null ? q.gustMs : Math.max(maxGust, q.gustMs);
        if (q.windMs != null) maxWind = maxWind == null ? q.windMs : Math.max(maxWind, q.windMs);
        if (q.wm2 != null) maxSolar = maxSolar == null ? q.wm2 : Math.max(maxSolar, q.wm2);
      }
      p.rainMm = Number(rainSum.toFixed(2));
      if (maxGust != null) p.gustMs = maxGust;
      if (maxWind != null) p.windMs = maxWind;
      if (maxSolar != null) p.wm2 = maxSolar;
    }
    out.push(p);
    prevIdx = idx;
  }
  return out;
}

function normalizeHistory(data, range) {
  const outdoor = data.outdoor || {};
  const wind = data.wind || {};
  const pressure = data.pressure || {};
  const rainfall = data.rainfall || {};
  const solar = data.solar_and_uvi || {};

  const tempList = listMap(outdoor.temperature);
  const humList = listMap(outdoor.humidity);
  const windList = listMap(wind.wind_speed);
  const gustList = listMap(wind.wind_gust);
  const dirList = listMap(wind.wind_direction);
  const pressList = listMap(pressure.relative);
  // Cumulative year tipper (mm) — interval rain = positive deltas
  const yearlyRainList = listMap(rainfall.yearly);
  const solarList = listMap(solar.solar);

  const stamps = Object.keys(tempList).length
    ? Object.keys(tempList)
    : Object.keys(humList);

  const points = stamps
    .map((ts) => Number(ts))
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b)
    .map((ts) => {
      const key = String(ts);
      return {
        t: new Date(ts * 1000).toISOString(),
        tempC: num(tempList[key]),
        humidity: num(humList[key]) ?? nearestNum(humList, ts),
        pressureHpa: num(pressList[key]) ?? nearestNum(pressList, ts),
        _yearlyMm: num(yearlyRainList[key]) ?? nearestNum(yearlyRainList, ts),
        windMs: num(windList[key]) ?? nearestNum(windList, ts),
        gustMs: num(gustList[key]) ?? nearestNum(gustList, ts),
        windDirDeg: num(dirList[key]) ?? nearestNum(dirList, ts),
        wm2: num(solarList[key]) ?? nearestNum(solarList, ts),
      };
    })
    .filter((p) => p.tempC != null || p.humidity != null);

  applyYearlyRainDeltas(points);
  const sampled = downsample(points);
  const payload = {
    source: "cloud",
    range,
    updatedAt: new Date().toISOString(),
    summary: summarize(sampled),
    points: sampled,
  };
  if (!points.length) {
    payload.note = "Cloud history is empty for this range (station may be newly online).";
  }
  return payload;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for history/realtime`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(body.msg || `Ecowitt code ${body.code}`);
  return body.data || {};
}

async function fetchRealtime() {
  const { applicationKey, apiKey, mac } = creds();
  const params = new URLSearchParams({
    application_key: applicationKey,
    api_key: apiKey,
    mac,
    call_back: CALL_BACK,
    temp_unitid: "1",
    pressure_unitid: "3",
    wind_speed_unitid: "6",
    rainfall_unitid: "12",
    solar_irradiance_unitid: "16",
  });
  return getJson(`https://api.ecowitt.net/api/v3/device/real_time?${params}`);
}

async function fetchHistoryBody(start, end, cycleType) {
  const { applicationKey, apiKey, mac } = creds();
  const params = new URLSearchParams({
    application_key: applicationKey,
    api_key: apiKey,
    mac,
    start_date: formatEcowittDate(start),
    end_date: formatEcowittDate(end),
    cycle_type: cycleType,
    call_back: CALL_BACK,
    temp_unitid: "1",
    pressure_unitid: "3",
    wind_speed_unitid: "6",
    rainfall_unitid: "12",
    solar_irradiance_unitid: "16",
  });
  return getJson(`https://api.ecowitt.net/api/v3/device/history?${params}`);
}

function pointsSpanMs(points) {
  if (!points || points.length < 2) return 0;
  const t0 = new Date(points[0].t).getTime();
  const t1 = new Date(points[points.length - 1].t).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  return Math.max(0, t1 - t0);
}

async function fetchDenseRecent(range) {
  const endRecent = new Date();
  const startRecent = new Date(endRecent.getTime() - 48 * 3600 * 1000);
  const data = await fetchHistoryBody(startRecent, endRecent, "5min");
  return normalizeHistory(data, range);
}

async function fetchHistoryRange(range) {
  const { start, end, cycleType } = rangeWindow(range);

  let data = await fetchHistoryBody(start, end, cycleType);
  let payload = normalizeHistory(data, range);

  // Day is already London midnight → now @ 5min — do not widen to 48h.
  if (range === "day") {
    return payload;
  }

  // Keep Week / Month / Year consistent while the cloud archive is still short.
  const spanMs = pointsSpanMs(payload.points);
  const archiveShort =
    payload.points.length < 12 || spanMs < 2 * 864e5;

  if (archiveShort) {
    const dense = await fetchDenseRecent(range);
    if (
      dense.points.length > payload.points.length ||
      payload.points.length < 5
    ) {
      payload = dense;
    }
    if (payload.points.length) {
      payload.note =
        "Showing available history while the station archive fills (same recent data for Week / Month / Year until enough days exist). Day still shows today only.";
    }
  }
  return payload;
}

function dataDir() {
  // Actions: cwd = github.io root → data/
  // Local from pi-weather: SITE_DATA_DIR or default site/data
  if (process.env.SITE_DATA_DIR) return process.env.SITE_DATA_DIR;
  const rootData = path.join(process.cwd(), "data");
  if (fs.existsSync(path.join(process.cwd(), "index.html")) && fs.existsSync(rootData)) {
    return rootData;
  }
  return path.join(__dirname, "..", "..", "data");
}

async function main() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  const current = normalizeRealtime(await fetchRealtime());
  fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify(current, null, 2) + "\n");
  console.log(
    "wrote current.json",
    "temp=",
    current.outdoor.tempC,
    "wm2=",
    current.solar.wm2
  );

  for (const range of ["day", "week", "month", "year"]) {
    const history = await fetchHistoryRange(range);
    fs.writeFileSync(
      path.join(dir, `history-${range}.json`),
      JSON.stringify(history, null, 2) + "\n"
    );
    console.log(`wrote history-${range}.json points=${history.points.length}`);
  }
}

main().catch((err) => {
  console.error("fetch failed:", err.message);
  process.exit(1);
});
