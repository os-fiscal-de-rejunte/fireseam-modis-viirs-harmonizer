# MODIS-VIIRS Harmonizer: technical record and area-of-interest design

Date: 2026-11-13. Team: Os Fiscal de Rejunte. Event: NASA Space Apps Challenge 2026, São Paulo,
14-15 November 2026.

This document has two parts. Part A records what is already built and why, including where the
build departed from the original handoff (`docs/handoff-space-apps-2026 (2).md`). Part B designs
the next increment: a user-selected area of interest with unusual-condition and
critical-period analysis.

## 1. Challenge requirement

> Build a web application that harmonizes these records into a burning activity calendar based
> on active fire hotspots, enabling early warning and emergency responders, scientists, and land
> managers to examine historical fire patterns, unusual conditions, and critical periods within
> a selected area of interest.

| Requirement | Status today | Where it is addressed |
|---|---|---|
| Web application | Built | `web/` (Vite, deck.gl, Tone.js), GitHub Pages |
| Harmonized burning activity calendar | Built, for the whole region | Part A |
| Historical fire patterns | Built, for the whole region | Part A |
| Selected area of interest | **Missing**: the region is a fixed bounding box | Part B, sections 7-8 |
| Unusual conditions | **Missing** | Part B, section 9 |
| Critical periods | **Missing** | Part B, section 9 |

---

# Part A. As built

## 2. Architecture

There is no backend. A Python pipeline (`python -m mvh.export`) reads raw FIRMS CSVs and writes
static files to `web/public/data/`. The web app reads those files and is deployed to GitHub
Pages. The exported files are versioned, so the site builds without the raw data.

Raw data: FIRMS archive, MODIS C6.1 (Terra and Aqua) 2001-2026 and VIIRS 375 m (S-NPP)
2012-2026, already downloaded. It lives outside git, under the folder set by `FIRMS_OUT_DIR`.

| Module (`src/mvh/`) | Purpose |
|---|---|
| `config.py` | Constants, week rule, coverage rule |
| `ingest.py` | Raw FIRMS CSV to a standard detections frame |
| `grid.py` | Dense cell x week cube and regional weekly totals |
| `baseline.py` | Monthly-ratio baseline |
| `harmonizer.py` | Poisson GLM and leave-one-year-out cross-validation |
| `validate.py` | Acceptance metrics |
| `pairing.py` | Aqua x S-NPP ghost detections |
| `events.py` | Fire events |
| `forecast.py` | PYRO artifacts to `forecast.json` |
| `schema.py` | Validator for the static export |
| `audit.py` | Raw data audit (`docs/data-audit.md`) |
| `export.py` | Pipeline entry point |

| Web module (`web/src/`) | Purpose |
|---|---|
| `data.js` | Loading and decoding of the exported files |
| `globe.js` | deck.gl globe, detection points, ghost layers, forecast cells |
| `heatmap.js` | Year x week calendar heatmap |
| `yearly.js` | Yearly totals chart |
| `sound.js` | Sonification of one year |
| `main.js` | State and wiring |

## 3. Rules shared by every module

- **Region.** Bounding box `-58.5, -22.5, -54.0, -15.5` (lon min, lat min, lon max, lat max).
  It is a box, not the Pantanal biome polygon.
- **Grid.** 0.1 degree cells, 45 columns x 70 rows = 3150 cells.
- **Weeks.** Every year has a fixed 52 weeks in UTC: `week = min((doy - 1) // 7 + 1, 52)`.
  Week 52 absorbs the last days of the year. The calendar has 26 x 52 = 1352 weeks.
- **Coverage.** A week with a satellite outage, or outside the downloaded interval, is a gap,
  never a zero. Outages are listed in `config.KNOWN_GAPS`.
- **Week status.** `observed` when VIIRS covers the week, `estimated` when only MODIS does and
  the model converts it, `gap` otherwise. Published calendar: 753 observed, 579 estimated,
  20 gap.
- **2026** is partial and partly near-real-time. It is excluded from training and scoring.

