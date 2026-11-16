import { OUTCOMES } from "./alert.js";
import { REF_FIRST, REF_LAST } from "./stats.js";
export const LANGS = ["en", "pt-BR"];
export const LANG_KEY = "mvh.briefing.lang";
export const MAX_UNUSUAL_ROWS = 8;
export const MAX_CELL_ROWS = 5;

const ACK =
  "We acknowledge the use of data and imagery from LANCE FIRMS operated by NASA's Earth Science Data and Information System (ESDIS) with funding provided by NASA Headquarters.";

export const TEXT = {
  en: {
    title: "Fire briefing",
    bounds: "Bounds (lon/lat)",
    kind_region: "Region",
    kind_area: "Area of interest",
    as_of: "Data as of",
    year: "Year",
    h_state: "Acceptance state",
    state_accepted: "Accepted",
    state_baseline: "Baseline in use",
    state_not_validated: "Not validated",
    method_label: "Method",
    method_model: "model",
    method_baseline: "baseline",
    state_years: "Years scored: {a}; years the model won: {b}.",
    state_mae: "Mean absolute error, model: {a}; baseline: {b}.",
    h_season: "Season",
    critical: "Critical period: weeks {a} to {b}, holding {c} of the year's detections.",
    critical_none: "No critical period could be set for this region.",
    ytd: "Year to date: {a} detections, at percentile {b} of the reference years.",
    ytd_missing: "Weeks missing in the year so far: {a}.",
    ytd_none: "No year-to-date reading is available.",
    band: "Conversion band (10th to 90th percentile): {a} to {b}.",
    h_quality: "Data quality",
    q_scope_year: "Year",
    q_scope_critical: "Critical period",
    q_total: "Weeks counted",
    q_standard: "Standard",
    q_gap: "Gap",
    q_estimated: "Estimated",
    q_nrt: "Near real time",
    q_no_factor: "No area factor",
    q_no_percentile: "No percentile",
    h_unusual: "Unusual weeks",
    th_week: "Week",
    th_value: "Detections",
    th_percentile: "Percentile",
    th_note: "Note",
    record: "record",
    unusual_none: "No unusual weeks.",
    more: "and {n} more",
    h_alert: "Alert",
    h_top_cells: "Top cells",
    h_limits: "Limits",
    limit_counts: "Counts are detections, not burned area.",
    limit_estimated: "Estimated weeks are model conversions, not observations.",
    limit_factor: "The area factor is regional, not local.",
    limit_retro: "The reading is retrospective and is not a forecast.",
    no_alert_season_wraps: "No alert for this region: its fire season crosses the year end, so the alert cannot be tested here",
    no_alert_insufficient: "No alert: too few detections in this area to test it",
    alert_since: "Alert since week",
    alert_none: "No alert so far",
    alert_incomplete: "Incomplete: gap weeks inside the armed window:",
    alert_not_armed: "Not armed yet: arms at week",
    alert_threshold: "Threshold: percentile {a}.",
    alert_test: "Retrospective test at this threshold, {a} to {b}:",
    o_hit: "hits",
    o_late: "late",
    o_miss: "missed",
    o_false_alarm: "false alarms",
    o_quiet: "quiet",
    o_incomplete: "incomplete",
    alert_lead: "Median lead of the hits, in weeks: {a}.",
    limit_a_retro: "Retrospective. The threshold is chosen on the same seasons it is scored on.",
    limit_a_critical: "The critical period is computed from all years, including the tested one.",
    limit_a_model: "Seasons before 2012 are model estimates.",
    limit_a_judgment: "The 8 armed weeks and the 0.75 high-season percentile are judgment values.",
    f_ytd: "Detections, year to date",
    f_percentile: "Percentile of the reference years",
    f_critical: "Critical period, weeks",
    f_to: "to",
    f_share: "Of the year's detections",
    ui_print: "Print or save as PDF",
    ui_download: "Download HTML",
    ui_close: "Close",
    ack: ACK,
  },
  "pt-BR": {
    title: "Briefing de fogo",
    bounds: "Limites (lon/lat)",
    kind_region: "Região",
    kind_area: "Área de interesse",
    as_of: "Dados até",
    year: "Ano",
    h_state: "Estado de aceitação",
    state_accepted: "Aceito",
    state_baseline: "Linha de base em uso",
    state_not_validated: "Não validado",
    method_label: "Método",
    method_model: "modelo",
    method_baseline: "linha de base",
    state_years: "Anos avaliados: {a}; anos em que o modelo venceu: {b}.",
    state_mae: "Erro absoluto médio, modelo: {a}; linha de base: {b}.",
    h_season: "Temporada",
    critical: "Período crítico: semanas {a} a {b}, com {c} das detecções do ano.",
    critical_none: "Não foi possível definir um período crítico para esta região.",
    ytd: "Acumulado do ano: {a} detecções, no percentil {b} dos anos de referência.",
    ytd_missing: "Semanas sem dados no ano até agora: {a}.",
    ytd_none: "Não há leitura do acumulado do ano.",
    band: "Faixa de conversão (percentil 10 a 90): {a} a {b}.",
    h_quality: "Qualidade dos dados",
    q_scope_year: "Ano",
    q_scope_critical: "Período crítico",
    q_total: "Semanas contadas",
    q_standard: "Padrão",
    q_gap: "Lacuna",
    q_estimated: "Estimada",
    q_nrt: "Tempo quase real",
    q_no_factor: "Sem fator de área",
    q_no_percentile: "Sem percentil",
    h_unusual: "Semanas incomuns",
    th_week: "Semana",
    th_value: "Detecções",
    th_percentile: "Percentil",
    th_note: "Nota",
    record: "recorde",
    unusual_none: "Nenhuma semana incomum.",
    more: "e mais {n}",
    h_alert: "Alerta",
    h_top_cells: "Células principais",
    h_limits: "Limites",
    limit_counts: "As contagens são detecções, não área queimada.",
    limit_estimated: "Semanas estimadas são conversões do modelo, não observações.",
    limit_factor: "O fator de área é regional, não local.",
    limit_retro: "A leitura é retrospectiva e não é uma previsão.",
    no_alert_season_wraps: "Sem alerta para esta região: a temporada de fogo cruza a virada do ano, então o alerta não pode ser testado aqui",
    no_alert_insufficient: "Sem alerta: poucas detecções nesta área para testá-lo",
    alert_since: "Alerta desde a semana",
    alert_none: "Sem alerta até agora",
    alert_incomplete: "Incompleto: semanas sem dados na janela armada:",
    alert_not_armed: "Ainda não armado: arma na semana",
    alert_threshold: "Limiar: percentil {a}.",
    alert_test: "Teste retrospectivo neste limiar, {a} a {b}:",
    o_hit: "acertos",
    o_late: "tardios",
    o_miss: "perdidos",
    o_false_alarm: "falsos alarmes",
    o_quiet: "calmos",
    o_incomplete: "incompletos",
    alert_lead: "Antecedência mediana dos acertos, em semanas: {a}.",
    limit_a_retro: "Retrospectivo. O limiar é escolhido nas mesmas temporadas em que é avaliado.",
    limit_a_critical: "O período crítico é calculado com todos os anos, inclusive o testado.",
    limit_a_model: "Temporadas antes de 2012 são estimativas do modelo.",
    limit_a_judgment: "As 8 semanas armadas e o percentil 0.75 de temporada alta são valores de julgamento.",
    f_ytd: "Detecções no ano até agora",
    f_percentile: "Percentil nos anos de referência",
    f_critical: "Período crítico, semanas",
    f_to: "a",
    f_share: "Das detecções do ano",
    ui_print: "Imprimir ou salvar em PDF",
    ui_download: "Baixar HTML",
    ui_close: "Fechar",
    ack: ACK,
  },
};

