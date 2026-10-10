/**
 * Public GitHub Pages UI.
 * Loads static JSON from ./data/.
 */

const REFRESH_MS = 60_000;
const WIND_CALM_MS = 0.5;
let historyRange = "week";
let currentView = "live";
let livePage = "1";
let refreshTimer;
let lastHistory = null;
let lastSteadyWindDeg = 0;

const $ = (id) => document.getElementById(id);

const BAND = {
  yellow: "#ffe627",
  yellowFill: "rgba(255,230,39,0.12)",
  green: "#25b755",
  greenFill: "rgba(37,183,85,0.1)",
  orange: "#ff912a",
  orangeFill: "rgba(255,145,42,0.12)",
  blue: "#006ddf",
  blueFill: "rgba(0,109,223,0.12)",
};
const CHART_LINE_W = 2.25;
const CHART_PAD_X = 6;
const CHART_PAD_TOP = 8;
const CHART_PAD_BOTTOM = 20;

function dataUrl(name) {
  // Relative paths work on project Pages (…/pi-weather/) and locally
  return new URL(`./data/${name}`, window.location.href).toString();
}

function fmtUpdatedAt(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtNum(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return "--";
  return Number(n).toFixed(digits);
}

/** Display wind in mph; API keeps m/s. */
function msToMph(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return null;
  return Number(ms) * 2.236936294;
}

function fmtMph(ms, digits = 1) {
  const mph = msToMph(ms);
  return mph == null ? "--" : mph.toFixed(digits);
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function setLivePage(page) {
  livePage = String(page) === "2" ? "2" : "1";
  const page1 = $("boxes-page-1");
  const page2 = $("boxes-page-2");
  const liveView = $("view-live");
  const show1 = livePage === "1";
  page1.hidden = !show1;
  page2.hidden = show1;
  page1.style.display = show1 ? "" : "none";
  page2.style.display = show1 ? "none" : "";
  if (liveView) liveView.classList.toggle("is-page-2", !show1);
  document.querySelectorAll(".live-page-btn").forEach((btn) => {
    const active = btn.dataset.page === livePage;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function setView(view) {
  currentView = view;
  const live = $("view-live");
  const historic = $("view-historic");
  const historyRangeEl = $("history-range");
  const livePageEl = $("live-page");
  live.hidden = view !== "live";
  historic.hidden = view !== "historic";
  live.style.display = view === "live" ? "" : "none";
  historic.style.display = view === "historic" ? "" : "none";
  historyRangeEl.hidden = view !== "historic";
  historyRangeEl.style.display = view === "historic" ? "" : "none";
  livePageEl.hidden = view !== "live";
  livePageEl.style.display = view === "live" ? "" : "none";
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (view === "live") setLivePage(livePage);
  if (view === "historic") {
    requestAnimationFrame(() => {
      if (lastHistory) renderHistory(lastHistory);
      else refresh();
    });
  }
}

function renderCurrent(data) {
  const deg = data.wind?.directionDeg;
  const speed = data.wind?.speedMs;

  $("updated").textContent = fmtUpdatedAt(data.updatedAt);

  $("temp").textContent =
    data.outdoor?.tempC == null ? "--" : Number(data.outdoor.tempC).toFixed(1);
  $("feels").textContent =
    data.outdoor?.feelsLikeC == null ? "--" : Number(data.outdoor.feelsLikeC).toFixed(1);
  $("humidity").textContent =
    data.outdoor?.humidity == null ? "--" : String(data.outdoor.humidity);
  $("rain").textContent =
    data.rain?.dailyMm == null ? "--" : Number(data.rain.dailyMm).toFixed(1);
  $("pressure").textContent =
    data.pressure?.relHpa == null ? "--" : Number(data.pressure.relHpa).toFixed(0);
  $("gust").textContent = fmtMph(data.wind?.gustMs);
  $("indoor-temp").textContent =
    data.indoor?.tempC == null ? "--" : Number(data.indoor.tempC).toFixed(1);
  $("indoor-humidity").textContent =
    data.indoor?.humidity == null ? "--" : String(data.indoor.humidity);
  $("uvi").textContent = data.solar?.uvi == null ? "--" : String(data.solar.uvi);
  $("dew").textContent =
    data.outdoor?.dewPointC == null ? "--" : Number(data.outdoor.dewPointC).toFixed(1);
  $("rain-rate").textContent =
    data.rain?.rateMm == null ? "--" : Number(data.rain.rateMm).toFixed(1);
  $("solar").textContent =
    data.solar?.wm2 == null ? "--" : Number(data.solar.wm2).toFixed(0);
  $("rain-hour").textContent =
    data.rain?.hourMm == null ? "--" : Number(data.rain.hourMm).toFixed(1);
  $("rain-week").textContent =
    data.rain?.weekMm == null ? "--" : Number(data.rain.weekMm).toFixed(1);
  $("condition-box").textContent = data.condition || "--";

  $("wind-speed").textContent = fmtMph(speed);

  const needle = $("wind-needle");
  const speedN = Number(speed) || 0;
  const degN = Number(deg);
  if (speedN >= WIND_CALM_MS && Number.isFinite(degN)) {
    lastSteadyWindDeg = degN;
  }
  const needleDeg =
    Number.isFinite(degN) && speedN >= WIND_CALM_MS ? degN : lastSteadyWindDeg;
  const strength = Math.min(Math.max(speedN / 12, 0), 1);
  const needleH = 30 + strength * 16;
  const tipScale = 1 + strength * 0.75;
  needle.style.setProperty("--needle-h", `${needleH.toFixed(1)}%`);
  needle.style.setProperty("--tip-scale", tipScale.toFixed(2));
  needle.style.transform = `rotate(${needleDeg}deg)`;
  needle.classList.toggle("is-calm", speedN < WIND_CALM_MS);

  const banner = $("demo-banner");
  if (banner) {
    const isMock = (data.source || "mock") === "mock";
    banner.hidden = !isMock;
  }
}

function prepareCanvas(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(canvas.clientWidth || 320, 40);
  const cssH = Math.max(canvas.clientHeight || 120, 40);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, cssW, cssH };
}

function seriesRange(values, fixed) {
  if (fixed && Number.isFinite(fixed.min) && Number.isFinite(fixed.max)) {
    return { min: fixed.min, max: fixed.max, span: fixed.max - fixed.min || 1 };
  }
  const finite = values.filter((v) => v != null && Number.isFinite(v));
  if (!finite.length) return { min: 0, max: 1, span: 1 };
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max, span: max - min };
}

function seriesValues(points, key) {
  let last = null;
  return points.map((p) => {
    const raw = p?.[key];
    if (raw == null || raw === "") return last;
    const n = Number(raw);
    if (!Number.isFinite(n)) return last;
    last = n;
    return n;
  });
}

function seriesCoords(values, cssW, cssH, padX, padTop, padBottom, range) {
  const { min, span } = range || seriesRange(values);
  return values.map((v, i) => {
    if (v == null || !Number.isFinite(v)) return null;
    const x = padX + (i / Math.max(values.length - 1, 1)) * (cssW - padX * 2);
    const y = padTop + (1 - (v - min) / span) * (cssH - padTop - padBottom);
    return { x, y };
  });
}

function drawGrid(ctx, cssW, cssH, padX, padTop, padBottom) {
  ctx.strokeStyle = "rgba(232,238,245,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const y = padTop + ((cssH - padTop - padBottom) * i) / 2;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(cssW - padX, y);
    ctx.stroke();
  }
}

function drawTimeAxis(ctx, points, cssW, cssH, padX, padBottom) {
  if (!points.length) return;
  const t0 = new Date(points[0].t).getTime();
  const t1 = new Date(points[points.length - 1].t).getTime();
  const spanMs = Number.isFinite(t0) && Number.isFinite(t1) ? Math.max(0, t1 - t0) : 0;
  const n = Math.min(5, points.length);
  ctx.fillStyle = "rgba(232,238,245,0.55)";
  ctx.font = "600 10px 'Nunito Sans', system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (let i = 0; i < n; i += 1) {
    const idx = n === 1 ? 0 : Math.round((i * (points.length - 1)) / (n - 1));
    const d = new Date(points[idx].t);
    if (Number.isNaN(d.getTime())) continue;
    const label =
      spanMs > 2 * 864e5
        ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
        : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const x = padX + (idx / Math.max(points.length - 1, 1)) * (cssW - padX * 2);
    ctx.textAlign = i === 0 ? "left" : i === n - 1 ? "right" : "center";
    ctx.fillText(label, x, cssH - padBottom + 3);
  }
}

function strokeSeries(ctx, coords, color, fill, cssH, padBottom) {
  const pts = coords.filter(Boolean);
  if (!pts.length) return;
  const baseY = cssH - padBottom;
  if (fill) {
    ctx.beginPath();
    pts.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.lineTo(pts[pts.length - 1].x, baseY);
    ctx.lineTo(pts[0].x, baseY);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.beginPath();
  pts.forEach((c, i) => {
    if (i === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = CHART_LINE_W;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawLineChart(canvasId, points, seriesList, opts = {}) {
  const canvas = $(canvasId);
  if (!canvas || $("view-historic").hidden) return;
  const prepared = prepareCanvas(canvas);
  if (!prepared || !points?.length) return;
  const { ctx, cssW, cssH } = prepared;
  const padX = CHART_PAD_X;
  const padTop = CHART_PAD_TOP;
  const padBottom = CHART_PAD_BOTTOM;
  drawGrid(ctx, cssW, cssH, padX, padTop, padBottom);

  const valueSets = seriesList.map((s) => {
    let vals = seriesValues(points, s.key);
    if (s.zeroGaps) vals = vals.map((v) => v ?? 0);
    return vals;
  });

  let sharedRange = null;
  if (opts.sharedScale) {
    const all = [];
    valueSets.forEach((vals) => {
      vals.forEach((v) => {
        if (v != null && Number.isFinite(v)) all.push(v);
      });
    });
    sharedRange = seriesRange(all);
  }

  seriesList.forEach((s, i) => {
    strokeSeries(
      ctx,
      seriesCoords(valueSets[i], cssW, cssH, padX, padTop, padBottom, sharedRange),
      s.color,
      s.fill,
      cssH,
      padBottom
    );
  });
  drawTimeAxis(ctx, points, cssW, cssH, padX, padBottom);
}

function windRoseBins(points) {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const bins = labels.map(() => ({ count: 0, speedSum: 0 }));
  points.forEach((p) => {
    if (p.windDirDeg == null) return;
    const idx = Math.round(Number(p.windDirDeg) / 45) % 8;
    bins[idx].count += 1;
    bins[idx].speedSum += Number(p.windMs) || 0;
  });
  return { labels, bins };
}

function drawWindRose(points) {
  const canvas = $("wind-rose");
  if (!canvas || $("view-historic").hidden) return;
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, cssW, cssH } = prepared;
  const { labels, bins } = windRoseBins(points);
  const cx = cssW / 2;
  const cy = cssH / 2;
  const radius = Math.min(cssW, cssH) * 0.38;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  ctx.strokeStyle = "rgba(232,238,245,0.14)";
  ctx.lineWidth = 1;
  for (let r = 1; r <= 3; r += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radius * r) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  labels.forEach((label, i) => {
    const ang = ((i * 45 - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius);
    ctx.strokeStyle = "rgba(232,238,245,0.12)";
    ctx.stroke();
    ctx.fillStyle = i === 0 ? "#ffe627" : "#c8d6ef";
    ctx.font = "700 12px 'Nunito Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      label,
      cx + Math.cos(ang) * (radius + 16),
      cy + Math.sin(ang) * (radius + 16)
    );
  });

  bins.forEach((bin, i) => {
    if (!bin.count) return;
    const ang = ((i * 45 - 90) * Math.PI) / 180;
    const len = (bin.count / maxCount) * radius;
    const half = (Math.PI / 8) * 0.85;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, len, ang - half, ang + half);
    ctx.closePath();
    ctx.fillStyle = "rgba(116, 19, 220, 0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 230, 39, 0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#003982";
  ctx.fill();
  ctx.strokeStyle = "rgba(8,132,134,0.8)";
  ctx.stroke();
}

function renderHistory(data) {
  lastHistory = data;
  const s = data.summary || {};
  const points = Array.isArray(data.points) ? data.points : [];

  $("h-wind-avg").textContent = fmtMph(s.wind?.avg);
  $("h-wind-high").textContent = fmtMph(s.wind?.high);

  const pressures = points.map((p) => Number(p.pressureHpa)).filter((n) => !Number.isNaN(n));
  const winds = points.map((p) => Number(p.windMs)).filter((n) => !Number.isNaN(n));
  const gusts = points.map((p) => Number(p.gustMs)).filter((n) => !Number.isNaN(n));
  const solars = points.map((p) => Number(p.wm2)).filter((n) => !Number.isNaN(n));
  const pressHigh = pressures.length ? Math.max(...pressures) : null;
  const pressLow = pressures.length ? Math.min(...pressures) : null;
  const windHigh = winds.length ? Math.max(...winds) : null;
  const windLow = winds.length ? Math.min(...winds) : null;
  const gustHigh = gusts.length ? Math.max(...gusts) : null;
  const solarHigh =
    s.solarHighWm2 != null
      ? s.solarHighWm2
      : solars.length
        ? Math.max(...solars)
        : null;

  $("lbl-temp-high").textContent = fmtNum(s.temp?.high);
  $("lbl-temp-low").textContent = fmtNum(s.temp?.low);
  $("lbl-hum-high").textContent =
    s.humidity?.high == null ? "--" : String(s.humidity.high);
  $("lbl-hum-low").textContent =
    s.humidity?.low == null ? "--" : String(s.humidity.low);
  $("lbl-wind-high").textContent = fmtMph(windHigh);
  $("lbl-wind-low").textContent = fmtMph(windLow);
  $("lbl-gust-high").textContent = fmtMph(gustHigh ?? s.wind?.high);
  $("lbl-press-high").textContent = fmtNum(pressHigh, 0);
  $("lbl-press-low").textContent = fmtNum(pressLow, 0);
  $("lbl-rain-high").textContent = fmtNum(s.rainTotalMm);
  $("lbl-solar-high").textContent = fmtNum(solarHigh, 0);

  drawWindRose(points);
  drawLineChart("chart-solar", points, [
    { key: "wm2", color: BAND.yellow, fill: BAND.yellowFill, zeroGaps: true },
  ]);
  drawLineChart("chart-rain", points, [
    { key: "rainMm", color: BAND.blue, fill: BAND.blueFill, zeroGaps: true },
  ]);
  drawLineChart(
    "chart-wind-gust",
    points,
    [
      { key: "windMs", color: BAND.orange, fill: BAND.orangeFill },
      { key: "gustMs", color: BAND.yellow, fill: null },
    ],
    { sharedScale: true }
  );
  drawLineChart("chart-pressure", points, [
    { key: "pressureHpa", color: BAND.blue, fill: BAND.blueFill },
  ]);
  drawLineChart("chart-temp-hum", points, [
    { key: "tempC", color: BAND.yellow, fill: BAND.yellowFill },
    { key: "humidity", color: BAND.green, fill: null },
  ]);
}

async function refresh() {
  try {
    const range = ["week", "month", "year"].includes(historyRange)
      ? historyRange
      : "week";
    const [current, history] = await Promise.all([
      getJson(dataUrl("current.json")),
      getJson(dataUrl(`history-${range}.json`)),
    ]);
    renderCurrent(current);
    renderHistory(history);
  } catch (err) {
    console.error(err);
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, REFRESH_MS);
}

function wireUi() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  document.querySelectorAll(".live-page-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLivePage(btn.dataset.page));
  });

  document.querySelectorAll(".history-range .seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".history-range .seg").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      historyRange = btn.dataset.range;
      refresh();
    });
  });
}

const CONSENT_KEY = "3rdAlbansWeather.consent.v3";
const GATE_KEY = "3rdAlbansWeather.gate.v1";
/** SHA-256 of the preview access password (plaintext is not stored in this repo). */
const GATE_HASH =
  "1f29e0c45ddd7a3a343efbb1b366be6aaf8d4bd0ce8e86fc731879d5bb801e78";
const GOAT_SRC = "https://gc.zgo.at/count.js";
const GOAT_ENDPOINT = "https://3rdalbansweatherstation.goatcounter.com/count";

function hasConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

function setConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, "1");
  } catch {
    /* private mode etc. */
  }
}