## 4. Exported files (the contract between pipeline and web)

| File | Content |
|---|---|
| `calendar.json` | `meta` (bbox, cell size, method, coverage) and 1352 `weeks`, each with `year`, `week`, `modis`, `viirs`, `pred`, `harmonized`, `status`, `nrt` |
| `points/<year>.bin` | Every detection as columnar blocks: `lon` and `lat` (uint16, 0.001 degree offsets from the bbox corner), `doy` (uint16), `flags` (uint8), `frp` (uint8, log scale) |
| `points/index.json` | Per year: point count and the start offset of each week |
| `metrics.json` | Validation scores, per-year scores, events per year, pairing statistics |
| `forecast.json` | PYRO outlook cells |

Point flags: bit 0 VIIRS (else MODIS), bit 1 ghost, bit 2 night, bit 3 Terra (else Aqua).

`schema.validate_export` checks every file after each export.

## 5. Decisions and how they differ from the handoff

| Topic | Handoff | Built | Reason |
|---|---|---|---|
| Model | LightGBM per cell and day | Poisson GLM on regional weekly totals | A cell-level gradient boosting model was built first. It reached a mean weekly error of 244.88 against 249.84 for the baseline but won only 6 of 14 years, so the acceptance rule rejected it |
| Time step | Day | Week | The handoff's own acceptance metric was weekly, and the accepted model works on weekly totals |
| Acceptance rule | Weekly error below the baseline | Weekly error below the baseline **and** at least 8 of 14 years won | Reason not recorded. The results show why it matters: 2020 and 2024 account for most of the absolute gain |
| Pre-Aqua era | Not covered | Second, Terra-only model | Aqua starts on 2002-07-04 |
| Ghost definition | No thresholds | 2 km radius, 180 minute window, Aqua x S-NPP | Set in `pairing.py`; headline years are 2012-2021 because Aqua's orbit drifts from 2022 |
| Detection-level validation | 1 km, +/-20 min pairing | Not built | The ghost pairing covers the sensor-agreement question; no separate validation pairing exists |
| Fire events | ST-DBSCAN, 2 km, 2 days | Space-time connected components, 2 km, 2 days | Same thresholds, simpler algorithm |
| VIIRS satellites | S-NPP, NOAA-20/21 pending | S-NPP only | Reason not recorded. S-NPP is the longest VIIRS record; the README lists this as a limitation |
| Region | Bbox or biome polygon pending | Bbox | Reason not recorded; the README lists this as a limitation |
| Layout | `pipeline/`, `model/`, `events/`, `export/` | One package, `src/mvh/` | Matches the repo template's `src/` layout |
| Extra | Not planned | PYRO forecast outlook | Added from the companion repo `exp-pyro-predictive` |

Results (leave-one-year-out, 2012-2025, mean absolute error of the weekly regional total):

| Check | Model | Monthly-ratio baseline |
|---|---|---|
| Terra + Aqua | 217.56 | 240.27 |
| Years won | 9 of 14 | |
| Terra only | 314.34 | 325.38 |
| Years won, Terra only | 8 of 14 | |

The gain is modest (about 9%) and the score is indicative, because the model design was chosen
after the cell-level design failed on the same folds.

## 6. Open items that are not code