export function readLang(storage) {
  try {
    return storage?.getItem(LANG_KEY) === "pt-BR" ? "pt-BR" : "en";
  } catch {
    return "en";
  }
}

export function writeLang(storage, lang) {
  try {
    storage?.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable: the choice is simply not kept */
  }
}

export function briefingFileName(regionId, year, lang) {
  return `briefing_${regionId}_${year}_${lang}.html`;
}

export function downloadHtml(name, html) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const NF = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const num = (v) => (v == null ? "-" : NF.format(v));
const pct = (p) => (p == null ? "-" : `${Math.round(p * 100)}%`);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const fill = (s, vals) => s.replace(/\{(\w+)\}/g, (_, k) => `<b>${esc(vals[k])}</b>`);
const block = (name, title, body) =>
  `<section class="block" data-block="${name}"><h2>${title}</h2>${body}</section>`;
const notes = (items) => `<ul class="notes">${items.map((s) => `<li>${s}</li>`).join("")}</ul>`;

function alertBody(alert, t) {
  const { current, test } = alert;
  if (!current.ran) return `<p class="lead">${t["no_alert_" + current.reason] ?? t.no_alert_insufficient}</p>`;
  if (!test.ran) return `<p class="lead">${t["no_alert_" + test.reason] ?? t.no_alert_insufficient}</p>`;
  let st;
  if (current.state === "alert") st = `${t.alert_since} <b>${current.alertWeek}</b>`;
  else if (current.state === "no_alert") st = t.alert_none;
  else if (current.state === "incomplete") st = `${t.alert_incomplete} <b>${current.gaps}</b>`;
  else st = `${t.alert_not_armed} <b>${current.armed.start}</b>`;
  const c = test.counts;
  return (
    `<p class="lead">${st}</p>` +
    `<p>${fill(t.alert_threshold, { a: Math.round(test.p * 100) })} ${fill(t.alert_test, { a: REF_FIRST, b: REF_LAST })}</p>` +
    `<ul class="outcomes">` +
    OUTCOMES.map((o) => `<li><i class="mark ${o}"></i><b>${num(c[o])}</b> ${t["o_" + o]}</li>`).join("") +
    `</ul>` +
    (test.medianLead !== null ? `<p>${fill(t.alert_lead, { a: num(test.medianLead) })}</p>` : "") +
    notes([t.limit_a_retro, t.limit_a_critical, t.limit_a_model, t.limit_a_judgment])
  );
}