function isGateUnlocked() {
  try {
    return sessionStorage.getItem(GATE_KEY) === "1";
  } catch {
    return false;
  }
}

function setGateUnlocked() {
  try {
    sessionStorage.setItem(GATE_KEY, "1");
  } catch {
    /* private mode etc. */
  }
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function loadGoatCounter() {
  if (document.querySelector(`script[data-goatcounter="${GOAT_ENDPOINT}"]`)) {
    return;
  }
  const s = document.createElement("script");
  s.async = true;
  s.src = GOAT_SRC;
  s.dataset.goatcounter = GOAT_ENDPOINT;
  document.head.appendChild(s);
}

function wireWelcome() {
  const dialog = $("welcome-dialog");
  const ok = $("btn-welcome-ok");
  if (!dialog || !ok) return;

  const dismiss = () => {
    setConsent();
    loadGoatCounter();
    dialog.close();
  };

  ok.addEventListener("click", dismiss);

  if (!hasConsent()) {
    requestAnimationFrame(() => dialog.showModal());
  } else {
    loadGoatCounter();
  }
}

function wirePrivacy() {
  const dialog = $("privacy-dialog");
  const openBtn = $("btn-privacy");
  const closeBtn = $("btn-privacy-close");
  if (!dialog || !openBtn || !closeBtn) return;

  openBtn.addEventListener("click", () => dialog.showModal());
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

const CARD_HELP = {
  wind: {
    title: "Wind",
    capture: "Cups and a vane on the outdoor sensor spin and turn with the breeze.",
    use: "Shows how strong the wind is and which way it’s coming from — useful for camps, flags, and forecasts.",
  },
  temp: {
    title: "Outside temp",
    capture: "A thermometer in the outdoor sensor.",
    use: "The basic “how warm is it?” reading — frost, heat, and clothing choices.",
  },
  feels: {
    title: "Feels like",
    capture: "Calculated from temperature plus wind/humidity.",
    use: "Explains why a breezy day can feel colder than the thermometer says.",
  },
  humidity: {
    title: "Humidity",
    capture: "Measures how much water vapour is in the air.",
    use: "High = muggy/damp air; low = dry air — links to comfort and foggy weather.",
  },
  rain: {
    title: "Rain today",
    capture: "A tipping bucket counts raindrops through the day.",
    use: "Shows how wet today has been — useful for flooding, mud, and outdoor plans.",
  },
  pressure: {
    title: "Pressure",
    capture: "A barometer in the gateway measures air pressing down (we show it in hPa).",
    use: "Rising or falling pressure often hints at clearer or stormier weather.",
  },
  gust: {
    title: "Gust",
    capture: "The strongest short blast of wind in the last few seconds.",
    use: "Gusts can be much stronger than steady wind — important for safety outdoors.",
  },
  uv: {
    title: "UV",
    capture: "A sensor measures ultraviolet light from the sun (0–15).",
    use: "Helps with sun safety — UV can be strong even when it doesn’t feel hot.",
  },
  indoor: {
    title: "Inside the hut",
    capture: "Sensors in the gateway for indoor temperature and humidity.",
    use: "Shows comfort inside the hut, which can be very different from outside.",
  },
  rainrate: {
    title: "Rain rate",
    capture: "How fast rain is falling right now (mm per hour).",
    use: "Tells a shower from a downpour — useful for short-term decisions.",
  },
  dew: {
    title: "Dew point",
    capture: "Calculated from temperature and humidity.",
    use: "The temperature where dew (or fog) can form — a clue about moisture in the air.",
  },
  solar: {
    title: "Sunlight",
    capture: "Measures solar energy hitting the sensor (W/m²).",
    use: "Shows how strong the daylight/sun energy is — useful with UV.",
  },
  rainhour: {
    title: "Rain hour",
    capture: "Rain counted in the last 60 minutes.",
    use: "Answers “has it just bucketed down?”",
  },
  rainweek: {
    title: "Rain week",
    capture: "Rain added up for the week so far.",
    use: "Good for spotting a wet or dry spell.",
  },
  sky: {
    title: "Sky",
    capture: "A simple word we make from the readings (not a full forecast).",
    use: "Quick “what’s it like?” label for kids and leaders.",
  },
  rose: {
    title: "Wind rose",
    capture: "Built from wind direction readings over the chosen time.",
    use: "Shows which directions the wind came from most.",
  },
  "chart-solar": {
    title: "Solar chart",
    capture: "Sunlight readings from the outdoor sensor over time.",
    use: "Shows how strong the sun’s energy was across the week, month, or year.",
  },
  "chart-rain": {
    title: "Rain chart",
    capture: "Rainfall readings from the tipping bucket over time.",
    use: "Shows wet and dry spells across the chosen period.",
  },
  "chart-wind": {
    title: "Wind & gust chart",
    capture: "Steady wind and short gust readings over time.",
    use: "Compares everyday breeze with stronger blasts across the period.",
  },
  "chart-pressure": {
    title: "Pressure chart",
    capture: "Air pressure readings from the gateway barometer over time.",
    use: "Rising or falling pressure often hints at clearer or stormier weather.",
  },
  "chart-temp-hum": {
    title: "Temp & humidity chart",
    capture: "Outside temperature and humidity readings over time.",
    use: "Shows how warm and damp the air has been across the period.",
  },
};

function openCardHelp(key) {
  const dialog = $("learn-dialog");
  const title = $("learn-title");
  const body = $("learn-body");
  const info = CARD_HELP[key];
  if (!dialog || !title || !body || !info) return;
  title.textContent = info.title;
  body.innerHTML = "";
  const p1 = document.createElement("p");
  p1.innerHTML = `<strong>How it’s captured:</strong> ${info.capture}`;
  const p2 = document.createElement("p");
  p2.innerHTML = `<strong>How it’s used:</strong> ${info.use}`;
  body.append(p1, p2);
  dialog.showModal();
}

function wireHelp() {
  const dialog = $("learn-dialog");
  const closeBtn = $("btn-learn-close");
  if (!dialog || !closeBtn) return;
  if (document.body.dataset.helpWired === "1") return;
  document.body.dataset.helpWired = "1";

  document.querySelectorAll("[data-help]").forEach((el) => {
    const key = el.dataset.help;
    if (!CARD_HELP[key] || el.querySelector(":scope > .card-help")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-help";
    btn.textContent = "?";
    btn.setAttribute("aria-label", `About ${CARD_HELP[key].title}`);
    // Beat global button min sizes even if CSS cache is stale
    btn.style.cssText =
      "width:16px;height:16px;min-width:16px;min-height:16px;max-width:16px;max-height:16px;padding:0;font-size:11px;line-height:1;box-sizing:border-box;";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCardHelp(key);
    });
    el.appendChild(btn);
  });

  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

function unlockSite() {
  document.body.classList.remove("is-gated");
  const gate = $("gate-dialog");
  if (gate?.open) gate.close();
  wireWelcome();
  wirePrivacy();
  wireHelp();
}

function wireGate() {
  const dialog = $("gate-dialog");
  const form = $("gate-form");
  const input = $("gate-password");
  const err = $("gate-error");
  if (!dialog || !form || !input) {
    unlockSite();
    return;
  }

  if (isGateUnlocked()) {
    unlockSite();
    return;
  }

  document.body.classList.add("is-gated");
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (err) err.hidden = true;
    const typed = String(input.value || "");
    let ok = false;
    try {
      ok = (await sha256Hex(typed)) === GATE_HASH;
    } catch {
      ok = false;
    }
    if (!ok) {
      if (err) err.hidden = false;
      input.value = "";
      input.focus();
      return;
    }
    setGateUnlocked();
    unlockSite();
  });

  requestAnimationFrame(() => {
    dialog.showModal();
    input.focus();
  });
}

wireUi();
wireGate();
setView("live");
refresh();
scheduleRefresh();
window.addEventListener("resize", () => {
  if (currentView === "historic" && lastHistory) renderHistory(lastHistory);
});
