/**
 * Fetch Ecowitt cloud → data/*.json for the public GitHub Pages site.
 * Runs in Actions on 3rdAlbansWeatherStation.github.io (secrets in repo).
 * Never logs secret values.
 *
 * Usage (repo root):
 *   node .github/scripts/fetch-ecowitt-data.js
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
  const rain = points.map((p) => p.rainMm).filter((n) => n != null);
  const avg = (arr) =>
    arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
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
    rainTotalMm: rain.length ? Number(Math.max(...rain).toFixed(1)) : null,
    wind: {
      high: wind.length ? Math.max(...wind) : null,
      avg: avg(wind),
    },
  };
}

function downsample(points, maxPoints = 180) {
  if (points.length <= maxPoints) return points;
  const out = [];
  const step = points.length / maxPoints;
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(points[Math.min(points.length - 1, Math.floor(i * step))]);
  }
  return out;
}

function normalizeHistory(data, range) {
  const outdoor = data.outdoor || {};
  const wind = data.wind || {};
  const pressure = data.pressure || {};
  const rainfall = data.rainfall || {};

  const tempList = listMap(outdoor.temperature);
  const humList = listMap(outdoor.humidity);
  const windList = listMap(wind.wind_speed);
  const dirList = listMap(wind.wind_direction);
  const pressList = listMap(pressure.relative);
  const rainList = listMap(rainfall.rain_rate);

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
        humidity: num(humList[key]),
        pressureHpa: num(pressList[key]),
        rainMm: num(rainList[key]),
        windMs: num(windList[key]),
        windDirDeg: num(dirList[key]),
      };
    })
    .filter((p) => p.tempC != null || p.humidity != null);

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

async function fetchHistoryRange(range) {
  const days = range === "year" ? 365 : range === "month" ? 30 : 7;
  const cycleType = range === "year" ? "4hour" : range === "month" ? "30min" : "5min";
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);

  let data = await fetchHistoryBody(start, end, cycleType);
  let payload = normalizeHistory(data, range);

  if (payload.points.length < 5) {
    const endRecent = new Date();
    const startRecent = new Date(endRecent.getTime() - 24 * 3600 * 1000);
    data = await fetchHistoryBody(startRecent, endRecent, "5min");
    payload = normalizeHistory(data, range);
    if (payload.points.length) {
      payload.note =
        "Showing available cloud history (archive still filling — full week/month later).";
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

  for (const range of ["week", "month", "year"]) {
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