// The app's tokens (web/src/style.css :root); the test keeps them equal.
export const TOKENS = {
  "--bg": "#06070b",
  "--line": "rgba(255, 255, 255, 0.08)",
  "--text": "#ebe8e2",
  "--muted": "#8d919c",
  "--modis": "#4cc3ff",
  "--viirs": "#ff9632",
  "--fire": "#ffb347",
  "--font": 'ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "--serif": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
};

// Quality segments, in drawing order, with the app's swatch for each.
const SEGMENTS = ["standard", "estimated", "nrt", "gap"];

const STYLE = `@page { size: A4; margin: 12mm; }
:root { ${Object.entries(TOKENS).map(([k, v]) => `${k}: ${v};`).join(" ")}
  --warn: var(--fire); color-scheme: dark; }
* { box-sizing: border-box; }
html { background: var(--bg); scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.18) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border: 3px solid var(--bg); border-radius: 999px; }
::selection { background: rgba(255, 179, 71, 0.32); color: var(--text); }
body { margin: 0 auto; max-width: 190mm; padding: 36px 32px 44px; background: var(--bg); color: var(--text);
  font: 13px/1.5 var(--font); font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
p { margin: 0 0 6px; max-width: 70ch; }
b { font-weight: 600; }
.block { break-inside: avoid; margin: 32px 0 0; }
.head { margin: 0; }
h1 { margin: 0; font: 400 42px/1.05 var(--serif); letter-spacing: -0.01em; text-wrap: balance; }
h2 { margin: 0 0 12px; padding-top: 12px; border-top: 1px solid var(--line);
  font: 600 10.5px/1 var(--font); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; }
.meta { margin: 12px 0 0; }
.meta span + span::before { content: "·"; margin: 0 9px; color: var(--muted); }
.bounds { margin: 4px 0 0; color: var(--muted); font-size: 11.5px; }
.badge { display: inline-block; padding: 2px 8px; border: 1px solid currentColor; border-radius: 999px;
  font-size: 10.5px; font-weight: 600; line-height: 1.4; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; color: var(--text); }
.badge.baseline, .badge.record { color: var(--warn); }
.badge.not_validated { color: var(--muted); }
.figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px 28px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); }
.fig b { display: flex; align-items: baseline; gap: 8px; font: 300 32px/1 var(--serif); letter-spacing: -0.01em; }
.fig em { font: 300 20px/1 var(--serif); font-style: normal; color: var(--muted); }
.fig small, .figs .none { display: block; margin: 8px 0 0; color: var(--muted); font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; }
.figs .none { grid-column: span 2; max-width: 32ch; margin: 0; align-self: center; font-size: 11.5px; letter-spacing: 0; text-transform: none; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 40px; }
.qbar { display: grid; grid-template-columns: 8em minmax(0, 1fr); align-items: center; gap: 12px; margin: 0 0 8px; color: var(--muted); font-size: 11.5px; }
.track { display: flex; gap: 1px; height: 10px; }
.track i { display: block; min-width: 2px; border-radius: 1px; }
.key { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 10px 0 14px; color: var(--muted); font-size: 11.5px; }
.sw { display: inline-block; width: 14px; height: 9px; margin-right: 6px; border-radius: 2px; vertical-align: -1px; }
.q-standard { background: #ff9a2e; }
.q-estimated { background: repeating-linear-gradient(135deg, #ff9a2e 0 2px, #1a1a22 2px 4px); }
.q-nrt { background: #9fb4ff; }
.q-gap { background: #262a33; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { padding: 0 0 6px; text-align: left; color: var(--muted); font-size: 10.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
td { padding: 5px 0; border-top: 1px solid var(--line); }
th + th, td + td { padding-left: 16px; }
.n { text-align: right; }
[data-block="unusual"] table { max-width: 480px; }
.more { margin: 8px 0 0; color: var(--muted); font-size: 11.5px; }
.lead { margin: 0 0 10px; font: 400 18px/1.35 var(--serif); }
.lead b { font-weight: 400; color: var(--warn); }
.outcomes { display: flex; flex-wrap: wrap; gap: 10px 24px; margin: 12px 0; padding: 0; list-style: none; color: var(--muted); }
.outcomes li { display: flex; align-items: center; gap: 8px; }
.outcomes b { font: 300 18px/1 var(--serif); color: var(--text); }
.mark { display: inline-block; width: 10px; height: 16px; border-radius: 2px; background: #262a33; }
.mark.hit { background: #5fd38d; }
.mark.late { background: #ffb347; }
.mark.miss { background: #ff5a5a; }
.mark.false_alarm { background: #c77dff; }
.mark.quiet { background: #3a4150; }
.mark.incomplete { background: repeating-linear-gradient(135deg, #3a4150 0 2px, #1a1a22 2px 4px); }
.notes { margin: 10px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: 11.5px; }
h2 + .notes { margin-top: 0; }
.notes li { max-width: 80ch; margin: 0 0 3px; }
.ack { max-width: 80ch; margin: 28px 0 0; color: var(--muted); font-size: 11.5px; }
@media (max-width: 560px) {
  body { padding: 24px 16px 36px; }
  h1 { font-size: 34px; }
  .cols { grid-template-columns: minmax(0, 1fr); }
  .figs { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 28px; }
}
@media print {
  :root { --bg: #fff; --text: #111; --muted: #555; --line: #c4c4c4; --warn: #111; color-scheme: light; }
  html, body { background: #fff; }
  body { max-width: none; padding: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .block:not(.head) { margin-top: 22px; }
  .q-standard { background: #c8670f; }
  .q-estimated { background: repeating-linear-gradient(135deg, #c8670f 0 2px, #fff 2px 4px); }
  .track i, .sw, .mark { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.28); }
}`;

