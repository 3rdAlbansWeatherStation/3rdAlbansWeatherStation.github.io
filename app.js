/**
 * Public GitHub Pages UI — same design as the Pi kiosk.
 * Loads static JSON from ./data/ (written by Ecowitt cloud GitHub Action).
 * Never put API keys or credentials in this folder.
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
  yellowFill: "rgba(255,230,39,0.22)",
  green: "#25b755",
  greenFill: "rgba(37,183,85,0.18)",
  orange: "#ff912a",
  orangeFill: "rgba(255,145,42,0.22)",
  blue: "#006ddf",
  blueFill: "rgba(0,109,223,0.2)",
};

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
  const show1 = livePage === "1";
  page1.hidden = !show1;
  page2.hidden = show1;
  page1.style.display = show1 ? "" : "none";
  page2.style.display = show1 ? "none" : "";
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

function seriesRange(values) {
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

function seriesCoords(values, cssW, cssH, padX, padY) {
  const { min, span } = seriesRange(values);
  return values.map((v, i) => {
    if (v == null || !Number.isFinite(v)) return null;
    const x = padX + (i / Math.max(values.length - 1, 1)) * (cssW - padX * 2);
    const y = padY + (1 - (v - min) / span) * (cssH - padY * 2);
    return { x, y };
  });
}

function drawGrid(ctx, cssW, cssH, padX, padY) {
  ctx.strokeStyle = "rgba(232,238,245,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const y = padY + ((cssH - padY * 2) * i) / 2;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(cssW - padX, y);
    ctx.stroke();
  }
}

function strokeSeries(ctx, coords, color, fill, cssH, padY) {
  const pts = coords.filter(Boolean);
  if (!pts.length) return;
  if (fill) {
    ctx.beginPath();
    pts.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.lineTo(pts[pts.length - 1].x, cssH - padY);
    ctx.lineTo(pts[0].x, cssH - padY);
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
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawDualChart(canvasId, points, leftKey, rightKey, leftStyle, rightStyle) {
  const canvas = $(canvasId);
  if (!canvas || $("view-historic").hidden) return;
  const prepared = prepareCanvas(canvas);
  if (!prepared || !points?.length) return;
  const { ctx, cssW, cssH } = prepared;
  const padX = 6;
  const padY = 10;
  drawGrid(ctx, cssW, cssH, padX, padY);
  const leftVals = seriesValues(points, leftKey);
  const rightVals = seriesValues(points, rightKey);
  strokeSeries(
    ctx,
    seriesCoords(leftVals, cssW, cssH, padX, padY),
    leftStyle.color,
    leftStyle.fill,
    cssH,
    padY
  );
  strokeSeries(
    ctx,
    seriesCoords(rightVals, cssW, cssH, padX, padY),
    rightStyle.color,
    rightStyle.fill,
    cssH,
    padY
  );
}

function drawRainChart(points) {
  const canvas = $("chart-rain");
  if (!canvas || $("view-historic").hidden) return;
  const prepared = prepareCanvas(canvas);
  if (!prepared || !points?.length) return;
  const { ctx, cssW, cssH } = prepared;
  const padX = 6;
  const padY = 10;
  drawGrid(ctx, cssW, cssH, padX, padY);
  const values = seriesValues(points, "rainMm").map((v) => v ?? 0);
  strokeSeries(
    ctx,
    seriesCoords(values, cssW, cssH, padX, padY),
    BAND.blue,
    BAND.blueFill,
    cssH,
    padY
  );
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
  const pressHigh = pressures.length ? Math.max(...pressures) : null;
  const pressLow = pressures.length ? Math.min(...pressures) : null;
  const windLow = winds.length ? Math.min(...winds) : null;

  $("lbl-temp-high").textContent = fmtNum(s.temp?.high);
  $("lbl-temp-low").textContent = fmtNum(s.temp?.low);
  $("lbl-hum-high").textContent =
    s.humidity?.high == null ? "--" : String(s.humidity.high);
  $("lbl-hum-low").textContent =
    s.humidity?.low == null ? "--" : String(s.humidity.low);
  $("lbl-wind-high").textContent = fmtMph(s.wind?.high);
  $("lbl-wind-low").textContent = fmtMph(windLow);
  $("lbl-press-high").textContent = fmtNum(pressHigh, 0);
  $("lbl-press-low").textContent = fmtNum(pressLow, 0);
  $("lbl-rain-high").textContent = fmtNum(s.rainTotalMm);

  drawWindRose(points);
  drawRainChart(points);
  drawDualChart(
    "chart-temp-hum",
    points,
    "tempC",
    "humidity",
    { color: BAND.yellow, fill: BAND.yellowFill },
    { color: BAND.green, fill: null }
  );
  drawDualChart(
    "chart-wind-pressure",
    points,
    "windMs",
    "pressureHpa",
    { color: BAND.orange, fill: BAND.orangeFill },
    { color: BAND.blue, fill: null }
  );
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

wireUi();
wireWelcome();
wirePrivacy();
setView("live");
refresh();
scheduleRefresh();
window.addEventListener("resize", () => {
  if (currentView === "historic" && lastHistory) renderHistory(lastHistory);
});
