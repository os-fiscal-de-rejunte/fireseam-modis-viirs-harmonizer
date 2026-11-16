import "./style.css";
import {
  loadCalendars,
  loadCube,
  loadForecast,
  loadRegionData,
  loadRegions,
  loadYear,
  pooledShare,
  regionBase,
  weekSlice,
  yearlyTotals,
} from "./data.js";
import { aoiBounds, areaCalendar, cellsFromLonLat } from "./aoi.js";
import { analyze, yearToDate } from "./stats.js";
import { csvFileName, downloadCsv, toCsv } from "./csv.js";
import { CELL_RAMP_FROM, createGlobe, FORECAST_GRADIENT, forecastColor } from "./globe.js";
import { createHeatmap, fireColor } from "./heatmap.js";
import { createYearly } from "./yearly.js";
import { createQuality } from "./quality.js";
import { asOfWeek, blindSpotCounts, qualitySentence, weekCodes } from "./blindspots.js";
import { alertReadout, alertTest, currentAlert, DEFAULT_P, THRESHOLDS } from "./alert.js";
import {
  createRegionLoader,
  formatHash,
  MIN_YEARS_SCORED,
  parseHash,
  regionHeading,
  regionState,
  regionTitle,
  regionView,
} from "./region.js";
import { rankRegions } from "./ranking.js";
import { CELL_DEG, cellLayerLabel, cellPolygons, cellTotals } from "./hotcells.js";
import { TEXT, briefingFileName, downloadHtml, readLang, renderBriefing, writeLang } from "./briefing.js";
import { play as playYear, stop as stopSound } from "./sound.js";
import { asOfDate, weekSentence, ytdComparison } from "./weekline.js";
import { coverFrame, fitZoom, ZERO } from "./framing.js";

const $ = (id) => document.getElementById(id);
const app = $("app");
const BASE = "./data";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nf = new Intl.NumberFormat("en-US");
const fmt = (v) => (v == null ? "-" : nf.format(Math.round(v)));
const COVER_TITLE = document.title;
const WRAPS_SUFFIX = " (unreliable here: the season crosses the year end)";
const STATE_LABEL = { accepted: "accepted", baseline: "baseline", not_validated: "not validated" };
const STATE_NOTE = {
  accepted: "The model beat the simple monthly ratio on held-out years, so estimated weeks use it.",
  baseline: "The published calendar uses the monthly ratio baseline because the model did not beat it.",
  not_validated: `Fewer than ${MIN_YEARS_SCORED} scored years here: the simple monthly ratio is used and has not been validated.`,
};
// The pick's motion: how long the cover takes to leave, and how long the arrival lasts in all.
const LEAVE_MS = 420;
const ARRIVE_MS = 1100;
// How long the camera's centre takes to move between the cover and a region.
const GLIDE_MS = 1000;
// Height kept for the readout over the globe, so the region's frame does not follow it week by
// week, and the margin left around a region's box.
const READOUT_ROOM = 166;
const FRAME_MARGIN = 24;

const state = {
  year: 2020,
  week: 1,
  playing: false,
  hearing: false,
  // "regions" (the planet cover), "past" or "outlook"; null until the first one is set.
  mode: null,
  // The open region: a regions.json row, or null before one is opened.
  region: null,
  month: 1,
  show: { modis: true, viirs: true, ghostOnly: false },
  cumulative: false,
  aoi: null,
  selecting: false,
  p: DEFAULT_P,
};

let data;
let forecast = null;
let globe;
let heat;
let yearly;
let quality;
let years = [];
let timer = null;
// The calendar every view reads: the regional one, or the selected area's.
let active = null;
let aoiSeq = 0;
// regions.json rows, the cover's ranking rows (null while loading) and load errors by region id.
let regions = [];
let ranking = null;
let rankingError = null;
const rowErrors = new Map();
// Region and year of the cell layer on the globe, so it is rebuilt only when either changes.
let cellsKey = "";

const has = (key) => (state.region?.has ?? []).includes(key);
const seasonWraps = () => !!state.region?.season_wraps;

// The only guard against a late answer from the previous region. The forecast belongs to the
// regions whose `has` lists it.
const loadRegion = createRegionLoader(async (row) => {
  const withForecast = (row.has ?? []).includes("forecast");
  const [loaded, fc] = await Promise.all([
    loadRegionData(row, BASE),
    withForecast ? loadForecast(regionBase(BASE, row)) : null,
  ]);
  if (!loaded.calendar?.weeks?.length) throw new Error(`Could not load ${row.id} calendar.json: no weeks`);
  return { ...loaded, forecast: fc };
});

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

