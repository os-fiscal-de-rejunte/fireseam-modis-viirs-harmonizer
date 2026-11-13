import "./style.css";
import {
  loadCube,
  loadData,
  loadForecast,
  loadYear,
  pooledShare,
  weekSlice,
  yearlyTotals,
} from "./data.js";
import { aoiBounds, areaCalendar, cellsFromLonLat, formatAoiHash, parseAoiHash } from "./aoi.js";
import { analyze, yearToDate } from "./stats.js";
import { csvFileName, downloadCsv, toCsv } from "./csv.js";
import { createGlobe, FORECAST_GRADIENT, forecastColor } from "./globe.js";
import { createHeatmap } from "./heatmap.js";
import { createYearly } from "./yearly.js";
import { play as playYear, stop as stopSound } from "./sound.js";

const $ = (id) => document.getElementById(id);
const app = $("app");
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nf = new Intl.NumberFormat("en-US");
const fmt = (v) => (v == null ? "-" : nf.format(Math.round(v)));
const NX = 45;
const NY = 70;

const state = {
  year: 2020,
  week: 1,
  playing: false,
  hearing: false,
  mode: "past",
  month: 1,
  show: { modis: true, viirs: true, ghostOnly: false },
  cumulative: false,
  aoi: null,
  selecting: false,
};

let data;
let forecast = null;
let globe;
let heat;
let yearly;
let years = [];
let timer = null;
// The calendar every view reads: the regional one, or the selected area's.
let active = null;
let aoiSeq = 0;

const scopeSuffix = () => (state.aoi ? " (whole region)" : "");

function monthDay(year, week, end) {
  const d = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const last = end && week >= 52 ? new Date(Date.UTC(year, 11, 31)) : new Date(d.getTime() + 6 * 864e5);
  return (end ? last : d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function rangeText(cell) {
  if (cell?.status !== "estimated" || cell.lo == null || cell.hi == null) return null;
  return `range ${fmt(cell.lo)}-${fmt(cell.hi)} (regional conversion only)`;
}

function unusualText(stat) {
  if (!stat) return null;
  if (stat.record) return "record for this week";
  if (stat.unusual) return `unusual: above ${Math.round(stat.percentile * 100)}% of other years`;
  return null;
}

function weekDates(year, week) {
  const start = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const end = week >= 52 ? new Date(Date.UTC(year, 11, 31)) : new Date(start.getTime() + 6 * 864e5);
  const f = (d, withYear) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: withYear ? "numeric" : undefined,
      timeZone: "UTC",
    });
  return { label: `${f(start)} - ${f(end, true)}`, month: start.getUTCMonth() + 1 };
}

function nearestYearIndex(year) {
  let best = 0;
  years.forEach((y, i) => {
    if (Math.abs(y - year) < Math.abs(years[best] - year)) best = i;
  });
  return best;
}

async function updateGlobe() {
  const year = state.year;
  let pts = null;
  if (data.index[String(year)]) {
    try {
      pts = await loadYear(year);
    } catch (err) {
      console.warn(err.message);
    }
  }
  if (year !== state.year) return;
  const [s, e] = pts ? weekSlice(data.index, year, state.week) : [0, 0];
  const start = state.cumulative && pts ? 0 : s;
  globe.setPoints(pts, [start, e], state.show);
}

function updateReadout() {
  const cell = heat.cell(state.year, state.week);
  const { label, month } = weekDates(state.year, state.week);
  $("r-date").textContent = label;
  $("r-modis").textContent = fmt(cell?.modis);
  $("r-viirs").textContent = fmt(cell?.viirs);
  $("r-harm").textContent = fmt(cell?.harmonized);
  const status = cell ? cell.status : "gap";
  const badge = $("r-status");
  badge.className = `badge ${status}`;
  badge.textContent = status;
  let nrt = document.getElementById("r-nrt");
  if (cell?.nrt) {
    if (!nrt) {
      nrt = document.createElement("span");
      nrt.id = "r-nrt";
      nrt.className = "badge nrt";
      badge.after(nrt);
    }
    nrt.textContent = "provisional (NRT)";
  } else if (nrt) {
    nrt.remove();
  }
  const empty = $("r-empty");
  empty.hidden = !!data.index[String(state.year)];
  empty.textContent = `No point file for ${state.year}`;
  $("ghost-note").hidden = state.year < 2022;
  const parts = [];
  if (cell) {
    parts.push(rangeText(cell), unusualText(active.analysis.stats.get(`${state.year}:${state.week}`)));
    const ytd = yearToDate(active.calendar, state.year, state.week);
    if (active.analysis.sufficient && ytd.percentile !== null) {
      parts.push(
        `${state.year} to date: ${fmt(ytd.value)}, above ${Math.round(ytd.percentile * 100)}% of other years`,
      );
    }
    if (cell.factor === false) parts.push("no regional MODIS count this week");
  }
  $("r-extra").textContent = parts.filter(Boolean).join(" · ");
  return month;
}