- Both pitch claims are now confirmed by official sources, read on 13 November 2026. NASA
  Science, "Terra: The End of An Era", 29 December 2025, editor's note: end of science
  activities projected for Terra in February 2027 and Aqua in September 2027
  (https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era/). INPE,
  Programa Queimadas, "Perguntas Frequentes", item 7: Aqua MODIS is the reference satellite
  since July 2002 and S-NPP VIIRS will replace it when Aqua stops
  (https://data.inpe.br/queimadas/faq/). Correction: Terra's projected end of science is
  February 2027, not January as the original handoff said.
- The handoff's commit scope list lacks scopes for some modules. The repository uses
  `pipeline`, `model`, `web`, `data`, `infra` and `docs`; new work in this spec uses the same.

---

# Part B. Area of interest, unusual conditions and critical periods

## 7. Approach

The user selects a rectangle inside the region. The browser computes that area's calendar from
a new exported cube and from the regional harmonization factor of each week. There is still no
backend.

Rejected alternatives: an API that refits the model per area (adds a server and a point of
failure, and the cell-level model already failed validation), and a fixed list of sub-regions
(the requirement asks for a selected area).

**Stated assumption.** The MODIS to VIIRS conversion factor of a week is the same everywhere in
the region. This is a limitation and must appear in the README and in the app.

## 8. Data layer

### 8.1 Cube export

`export.py` writes a sparse cell x week cube next to the existing files.

- `cube/<year>.bin`, one per year that has at least one entry (as `points/` does). Columnar blocks, in this order, each of length
  `n`: `cell` (uint16 little-endian, `cy * 45 + cx`), `week` (uint8, 1-52), `modis` (uint16
  LE, Terra + Aqua detections), `viirs` (uint16 LE, S-NPP detections). One entry per
  (cell, week) where either count is above zero, sorted by week and then cell.
- `cube/index.json`: `{"nx": 45, "ny": 70, "years": {"2001": {"n": ...}, ...}}`.
- The exporter fails if any count exceeds 65535. It does not clip.
- `schema.validate_export` checks the cube: file sizes match `n`, cells and weeks are in range,
  and per-week sums match `calendar.json` (`modis` and `viirs`, where those are not null).
- Size budget: 6 MB for all files (an estimate from the published points gives about 1.5 MB).
  Measure after the first real export. If it is over
  budget, report the measured size and stop for a decision; do not change the format without
  one.

### 8.2 Uncertainty band

- The pipeline already produces leave-one-year-out predictions for 2012-2025. From those weeks
  compute `r = (observed + 1) / (predicted + 1)` and take its 10th and 90th percentiles,
  separately for the Terra + Aqua model and for the Terra-only model.
- `metrics.json` gains `uncertainty: {"full": {"q10", "q90"}, "terra": {"q10", "q90"}}`.
- Each week in `calendar.json` gains `lo` and `hi`. For `estimated` weeks they are
  `pred * q10` and `pred * q90` of the model that produced `pred`, rounded to one decimal. For
  `observed` and `gap` weeks they are null.
- `schema.py` is updated for the new keys.
- The band describes the regional conversion only. The app labels it that way.

### 8.3 Area calendar (browser)

New pure module `web/src/aoi.js`. Input: the decoded cube, `calendar.json`, and an area
`{cx0, cy0, cx1, cy1}` (inclusive cell indices). Output: 1352 weeks with the same keys as the
regional calendar.

For each week, with `M` and `V` the sums of `modis` and `viirs` over the area's cells and `w`
the regional week:

| Regional status | Area `harmonized` | Area `lo`, `hi` |
|---|---|---|
| `observed` | `V` | null |
| `estimated`, `w.modis > 0` | `M * w.pred / w.modis` | `M * w.lo / w.modis`, `M * w.hi / w.modis` |
| `estimated`, `w.modis` is 0 or null | 0, and the week carries `factor: false` | null |
| `gap` | null | null |

The area's `modis` is `M` when `w.modis` is not null, else null. The same holds for `viirs`
and `V`. `status` and `nrt` are copied from the regional week.

**Invariant.** For the full grid, the area calendar equals `calendar.json` on `modis`, `viirs`
and `status` exactly, and on `harmonized` after rounding to one decimal, for every week where
`factor` is not false. A pytest test checks the cube side on the sample export, and a vitest
test checks the browser side.

## 9. Unusual conditions and critical periods

New pure module `web/src/stats.js`, applied to whichever calendar is active (regional or area).

- **Reference set.** For a week of year `k` in year `y`: the `harmonized` values of week `k` in
  every year 2001-2025 except `y`, skipping nulls. Year 2026 is evaluated against 2001-2025.
- **Percentile.** The share of reference values strictly below the week's value.
- **Unusual.** Percentile at or above 0.90 and value above zero. **Record** when the value is
  above every reference value.
- **Critical period.** Take the mean of each week of year over 2001-2025, skipping nulls. The
  critical period is the shortest contiguous run of weeks (no wrap across the year end) whose
  sum is at least 80% of the total. Ties go to the earliest run. If the total is zero there is
  no critical period.
- **Year to date.** For the selected year, the cumulative `harmonized` up to the selected week
  and its percentile against the same cumulative in the reference years.
- **Insufficient data.** If a week has fewer than 10 reference values, it gets no percentile.
  If the area's mean yearly total over 2001-2025 is below 100, the app shows "not enough
  detections in this area" in place of unusual weeks and the critical period.

Estimated weeks take part in the reference set. The app keeps showing them as estimated.

## 10. Web interface

- **Selecting.** A "Select area" toggle on the globe. While it is on, dragging draws a
  rectangle that snaps to the 0.1 degree grid and is clamped to the region; globe rotation is
  disabled during the drag. Minimum size is one cell. "Whole region" clears the area.
- **State.** `state.aoi` is `{cx0, cy0, cx1, cy1}` or null. It is mirrored in the URL hash as
  `#aoi=cx0,cy0,cx1,cy1` and restored on load. An invalid hash is ignored.
- **Loading.** The cube files are fetched on the first selection, all years in parallel, and
  kept in memory.
- **What follows the area.** Heatmap, yearly totals, readout and sonification use the area
  calendar. The events table, the ghost shares and the PYRO outlook stay regional and are
  labeled "whole region" while an area is active.
- **Globe.** The area outline is drawn on the globe. Dimming the points outside the area is
  the last task of this increment and is dropped first if time runs out.
- **Heatmap.** Unusual weeks get a marker, records a stronger one, and the critical period a
  band across its weeks. The tooltip shows value, status, percentile and, for estimated weeks,
  the `lo`-`hi` range.
- **CSV.** A "Download CSV" button writes the active calendar in the browser. Columns:
  `year, week, week_start, modis, viirs, harmonized, lo, hi, status, percentile, unusual`.
  The file name carries the area's bounding box in degrees.

## 11. Errors

- If a cube file fails to load, the app shows a message, clears the area and keeps the regional
  calendar working.
- A selection with no detections is valid: the calendar is all zeros and nulls and the
  insufficient-data rule applies.
- The pipeline fails loudly on a cube count above 65535 or a schema mismatch.

## 12. Tests

- **pytest:** cube encoding round trip; cube sums equal the calendar per week; exporter fails
  on overflow; uncertainty quantiles on a small synthetic frame; schema accepts the new keys
  and rejects a broken cube. The sample export under `data/sample/export` is regenerated.
- **vitest:** `aoi.js` full-grid invariant, empty area, single cell, week with `w.modis` 0,
  gap week, partial year 2026; `stats.js` percentile, unusual, record, critical period
  (including a zero profile and a tie), year to date, insufficient data.
- **Build:** `npm run build` passes and the app loads the real exported files.

## 13. Build order and working rules

1. Cube export and schema check.
2. Uncertainty band in the pipeline.
3. `aoi.js`.
4. `stats.js`.
5. Area selection on the globe and state in the URL.
6. Heatmap markers, tooltip and labels.
7. CSV download.
8. README limitations and pitch material updated.
9. Dimming of points outside the area.

Steps 1-2 and 3-4 can run in parallel once the cube format in 8.1 is fixed; steps 3-4 are
developed against a small hand-made cube.

Rules: test first, then code, then a Conventional Commit in English. Sonnet subagents
implement; Opus reviews and does not implement.

## 14. Out of scope (future work)

- A test of the calendar under the end of MODIS (VIIRS-only continuation).
- Harmonized FRP.
- NOAA-20 and NOAA-21.
- Free-form polygons and the biome boundary.
- Regions outside the current bounding box.
- A conversion factor that varies in space.