function percentileText(stat) {
  if (!stat || stat.percentile === null || stat.percentile === undefined) return null;
  return `above ${Math.round(stat.percentile * 100)}% of other years`;
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
  const { year, region } = state;
  if (!region || !data) return;
  if (!data.index) return updateCells(region, year);
  let pts = null;
  if (data.index[String(year)]) {
    try {
      pts = await loadYear(year, regionBase(BASE, region), [region.bbox[0], region.bbox[1]]);
    } catch (err) {
      console.warn(err.message);
    }
  }
  if (year !== state.year || region !== state.region) return;
  const [s, e] = pts ? weekSlice(data.index, year, state.week) : [0, 0];
  const start = state.cumulative && pts ? 0 : s;
  globe.setPoints(pts, [start, e], state.show);
}

// A region without points draws its detections per cell for the year; it follows the year only.
async function updateCells(region, year) {
  const key = `${region.id}|${year}`;
  if (key === cellsKey) return;
  cellsKey = key;
  const label = $("cells-label");
  label.textContent = cellLayerLabel(year);
  let cube;
  try {
    cube = await loadCube(regionBase(BASE, region));
  } catch (err) {
    if (cellsKey !== key) return;
    cellsKey = "";
    globe.setCells(null);
    label.textContent = `Could not load the cell data: ${err.message}`;
    return;
  }
  if (cellsKey !== key || region !== state.region) return;
  globe.setCells(cellPolygons(cellTotals(cube, data.calendar, { year }), region.bbox, CELL_DEG, region.nx));
}

function alertResults() {
  return {
    current: currentAlert(active.calendar, active.analysis, state.p, seasonWraps()),
    test: alertTest(active.calendar, active.analysis, state.p, seasonWraps()),
  };
}