function updateHeadline() {
  const m = data.metrics;
  const w = m.weekly_total;
  $("h-model").textContent = fmt(w.mae_model);
  $("h-base").textContent = fmt(w.mae_baseline);
  $("h-err-label").textContent =
    `Mean weekly error, model vs baseline. Won ${w.years_won} of ${w.years} held-out years.`;
  const [y0, y1] = m.pairing.headline_years;
  const rows = m.pairing.by_year.filter((r) => r.year >= y0 && r.year <= y1);
  const share = pooledShare(rows, "viirs_unmatched", "viirs_n");
  $("h-unmatched").textContent = share == null ? "-" : `${(share * 100).toFixed(1)}%`;
  $("h-unmatched-label").textContent =
    `of S-NPP detections had no Aqua match in the same overpass, ${y0}-${y1}${scopeSuffix()}`;
  $("baseline-note").hidden = m.method !== "baseline";
  updateEvents();
}

function updateEvents() {
  const ev = data.metrics.events.find((e) => e.year === state.year);
  $("h-ev-modis").textContent = ev ? fmt(ev.modis) : "-";
  $("h-ev-viirs").textContent = ev ? fmt(ev.viirs) : "-";
  $("h-ev-label").textContent = `Fire events in ${state.year}, MODIS vs VIIRS${scopeSuffix()}`;
}

function syncControls() {
  $("year").value = String(nearestYearIndex(state.year));
  $("year-out").textContent = state.year;
  $("week").value = String(state.week);
  $("week-out").textContent = state.week;
  $("hear").textContent = state.hearing ? `Stop ${state.year}` : `Hear ${state.year}`;
  $("play").textContent = state.playing ? "Pause" : "Play";
}

function select(year, week, { fromMusic = false } = {}) {
  const yearChanged = year !== state.year;
  state.year = year;
  state.week = week;
  heat.select(year, week);
  yearly.select(year);
  const month = updateReadout();
  if (yearChanged) updateEvents();
  if (!fromMusic || yearChanged) syncControls();
  else {
    $("week").value = String(week);
    $("week-out").textContent = week;
  }
  if (state.mode === "past") state.month = month;
  updateGlobe();
}

function setPlaying(on) {
  state.playing = on;
  clearInterval(timer);
  if (on) {
    if (state.hearing) setHearing(false);
    timer = setInterval(() => {
      let { year, week } = state;
      week += 1;
      if (week > 52) {
        const i = years.indexOf(year);
        if (i < 0 || i >= years.length - 1) return setPlaying(false);
        year = years[i + 1];
        week = 1;
      }
      select(year, week);
    }, 130);
  }
  syncControls();
}

async function setHearing(on) {
  if (!on) {
    state.hearing = false;
    stopSound();
    syncControls();
    return;
  }
  setPlaying(false);
  state.hearing = true;
  syncControls();
  const note = $("audio-note");
  note.hidden = true;
  try {
    await playYear(active.calendar, state.year, {
      onWeek: (week) => state.hearing && select(state.year, week, { fromMusic: true }),
    });
  } catch (err) {
    console.warn("Audio unavailable:", err);
    note.textContent = "Audio is unavailable in this browser.";
    note.hidden = false;
  }
  state.hearing = false;
  syncControls();
}

function showTip(html, ev) {
  const tip = $("tip");
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function hideTip() {
  $("tip").hidden = true;
}

function heatTip(pos, ev, cell, stat) {
  if (!pos || !cell) return hideTip();
  const { label } = weekDates(pos.year, pos.week);
  const status =
    cell.status === "observed"
      ? "observed (VIIRS)"
      : cell.status === "estimated"
        ? "estimated (MODIS converted)"
        : "no data";
  showTip(
    `<b>${label}</b>
     <span class="mut">MODIS</span> ${fmt(cell.modis)} &nbsp; <span class="mut">VIIRS</span> ${fmt(cell.viirs)}<br/>
     <span class="mut">Harmonized</span> ${fmt(cell.harmonized)}<br/>
     ${[rangeText(cell), unusualText(stat)]
       .filter(Boolean)
       .map((t) => `<span class="mut">${t}</span><br/>`)
       .join("")}
     <span class="mut">${status}${cell.nrt ? ", provisional (NRT)" : ""}</span>`,
    ev,
  );
}

function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === "outlook") {
    setPlaying(false);
    setHearing(false);
    state.month = weekDates(state.year, state.week).month;
    renderMonths();
    setSelecting(false);
  }
  state.mode = mode;
  app.dataset.mode = mode;
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.mode === mode);
  });
  hideTip();
  globe.setMode(mode);
  if (mode === "outlook") globe.setMonth(state.month);
  else updateGlobe();
}