function figures(input, t) {
  const { critical, ytd } = input;
  const fig = (name, value, label) =>
    value == null ? "" : `<div class="fig" data-fig="${name}"><b>${value}</b><small>${label}</small></div>`;
  const none = (s) => `<p class="none">${s}</p>`;
  const row = [];
  if (ytd) {
    row.push(fig("ytd", ytd.value == null ? null : num(Math.round(ytd.value)), t.f_ytd));
    row.push(fig("percentile", ytd.percentile == null ? null : pct(ytd.percentile), t.f_percentile));
  } else row.push(none(t.ytd_none));
  if (critical) {
    row.push(fig("critical", `${critical.start}<em>${t.f_to}</em>${critical.end}`, t.f_critical));
    row.push(fig("share", critical.share == null ? null : pct(critical.share), t.f_share));
  } else row.push(none(t.critical_none));
  return `<section class="block figs" data-block="figures">${row.join("")}</section>`;
}

function qualityBars(spots, t) {
  const scopes = [
    ["year", t.q_scope_year, spots.year],
    ["critical", t.q_scope_critical, spots.critical],
  ];
  const bars = scopes
    .map(([name, label, n]) => {
      const sum = n ? SEGMENTS.reduce((s, k) => s + (n[k] ?? 0), 0) : 0;
      if (!n || !(n.total > 0) || sum === 0) return "";
      const segs = SEGMENTS.filter((k) => n[k] > 0)
        .map((k) => `<i class="q-${k}" style="width:${((n[k] / sum) * 100).toFixed(2)}%"></i>`)
        .join("");
      return `<div class="qbar" data-bar="${name}"><span>${label}</span><div class="track">${segs}</div></div>`;
    })
    .join("");
  if (!bars) return "";
  const key = SEGMENTS.map((k) => `<span><i class="sw q-${k}"></i>${t["q_" + k]}</span>`).join("");
  return `${bars}<p class="key">${key}</p>`;
}