function updateAlert() {
  const { current, test } = alertResults();
  const label = $("alert-label");
  const body = $("alert-body");
  const r = alertReadout(current, test);
  // The readout says where this year stands; the test counts live in the Alert test view.
  $("r-alert").textContent = r.kind === "label" ? r.text : r.head;
  label.hidden = r.kind !== "label";
  body.hidden = r.kind === "label";
  if (r.kind === "label") {
    label.textContent = r.text;
    return;
  }
  const c = test.counts;
  $("alert-counts").textContent =
    `Test at this threshold, 2001-2025 (a retrospective test, not a finding): ${c.hit} hits, ${c.late} late, ` +
    `${c.miss} missed, ${c.false_alarm} false alarms, ${c.quiet} quiet, ${c.incomplete} incomplete`;
  $("alert-lead").textContent =
    test.medianLead === null ? "No hits, so no median lead." : `Median lead of the hits: ${test.medianLead} weeks`;
  const marks = $("alert-marks");
  marks.replaceChildren(
    ...test.seasons.map((s) => {
      const i = document.createElement("i");
      i.className = `mark ${s.outcome}`;
      i.title = `${s.year}: ${s.outcome}`;
      return i;
    }),
  );
  const rows = test.seasons.map((s) => {
    const tr = document.createElement("tr");
    for (const v of [s.year, s.outcome, s.alertWeek ?? "-", s.peakWeek ?? "-", s.lead ?? "-", fmt(s.total)]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    return tr;
  });
  $("alert-table").tBodies[0].replaceChildren(...rows);
}

function updateReadout() {
  const cell = heat.cell(state.year, state.week);
  const { label, month } = weekDates(state.year, state.week);
  const stat = active.analysis.stats.get(`${state.year}:${state.week}`);
  const sentence = weekSentence(cell, stat);
  const line = $("r-sentence");
  line.hidden = !sentence;
  line.textContent = sentence ? sentence.text : "";
  line.classList.toggle("is-fire", !!sentence?.fire);
  // A gap week shows no number at all, never a zero.
  const gap = !cell || cell.status === "gap" || cell.harmonized == null;
  $("r-date").textContent = label;
  $("r-modis").textContent = gap ? "-" : fmt(cell.modis);
  $("r-viirs").textContent = gap ? "-" : fmt(cell.viirs);
  $("r-harm").textContent = gap ? "-" : fmt(cell.harmonized);
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
  const points = !!data.index;
  const empty = $("r-empty");
  empty.hidden = !points || !!data.index[String(state.year)];
  empty.textContent = `No point file for ${state.year}`;
  $("ghost-note").hidden = !points || state.year < 2022;
  const parts = [];
  if (cell) {
    // The sentence above the numbers already says whether the week is unusual.
    parts.push(rangeText(cell));
    const ytd = yearToDate(active.calendar, state.year, state.week);
    if (active.analysis.sufficient && ytd.percentile !== null) {
      parts.push(
        `${state.year} to date: ${fmt(ytd.value)}, ${ytdComparison(ytd.percentile)}` +
          (ytd.missing > 0 ? ` (${ytd.missing} weeks without data left out of the comparison)` : "") +
          (seasonWraps() ? WRAPS_SUFFIX : ""),
      );
    }
    if (cell.factor === false) parts.push("no regional MODIS count this week");
  }
  const extra = $("r-extra");
  extra.textContent = parts.filter(Boolean).join(" · ");
  // The line is cut to one line; its title keeps the whole text.
  extra.title = extra.textContent;
  return month;
}

function updateHeadline() {
  const m = data.metrics;
  const w = m.weekly_total;
  $("h-model").textContent = fmt(w.mae_model);
  $("h-base").textContent = fmt(w.mae_baseline);
  $("h-err-label").textContent =
    `Mean weekly error, model vs baseline. Won ${w.years_won} of ${w.years} held-out years.`;
  // The pairing and event statistics exist only for a region whose `has` lists them.
  $("stat-pairing").hidden = !has("pairing");
  if (has("pairing")) {
    const [y0, y1] = m.pairing.headline_years;
    const rows = m.pairing.by_year.filter((r) => r.year >= y0 && r.year <= y1);
    const share = pooledShare(rows, "viirs_unmatched", "viirs_n");
    $("h-unmatched").textContent = share == null ? "-" : `${(share * 100).toFixed(1)}%`;
    $("h-unmatched-label").textContent =
      `of S-NPP detections had no Aqua match in the same overpass, ${y0}-${y1}${scopeSuffix()}`;
  }
  updateEvents();
}

function updateEvents() {
  $("stat-events").hidden = !has("events");
  if (!has("events")) return;
  const ev = data.metrics.events.find((e) => e.year === state.year);
  $("h-ev-modis").textContent = ev ? fmt(ev.modis) : "-";
  $("h-ev-viirs").textContent = ev ? fmt(ev.viirs) : "-";
  $("h-ev-label").textContent = `Fire events in ${state.year}, MODIS vs VIIRS${scopeSuffix()}`;
}

function syncControls() {
  // While Play or Hear moves the week, the readout is not announced at every step.
  $("readout").setAttribute("aria-live", state.playing || state.hearing ? "off" : "polite");
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
  if (yearChanged) {
    updateEvents();
    updateQualityText();
  }
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

function codesLine(cell, stat) {
  const codes = weekCodes(cell, stat, {
    isArea: active.calendar.meta?.aoi != null,
    sufficient: !!active.analysis.sufficient,
  }).map((c) => (c === "estimated" && cell.why ? `estimated: ${cell.why}` : c));
  return codes.length ? `<span class="mut">${codes.join(", ")}</span><br/>` : "";
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
     ${[rangeText(cell), unusualText(stat) ?? percentileText(stat)]
       .filter(Boolean)
       .map((t) => `<span class="mut">${t}</span><br/>`)
       .join("")}
     ${codesLine(cell, stat)}<span class="mut">${status}${cell.nrt ? ", provisional (NRT)" : ""}</span>`,
    ev,
  );
}

// "regions" shows the planet cover; "past" and "outlook" need an open region, and "outlook" a
// region with a forecast.
function setMode(mode) {
  if (mode === "regions") returnCover();
  if (mode === state.mode) return;
  if (mode !== "regions" && !state.region) return;
  if (mode === "outlook" && !(has("forecast") && forecast)) return;
  if (mode !== "past") {
    setPlaying(false);
    setHearing(false);
    setSelecting(false);
  }
  if (mode === "outlook") {
    state.month = weekDates(state.year, state.week).month;
    renderMonths();
  }
  const from = state.mode;
  state.mode = mode;
  app.dataset.mode = mode;
  playMotion(from);
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.mode === mode);
  });
  hideTip();
  const glide = from === null ? 0 : GLIDE_MS;
  if (mode === "regions") {
    document.title = COVER_TITLE;
    clearHash();
    frameGlobe(glide);
    showOverview();
    return;
  }
  document.title = regionTitle(state.region.name);
  resetCoverPointer();
  // The region's home view is fitted to the free part of the screen first, then the mode, so
  // the camera flies once, straight to the fitted view (from the planet or from the outlook).
  frameGlobe(glide);
  globe.setMode(mode);
  globe.setOverview(null);
  writeHash();
  if (mode === "outlook") globe.setMonth(state.month);
  else updateGlobe();
}

// Where the globe draws, from the page's own boxes. On the cover: the planet's size and place
// beside the text column. In a region: the camera's centre in the free area between the header,
// the two panels and the readout (the dock in the outlook), and in the past view the home zoom
// that fits the region's box there. Narrow screens give the globe its own box: no offset.
function isWide() {
  try {
    return window.matchMedia("(min-width: 901px)").matches;
  } catch {
    return true;
  }
}

function boxOf(el) {
  return {
    left: el.offsetLeft,
    top: el.offsetTop,
    right: el.offsetLeft + el.offsetWidth,
    bottom: el.offsetTop + el.offsetHeight,
  };
}

const shown = (selector) => [...document.querySelectorAll(selector)].find((el) => el.offsetParent !== null);

function regionPadding(width, height) {
  if (!isWide()) return ZERO;
  const left = shown(".side-left");
  const right = shown(".side-right");
  let bottom = height;
  if (state.mode === "past") {
    const r = boxOf($("readout"));
    bottom = r.bottom - Math.max(READOUT_ROOM, r.bottom - r.top);
  } else {
    const dock = shown(".dock");
    if (dock) bottom = dock.offsetTop;
  }
  return {
    left: left ? boxOf(left).right : 0,
    top: boxOf(document.querySelector(".top")).bottom,
    right: right ? width - boxOf(right).left : 0,
    bottom: Math.max(0, height - bottom),
  };
}

// The last frame applied (mode, size and offsets), so a resize that changes nothing is skipped.
let lastFrame = "";

// `keepCamera` (a window resize): only the offsets and the stored home view change; the camera
// stays where the user put it.
function frameGlobe(ms = 0, { keepCamera = false } = {}) {
  if (!globe) return;
  const el = $("globe");
  const width = el.clientWidth;
  const height = el.clientHeight;
  if (!width || !height) return;
  if (state.mode === "regions" || !state.region) {
    const cover = document.querySelector(".cover");
    const textRight = cover.offsetLeft + cover.offsetWidth - parseFloat(getComputedStyle(cover).paddingRight || "0");
    const f = coverFrame({ width, height, textRight, wide: isWide() });
    const key = `regions|${width}x${height}|${f.radius}|${JSON.stringify(f.padding)}`;
    if (keepCamera && key === lastFrame) return;
    lastFrame = key;
    globe.setPlanetRadius(f.radius);
    globe.setPadding(f.padding, ms);
    return;
  }
  const padding = regionPadding(width, height);
  const key = `${state.mode}|${state.region.id}|${width}x${height}|${JSON.stringify(padding)}`;
  if (keepCamera && key === lastFrame) return;
  lastFrame = key;
  globe.setPadding(padding, ms);
  if (state.mode !== "past") return;
  const b = state.region.bbox;
  const view = {
    longitude: (b[0] + b[2]) / 2,
    latitude: (b[1] + b[3]) / 2,
    zoom: fitZoom({ width, height, padding, bbox: b, margin: FRAME_MARGIN }),
  };
  globe.setRegion({ bbox: b, view }, { stay: keepCamera });
}

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => frameGlobe(0, { keepCamera: true }));
});

// The one authored motion. A pick makes the cover leave; entering a region from the cover moves
// the camera's centre to the free area while it flies and brings the header actions, panels,
// readout and dock in once. The classes only add motion: without them every element is in place
// and visible.
let leftAt = 0;
let leaveTimer = 0;
let motionTimer = 0;

function leaveCover() {
  if (state.mode !== "regions" || app.classList.contains("is-leaving")) return;
  clearTimeout(leaveTimer);
  leftAt = performance.now();
  app.classList.add("is-leaving");
}

function returnCover() {
  clearTimeout(leaveTimer);
  app.classList.remove("is-leaving");
}

function playMotion(from) {
  // The first view of the page does not move.
  if (from === null) return;
  // Only entering a region from the cover moves.
  if (from !== "regions") return;
  clearTimeout(motionTimer);
  app.classList.remove("is-arriving");
  if (!app.classList.contains("is-leaving")) {
    leftAt = performance.now();
    app.classList.add("is-leaving");
  }
  app.classList.add("is-arriving");
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(returnCover, Math.max(0, LEAVE_MS - (performance.now() - leftAt)));
  motionTimer = setTimeout(() => app.classList.remove("is-arriving"), ARRIVE_MS);
}

// While a region is open the hash names it; an incoming #outlook is kept while the outlook shows.
function writeHash() {
  if (!state.region || state.mode === "regions" || state.mode === null) return;
  if (state.mode === "outlook" && location.hash === "#outlook") return;
  const hash = formatHash(state.region.id, state.aoi) || `#region=${state.region.id}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function clearHash() {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function renderMonths() {
  document.querySelectorAll(".month").forEach((b) => {
    const on = Number(b.dataset.month) === state.month;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function setupForecast() {
  if (!forecast) return;
  const meta = forecast.meta;
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

  // The month buttons are built once, the first time a region with a forecast opens.
  const months = $("months");
  if (months.children.length) return;
  MONTH_NAMES.forEach((name, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "month";
    b.dataset.month = String(i + 1);
    b.setAttribute("aria-pressed", String(i + 1 === state.month));
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

// The grid of the open region: its box, its cell counts and the cube's cell size.
function cellsOf(a, b) {
  const { bbox, nx, ny } = state.region;
  return cellsFromLonLat(a, b, bbox, CELL_DEG, nx, ny);
}

function areaBounds(aoi) {
  return aoiBounds(aoi, state.region.bbox, CELL_DEG);
}

function criticalText(analysis) {
  const c = analysis.critical;
  if (!analysis.sufficient || !c) return "Not enough detections in this area";
  return (
    `Critical period: weeks ${c.start}-${c.end} (${monthDay(2001, c.start, false)} - ` +
    `${monthDay(2001, c.end, true)}), ${Math.round(c.share * 100)}% of a typical year` +
    (seasonWraps() ? WRAPS_SUFFIX : "")
  );
}

function stateBadge() {
  const st = regionState(data.metrics, state.region).state;
  if (st === "accepted") return null;
  const b = document.createElement("span");
  b.className = "badge";
  b.textContent = st === "baseline" ? "baseline" : "not validated";
  return b;
}

function updateQualityText() {
  const el = $("quality-text");
  const c = active.analysis.critical;
  if (!active.analysis.sufficient || !c) {
    el.textContent = "No critical period for this area: too few detections";
  } else {
    const counts = blindSpotCounts(active.calendar, active.analysis, {
      year: state.year,
      from: c.start,
      to: c.end,
    });
    const asOf = asOfWeek(active.calendar);
    const cut = !!asOf && asOf.year === state.year && asOf.week < c.end;
    el.textContent = qualitySentence(counts, state.year, cut);
  }
  const badge = stateBadge();
  if (badge) el.append(" ", badge);
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
  quality.setData(active.calendar, active.analysis);
  updateQualityText();
  updateAlert();
  globe.setAoi(b);
  writeHash();
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
  $("aoi-label").textContent = "Loading area data...";
  try {
    cube = await loadCube(regionBase(BASE, state.region));
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

// Bounds of what the views show: the selected area, or the open region's box.
function activeBounds() {
  return state.aoi ? areaBounds(state.aoi) : state.region.bbox;
}

function regionCsvName() {
  return `${state.region.id}_${csvFileName(activeBounds())}`;
}

function session() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function briefingInput() {
  const analysis = active.analysis;
  const c = analysis.sufficient ? analysis.critical : null;
  const ytd = yearToDate(active.calendar, state.year, state.week);
  const unusual = [];
  for (const w of active.calendar.weeks) {
    if (w.year !== state.year) continue;
    const s = analysis.stats.get(`${w.year}:${w.week}`);
    if (s?.unusual) unusual.push({ week: w.week, value: w.harmonized, percentile: s.percentile, record: !!s.record });
  }
  unusual.sort((a, b) => a.week - b.week);
  const asOf = data.calendar.meta.as_of;
  return {
    regionId: state.region.id,
    regionName: state.region.name,
    bounds: activeBounds(),
    isArea: !!state.aoi,
    year: state.year,
    asOf,
    state: regionState(data.metrics, state.region),
    critical: c,
    ytd: analysis.sufficient && ytd.percentile !== null ? ytd : null,
    unusual,
    alert: alertResults(),
    band: data.metrics.uncertainty.full,
    spots: {
      year: blindSpotCounts(active.calendar, analysis, { year: state.year }),
      critical: c ? blindSpotCounts(active.calendar, analysis, { year: state.year, from: c.start, to: c.end }) : null,
    },
  };
}

function wire() {
  const pSel = $("alert-p");
  for (const p of THRESHOLDS) pSel.add(new Option(`${Math.round(p * 100)}%`, String(p), false, p === state.p));
  pSel.addEventListener("change", () => {
    state.p = Number(pSel.value);
    updateAlert();
  });
  const overlay = $("briefing-overlay");
  const body = $("briefing-body");
  const opener = $("briefing");
  const closeBtn = $("briefing-close");
  const printBtn = $("briefing-print");
  const downloadBtn = $("briefing-download");
  const langBtns = [...$("briefing-lang").querySelectorAll("button")];
  let lang = readLang(session());
  let html = "";
  const onOverlayKey = (e) => {
    if (overlay.hidden) return;
    if (e.key === "Escape") closeOverlay();
    // While the briefing is open the keyboard belongs to it (no Space-to-play behind it).
    e.stopImmediatePropagation();
  };
  const renderOverlay = () => {
    const t = TEXT[lang];
    for (const b of langBtns) {
      const on = b.dataset.lang === lang;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    $("briefing-title").textContent = t.title;
    printBtn.textContent = t.ui_print;
    downloadBtn.textContent = t.ui_download;
    closeBtn.textContent = t.ui_close;
    html = renderBriefing(briefingInput(), lang);
    const frame = document.createElement("iframe");
    frame.title = t.title;
    frame.addEventListener("load", () => frame.contentWindow?.addEventListener("keydown", onOverlayKey));
    frame.srcdoc = html;
    body.replaceChildren(frame);
  };
  for (const b of langBtns)
    b.addEventListener("click", () => {
      lang = b.dataset.lang;
      writeLang(session(), lang);
      renderOverlay();
    });
  printBtn.addEventListener("click", () => body.querySelector("iframe")?.contentWindow?.print());
  downloadBtn.addEventListener("click", () =>
    downloadHtml(briefingFileName(state.region.id, state.year, lang), html),
  );
  opener.addEventListener("click", () => {
    overlay.hidden = false;
    $("app").inert = true;
    renderOverlay();
    closeBtn.focus();
  });
  const closeOverlay = () => {
    overlay.hidden = true;
    $("app").inert = false;
    body.replaceChildren();
    opener.focus();
  };
  closeBtn.addEventListener("click", closeOverlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });
  window.addEventListener("keydown", onOverlayKey);
  $("aoi-select").addEventListener("click", () => {
    if (state.mode === "past") setSelecting(!state.selecting);
  });
  $("aoi-clear").addEventListener("click", () => setAoi(null));
  $("csv").addEventListener("click", () => {
    downloadCsv(regionCsvName(), toCsv(active.calendar, active.analysis.stats));
  });
  const yearInput = $("year");
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
    t.addEventListener("click", () => {
      navSeq += 1;
      setMode(t.dataset.mode);
    });
  });
  document.querySelectorAll("#dock-past .seg button").forEach((b) => {
    b.addEventListener("click", () => setDockView(b.dataset.view));
  });
  window.addEventListener("keydown", (e) => {
    const control = e.target instanceof Element && e.target.closest("input, button, select, textarea, a, [contenteditable]");
    if (control || state.mode !== "past") return;
    if (e.code === "Space") {
      e.preventDefault();
      setPlaying(!state.playing);
    }
  });
}

function setDockView(view) {
  $("dock-past").dataset.view = view;
  document.querySelectorAll("#dock-past .seg button").forEach((b) => {
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

// ---- regions: switching, cover and start ----

// The only function that changes the region. Resolves to true when `id` is open at the end.
async function selectRegion(id, aoi = null) {
  const row = regions.find((r) => r.id === id && r.status === "ok");
  if (!row) return false;
  // At once, before any await: nothing of the old region keeps playing, and a late area answer
  // of the old region is dropped by the area guard.
  setPlaying(false);
  setHearing(false);
  if (state.selecting) setSelecting(false);
  aoiSeq += 1;
  if (state.aoi) clearArea();
  let got;
  try {
    got = await loadRegion(row);
  } catch (err) {
    showRowError(id, err.message);
    return false;
  }
  if (!got) return false;
  const previous = state.region ? { region: state.region, data, year: state.year, week: state.week } : null;
  rowErrors.delete(id);
  // Files that load but cannot be shown: the region that was open stays, whole.
  const shown = (show) => {
    try {
      show();
      return true;
    } catch (err) {
      restoreRegion(previous);
      showRowError(id, `Could not open ${row.name}: ${err.message}`);
      return false;
    }
  };
  if (!shown(() => applyRegion(got.region, got.data))) return false;
  if (aoi) await setAoi(aoi);
  if (state.region !== row) return false;
  return shown(() => select(state.year, peakWeek(active.calendar, state.year)));
}

function showRowError(id, message) {
  rowErrors.set(id, message);
  renderCover();
}

// Puts back the region that was open before a failed switch, or no region at all.
function restoreRegion(previous) {
  if (previous) {
    state.year = previous.year;
    state.week = previous.week;
    try {
      applyRegion(previous.region, previous.data);
      select(previous.year, previous.week);
    } catch (err) {
      console.warn("Could not restore the previous region:", err);
    }
    return;
  }
  state.region = null;
  data = null;
  forecast = null;
  globe.setCells(null);
  globe.setPoints(null, [0, 0], state.show);
  updateTabs();
  renderCover();
}

// Drops the selected area at once and shows the whole region again.
function clearArea() {
  $("aoi-note").hidden = true;
  showActive(null, data.calendar);
}

function applyRegion(row, loaded) {
  state.region = row;
  data = loaded;
  forecast = loaded.forecast;
  // Nothing of the previous region's cells stays while this region's cube loads.
  cellsKey = "";
  globe.setCells(null);
  if (state.mode !== "regions") document.title = regionTitle(row.name);
  $("region-heading").textContent = regionHeading(row.name);
  globe.setRegion({ bbox: row.bbox, view: regionView(row.bbox) });
  years = regionYears(loaded);
  if (!years.includes(state.year)) state.year = years[years.length - 1];
  $("year").max = String(years.length - 1);
  ensureViews(loaded.calendar);
  showRegionLayers();
  setupForecast();
  updateTabs();
  showActive(null, loaded.calendar);
  renderCover();
  // A region put back while its view shows is framed again.
  if (state.mode === "past") frameGlobe(0);
}

// The points index years for a region with points, else the calendar's years.
function regionYears(loaded) {
  const fromPoints = loaded.index ? Object.keys(loaded.index).map(Number) : [];
  const all = fromPoints.length ? fromPoints : [...new Set(loaded.calendar.weeks.map((w) => w.year))];
  return all.sort((a, b) => a - b);
}

function peakWeek(calendar, year) {
  const inYear = calendar.weeks.filter((w) => w.year === year && w.harmonized != null);
  const peak = inYear.reduce((a, w) => (a && a.harmonized >= w.harmonized ? a : w), null);
  return peak ? peak.week : 26;
}

// The heatmap, yearly chart and quality view are created with the first region's calendar.
function ensureViews(calendar) {
  if (heat) return;
  heat = createHeatmap($("cal"), calendar, {
    onSelect: (y, w) => {
      if (state.hearing) setHearing(false);
      select(y, w);
    },
    onHover: heatTip,
  });
  yearly = createYearly($("yr"), yearlyTotals(calendar), {
    onSelect: (y) => {
      if (state.hearing) setHearing(false);
      select(y, state.week);
    },
  });
  quality = createQuality($("quality"));
}

// Points regions show the detections and their chips; the others show detections per cell.
function showRegionLayers() {
  const points = !!data.index;
  for (const id of ["layer-chips", "legend", "cum-switch"]) $(id).hidden = !points;
  $("cells-label").hidden = points;
  $("cells-ramp").hidden = points;
  if (!points) globe.setPoints(null, [0, 0], state.show);
  const st = regionState(data.metrics, state.region).state;
  const badge = $("region-badge");
  badge.className = `badge state-${st}`;
  badge.textContent = STATE_LABEL[st] ?? st;
  $("state-note").textContent = STATE_NOTE[st] ?? "";
}

function updateTabs() {
  $("tab-past").disabled = !state.region;
  const outlook = $("tab-outlook");
  const fc = has("forecast") && !!forecast;
  outlook.hidden = !fc;
  outlook.disabled = !fc;
}

// A user's choice of where to go; a later choice wins over an earlier one still loading.
let navSeq = 0;

// `fromKeyboard`: the row was picked with the keyboard, so the focus moves to the region's
// heading instead of being lost with the hidden row.
async function openRegion(id, { fromKeyboard = false } = {}) {
  const nav = ++navSeq;
  leaveCover();
  const arrive = () => {
    setMode("past");
    if (fromKeyboard && state.mode === "past") $("region-heading").focus({ preventScroll: true });
  };
  if (state.region?.id === id) {
    // The open region: no reload, the area stays; a switch still loading is dropped.
    loadRegion.cancel();
    arrive();
    return;
  }
  const opened = await selectRegion(id);
  if (nav !== navSeq) return;
  // A region that could not open leaves the cover where it was, with the row's error.
  if (opened) arrive();
  else if (state.mode === "regions") returnCover();
}

// The cover's rows: ranking rows in order, none removed.
function coverLine(row) {
  const err = rowErrors.get(row.id);
  if (err) return { text: err, warn: true };
  if (row.ytd && row.ytd.percentile !== null) {
    const n = row.ytd.missing;
    return {
      text:
        `${row.asOf.year} to date ${ytdComparison(row.ytd.percentile)}` +
        (n > 0 ? `, ${n} week${n === 1 ? "" : "s"} missing` : "") +
        (row.seasonWraps ? WRAPS_SUFFIX : ""),
    };
  }
  if (row.note) return { text: row.note, warn: row.kind === "load_error" };
  return { text: row.kind === "insufficient" ? "Too few detections to compare the year" : "No year-to-date comparison" };
}

function coverMeta(row) {
  const asOf = regions.find((r) => r.id === row.id)?.as_of;
  if (!asOf) return null;
  const c = row.critical;
  return `${c ? `Critical period weeks ${c.start}-${c.end} · ` : ""}data as of ${asOfDate(asOf)}`;
}

function span(className, text) {
  const s = document.createElement("span");
  s.className = className;
  if (text != null) s.textContent = text;
  return s;
}

function coverItem(row) {
  const li = document.createElement("li");
  li.dataset.id = row.id;
  li.className = `region kind-${row.kind}`;
  li.classList.toggle("is-active", row.id === state.region?.id);
  li.classList.toggle("is-disabled", !row.selectable);
  const b = document.createElement("button");
  b.type = "button";
  if (!row.selectable) b.setAttribute("aria-disabled", "true");
  if (row.id === state.region?.id) b.setAttribute("aria-current", "true");
  const head = span("r-head");
  head.append(span("r-name", row.name));
  if (row.state) head.append(span(`badge state-${row.state}`, STATE_LABEL[row.state] ?? row.state));
  const line = coverLine(row);
  b.append(head, span(line.warn ? "r-line warn" : "r-line", line.text));
  const meta = coverMeta(row);
  if (meta) b.append(span("r-meta", meta));
  // A click from Enter or Space has no pointer position (detail 0).
  b.addEventListener("click", (e) => {
    if (row.selectable) openRegion(row.id, { fromKeyboard: e.detail === 0 });
  });
  b.addEventListener("mouseenter", () => pointRow("hovered", row.id));
  b.addEventListener("mouseleave", () => unpointRow("hovered", row.id));
  b.addEventListener("focus", () => pointRow("focused", row.id));
  b.addEventListener("blur", () => {
    if (!coverPointer.rerendering) unpointRow("focused", row.id);
  });
  li.append(b);
  return li;
}

// What lights the cover: the hovered row, else the focused row, else the box under the pointer
// on the globe. Only a row (hovered or focused) drives the globe.
const coverPointer = { hovered: null, focused: null, box: null, rerendering: false };

function pointRow(kind, id) {
  coverPointer[kind] = id;
  refreshHighlight();
}

function unpointRow(kind, id) {
  if (coverPointer[kind] === id) coverPointer[kind] = null;
  refreshHighlight();
}

function refreshHighlight() {
  const row = coverPointer.hovered ?? coverPointer.focused;
  globe.highlight(row ?? coverPointer.box);
  globe.follow(row);
  markHot(coverPointer.box);
}

function resetCoverPointer() {
  Object.assign(coverPointer, { hovered: null, focused: null, box: null });
  markHot(null);
}

// Rebuilds the rows; the focused row keeps the keyboard focus and every highlight stays.
function renderCover() {
  const list = $("ranking");
  const focusedLi = list.contains(document.activeElement) ? document.activeElement.closest("li") : null;
  const focusedId = focusedLi?.dataset.id ?? null;
  coverPointer.rerendering = true;
  if (!ranking) {
    const li = document.createElement("li");
    li.className = rankingError ? "regions-status warn" : "regions-status";
    li.textContent = rankingError ? `Could not rank the regions: ${rankingError}` : "Loading regions...";
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...ranking.map(coverItem));
    const again = [...list.children].find((li) => li.dataset.id === focusedId);
    if (again) again.querySelector("button").focus({ preventScroll: true });
  }
  coverPointer.rerendering = false;
  markHot(coverPointer.box);
}

// Marks the row whose box the pointer is over on the globe.
function markHot(id) {
  for (const li of $("ranking").children) li.classList.toggle("is-hot", li.dataset.id === id);
}

// Boxes from regions.json; selectable once the ranking says so.
function overviewRows() {
  const selectable = new Set((ranking ?? []).filter((r) => r.selectable).map((r) => r.id));
  return regions.map((r) => ({ id: r.id, name: r.name, bbox: r.bbox, selectable: selectable.has(r.id) }));
}

function showOverview() {
  globe.setOverview(overviewRows(), {
    onPick: openRegion,
    onHover: (id) => {
      coverPointer.box = id;
      refreshHighlight();
    },
  });
  refreshHighlight();
}

async function loadRanking() {
  try {
    ranking = rankRegions(await loadCalendars(regions, BASE));
  } catch (err) {
    rankingError = err.message;
  }
  renderCover();
  if (state.mode === "regions") showOverview();
}

function fatal(message) {
  const el = $("fatal");
  el.hidden = false;
  el.textContent = message;
}

async function start() {
  try {
    regions = await loadRegions(BASE);
  } catch (err) {
    fatal(err.message);
    return;
  }
  if (!Array.isArray(regions) || !regions.length) {
    fatal("regions.json lists no regions");
    return;
  }
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
  wire();
  // The cell layer's key: the same fire ramp the cells use, low to high.
  const ramp = [0, 0.25, 0.5, 0.75, 1].map((s) => fireColor(CELL_RAMP_FROM + (1 - CELL_RAMP_FROM) * s));
  $("cells-ramp-bar").style.background = `linear-gradient(to right, ${ramp.join(", ")})`;
  renderCover();
  loadRanking();
  // An empty hash opens the cover; any other hash opens a region (the Pantanal by default).
  if (!location.hash) {
    setMode("regions");
    return;
  }
  const wantsOutlook = location.hash === "#outlook";
  const { regionId, aoi } = parseHash(location.hash, regions);
  // A tab or row chosen while this region loads wins over the start.
  const nav = navSeq;
  const opened = await selectRegion(regionId, aoi);
  if (nav !== navSeq) return;
  if (!opened) {
    if (!state.region) setMode("regions");
    return;
  }
  setMode(wantsOutlook && has("forecast") && forecast ? "outlook" : "past");
}

start();