function renderMonths() {
  document.querySelectorAll(".month").forEach((b) => {
    b.classList.toggle("is-active", Number(b.dataset.month) === state.month);
  });
}

function setupForecast() {
  const meta = forecast.meta;
  $("tab-outlook").hidden = false;
  $("fc-event").textContent = meta.event;
  $("fc-cover").textContent =
    `${nf.format(meta.cells_released)} of ${nf.format(meta.cells_total)} studied cells released, ` +
    `${nf.format(meta.released_area_km2)} km². Each cell is the chance of a detection in an ` +
    `${meta.horizon_days}-day window.`;
  const t = meta.test;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  $("fc-skill").innerHTML = [
    ["Accuracy", pct(t.accuracy)],
    ["Recall", pct(t.recall)],
    ["Precision", pct(t.precision)],
    ["Brier", t.brier.toFixed(3)],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
  $("fc-n").textContent = `${nf.format(t.n)} held-out cell-windows. ROC AUC ${t.roc_auc.toFixed(2)}.`;
  $("fc-bar").style.background = `linear-gradient(to right, ${FORECAST_GRADIENT.join(",")})`;
  globe.setForecast(forecast);
  $("fc-max").textContent = `${(globe.pMax * 100).toFixed(0)}%`;

  const months = $("months");
  MONTH_NAMES.forEach((name, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "month";
    b.dataset.month = String(i + 1);
    b.textContent = name;
    b.addEventListener("click", () => {
      state.month = i + 1;
      renderMonths();
      globe.setMonth(state.month);
    });
    months.append(b);
  });
}

function cellTip(info) {
  const obj = info.object;
  if (!obj) return hideTip();
  const cell = obj.cell || obj;
  const p = cell.p[state.month - 1];
  if (p == null) return hideTip();
  const c = forecastColor(p, globe.pMax);
  showTip(
    `<b>${(p * 100).toFixed(1)}% <span class="mut">detection chance</span></b>
     ${cell.continent}<br/>
     <span class="mut">${MONTH_NAMES[state.month - 1]}, 8-day window</span>`,
    { clientX: info.x + info.viewport.x, clientY: info.y + 60 },
  );
  $("tip").style.borderColor = `rgb(${c.join(",")})`;
}

function setSelecting(on) {
  state.selecting = on;
  globe.setSelecting(on);
  if (!on) drawCommittedAoi();
  $("aoi-select").setAttribute("aria-pressed", String(on));
}

function drawCommittedAoi() {
  globe.setAoi(state.aoi ? areaBounds(state.aoi) : null);
}

function cellsOf(a, b) {
  const { bbox, cell_deg: cellDeg } = data.calendar.meta;
  return cellsFromLonLat(a, b, bbox, cellDeg, NX, NY);
}

function areaBounds(aoi) {
  const { bbox, cell_deg: cellDeg } = data.calendar.meta;
  return aoiBounds(aoi, bbox, cellDeg);
}

function criticalText(analysis) {
  const c = analysis.critical;
  if (!analysis.sufficient || !c) return "Not enough detections in this area";
  return (
    `Critical period: weeks ${c.start}-${c.end} (${monthDay(2001, c.start, false)} - ` +
    `${monthDay(2001, c.end, true)}), ${Math.round(c.share * 100)}% of a typical year`
  );
}

function showActive(aoi, calendar) {
  setPlaying(false);
  setHearing(false);
  state.aoi = aoi;
  active = { calendar, analysis: analyze(calendar) };
  heat.setCalendar(active.calendar, active.analysis);
  yearly.setTotals(yearlyTotals(active.calendar));
  updateReadout();
  updateHeadline();
  const b = aoi && areaBounds(aoi);
  $("aoi-label").textContent = b
    ? `Area: ${b[0].toFixed(1)} to ${b[2].toFixed(1)}, ${b[1].toFixed(1)} to ${b[3].toFixed(1)}`
    : "Whole region";
  $("aoi-clear").hidden = !aoi;
  $("aoi-assume").hidden = !aoi;
  $("critical").textContent = criticalText(active.analysis);
  globe.setAoi(b);
  if (aoi) {
    if (location.hash !== "#outlook") history.replaceState(null, "", formatAoiHash(aoi));
  } else if (location.hash.startsWith("#aoi")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

async function setAoi(aoi) {
  const seq = ++aoiSeq;
  setPlaying(false);
  setHearing(false);
  const note = $("aoi-note");
  if (!aoi) {
    note.hidden = true;
    showActive(null, data.calendar);
    return;
  }
  let cube;
  try {
    cube = await loadCube();
  } catch (err) {
    if (seq !== aoiSeq) return;
    showActive(null, data.calendar);
    note.textContent = `Could not load the area data: ${err.message}`;
    note.hidden = false;
    return;
  }
  if (seq !== aoiSeq) return;
  note.hidden = true;
  showActive(aoi, areaCalendar(cube, data.calendar, aoi));
}

function wire() {
  $("aoi-select").addEventListener("click", () => {
    if (state.mode === "past") setSelecting(!state.selecting);
  });
  $("aoi-clear").addEventListener("click", () => setAoi(null));
  $("csv").addEventListener("click", () => {
    const bounds = state.aoi ? areaBounds(state.aoi) : data.calendar.meta.bbox;
    downloadCsv(csvFileName(bounds), toCsv(active.calendar, active.analysis.stats));
  });
  const yearInput = $("year");
  yearInput.max = String(years.length - 1);
  yearInput.addEventListener("input", () => {
    if (state.hearing) setHearing(false);
    select(years[Number(yearInput.value)], state.week);
  });
  $("week").addEventListener("input", (e) => {
    if (state.hearing) setHearing(false);
    select(state.year, Number(e.target.value));
  });
  $("play").addEventListener("click", () => setPlaying(!state.playing));
  $("hear").addEventListener("click", () => setHearing(!state.hearing));
  $("t-modis").addEventListener("change", (e) => toggle("modis", e.target.checked));
  $("t-viirs").addEventListener("change", (e) => toggle("viirs", e.target.checked));
  $("t-ghost").addEventListener("change", (e) => toggle("ghostOnly", e.target.checked));
  $("t-cum").addEventListener("change", (e) => {
    state.cumulative = e.target.checked;
    updateGlobe();
  });
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => setMode(t.dataset.mode));
  });
  document.querySelectorAll(".seg button").forEach((b) => {
    b.addEventListener("click", () => setDockView(b.dataset.view));
  });
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || state.mode !== "past") return;
    if (e.code === "Space") {
      e.preventDefault();
      setPlaying(!state.playing);
    }
  });
}