export function renderBriefing(input, lang = "en") {
  const L = TEXT[lang] ? lang : "en";
  const t = TEXT[L];
  const { state, critical, ytd, band, spots } = input;
  const out = [];

  const [x0, y0, x1, y1] = input.bounds;
  const stateName = t["state_" + state.state] ?? esc(state.state);
  out.push(
    `<header class="block head" data-block="header">` +
      `<div class="title"><h1>${esc(input.regionName)}</h1><span class="badge ${esc(state.state)}">${stateName}</span></div>` +
      `<p class="meta"><span>${esc(t.title)}</span><span>${input.isArea ? t.kind_area : t.kind_region}</span>` +
      `<span>${t.year} <b>${input.year}</b></span><span>${t.as_of} <b>${esc(input.asOf)}</b></span></p>` +
      `<p class="bounds">${t.bounds}: ${num(x0)}, ${num(y0)}, ${num(x1)}, ${num(y1)}</p>` +
      `</header>`,
  );

  out.push(figures(input, t));

  // Season: the "none" sentences already stand in the figures row.
  let season = critical ? `<p>${fill(t.critical, { a: critical.start, b: critical.end, c: pct(critical.share) })}</p>` : "";
  if (ytd) {
    season += `<p>${fill(t.ytd, { a: num(Math.round(ytd.value)), b: pct(ytd.percentile) })}</p>`;
    season += `<p>${fill(t.ytd_missing, { a: num(ytd.missing) })}</p>`;
  }
  season += `<p>${fill(t.band, { a: num(band.q10), b: num(band.q90) })}</p>`;

  const stateBody =
    `<p><b>${stateName}</b> &middot; ${t.method_label}: ${t["method_" + state.method] ?? esc(state.method ?? "-")}</p>` +
    `<p>${fill(t.state_years, { a: num(state.yearsScored), b: num(state.yearsWon) })}</p>` +
    `<p>${fill(t.state_mae, { a: num(state.maeModel), b: num(state.maeBaseline) })}</p>`;

  const kinds = ["total", "standard", "gap", "estimated", "nrt", "no_factor", "no_percentile"];
  const crit = spots.critical;
  const quality =
    qualityBars(spots, t) +
    `<table><tr><th></th><th class="n">${t.q_scope_year}</th>${crit ? `<th class="n">${t.q_scope_critical}</th>` : ""}</tr>` +
    kinds
      .map(
        (k) =>
          `<tr><td>${t["q_" + k]}</td><td class="n">${num(spots.year[k])}</td>${crit ? `<td class="n">${num(crit[k])}</td>` : ""}</tr>`,
      )
      .join("") +
    `</table>`;

  out.push(
    `<div class="cols"><div>${block("season", t.h_season, season)}${block("state", t.h_state, stateBody)}</div>` +
      `<div>${block("quality", t.h_quality, quality)}</div></div>`,
  );

  const rows = input.unusual.slice(0, MAX_UNUSUAL_ROWS);
  const rest = input.unusual.length - rows.length;
  out.push(
    block(
      "unusual",
      t.h_unusual,
      input.unusual.length
        ? `<table><tr><th class="n">${t.th_week}</th><th class="n">${t.th_value}</th><th class="n">${t.th_percentile}</th><th>${t.th_note}</th></tr>` +
            rows
              .map(
                (r) =>
                  `<tr data-row="unusual"><td class="n">${r.week}</td><td class="n">${num(r.value)}</td><td class="n">${pct(r.percentile)}</td>` +
                  `<td>${r.record ? `<span class="badge record">${t.record}</span>` : ""}</td></tr>`,
              )
              .join("") +
            `</table>` +
            (rest > 0 ? `<p class="more">${t.more.replace("{n}", num(rest))}</p>` : "")
        : `<p>${t.unusual_none}</p>`,
    ),
  );

  // Slots for F2 and F3: their shapes are defined later; written only when present.
  const slot = (v) => `<p>${esc(JSON.stringify(v))}</p>`;
  if (input.alert !== undefined) out.push(block("alert", t.h_alert, alertBody(input.alert, t)));
  if (input.topCells !== undefined) {
    const cells = Array.isArray(input.topCells) ? input.topCells.slice(0, MAX_CELL_ROWS) : input.topCells;
    out.push(block("top-cells", t.h_top_cells, slot(cells)));
  }

  out.push(block("limits", t.h_limits, notes([t.limit_counts, t.limit_estimated, t.limit_factor, t.limit_retro])));

  return `<!doctype html>\n<html lang="${L}"><head><meta charset="utf-8"><title>${esc(t.title)} - ${esc(input.regionName)} ${input.year}</title><style>${STYLE}</style></head><body>\n${out.join("\n")}\n<p class="ack">${t.ack}</p>\n</body></html>\n`;
}