function setDockView(view) {
  $("dock-past").dataset.view = view;
  document.querySelectorAll(".seg button").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  hideTip();
}

function toggle(key, value) {
  state.show = { ...state.show, [key]: value };
  updateGlobe();
}

async function start() {
  try {
    [data, forecast] = await Promise.all([loadData("./data"), loadForecast("./data")]);
  } catch (err) {
    const el = $("fatal");
    el.hidden = false;
    el.textContent = err.message;
    return;
  }
  years = Object.keys(data.index)
    .map(Number)
    .sort((a, b) => a - b);
  if (!years.length) {
    $("fatal").hidden = false;
    $("fatal").textContent = "No point files found in points/index.json";
    return;
  }
  if (!years.includes(state.year)) state.year = years[years.length - 1];

  globe = createGlobe($("globe"), {
    onHover: (info) => (state.mode === "outlook" ? cellTip(info) : null),
    onClick: (info) => {
      if (state.mode === "outlook" && info.object) {
        globe.setSelectedCell((info.object.cell || info.object).id);
        cellTip(info);
      }
    },
    onAreaDrag: (a, b) => globe.setAoi(areaBounds(cellsOf(a, b))),
    onAreaCancel: drawCommittedAoi,
    onAreaSelect: (a, b) => {
      const aoi = cellsOf(a, b);
      setSelecting(false);
      globe.setAoi(areaBounds(aoi));
      setAoi(aoi);
    },
  });
  heat = createHeatmap($("cal"), data.calendar, {
    onSelect: (y, w) => {
      if (state.hearing) setHearing(false);
      select(y, w);
    },
    onHover: heatTip,
  });
  active = { calendar: data.calendar, analysis: analyze(data.calendar) };
  heat.setCalendar(active.calendar, active.analysis);
  yearly = createYearly($("yr"), yearlyTotals(active.calendar), {
    onSelect: (y) => {
      if (state.hearing) setHearing(false);
      select(y, state.week);
    },
  });
  wire();
  updateHeadline();
  if (forecast) setupForecast();
  $("critical").textContent = criticalText(active.analysis);
  const startAoi = parseAoiHash(location.hash, NX, NY);
  if (startAoi) await setAoi(startAoi);
  const inYear = active.calendar.weeks.filter((w) => w.year === state.year && w.harmonized != null);
  const peak = inYear.reduce((a, w) => (a && a.harmonized >= w.harmonized ? a : w), null);
  select(state.year, peak ? peak.week : 26);
  if (forecast && location.hash === "#outlook") setMode("outlook");
}

start();
