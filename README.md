<div align="center">

# 🔥 MODIS-VIIRS Harmonizer

**One consistent weekly fire-activity calendar for the Pantanal, 2001-2026, in VIIRS-equivalent counts.**

[![CI](https://github.com/os-fiscal-de-rejunte/modis-viirs-harmonizer/actions/workflows/ci.yml/badge.svg)](https://github.com/os-fiscal-de-rejunte/modis-viirs-harmonizer/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/os-fiscal-de-rejunte/modis-viirs-harmonizer?sort=semver)](https://github.com/os-fiscal-de-rejunte/modis-viirs-harmonizer/releases)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org)
[![NASA Space Apps 2026](https://img.shields.io/badge/NASA-Space%20Apps%202026-0B3D91?logo=nasa&logoColor=white)](https://www.spaceappschallenge.org)

</div>

## Overview

**Challenge:** Harmonization of MODIS and VIIRS Hot Spots

MODIS (about 1 km pixels, active since 2000) and VIIRS (375 m pixels, since 2012) do not see
fire the same way. In our Pantanal bounding box VIIRS reports several times more detections per
week than MODIS, so simply stacking the two records creates an artificial jump in 2012. NASA
plans to end Terra and Aqua MODIS science data collection, which would leave VIIRS as the only
continuing record. This project turns the MODIS record into VIIRS-equivalent weekly counts for
the Pantanal region, so that 2001-2026 reads as one calendar. Everything is precomputed in
Python and served as static files; there is no backend.

## What you get

- **Harmonized weekly calendar** (`calendar.json`), 26 years x 52 weeks = 1352 weeks. Each week
  is `observed` (VIIRS data exists), `estimated` (MODIS converted to VIIRS-equivalent) or `gap`
  (no usable sensor). In the published calendar: 753 observed, 579 estimated, 20 gap.
- **3D globe** with every detection as a point, plus "ghosts": detections that only one of Aqua
  or S-NPP saw in the same overpass window.
- **Fire events**: space-time connected components of detections, counted per sensor and year.
- **Sonification**: one year of the harmonized weekly series played as notes, with pitch and
  loudness following the weekly count.
- **Forecast outlook** from the companion model PYRO
  ([`os-fiscal-de-rejunte/exp-pyro-predictive`](https://github.com/os-fiscal-de-rejunte/exp-pyro-predictive)).
  Its event is "at least one MOD14A2 fire pixel in the 8-day composite, given a fully valid
  41x41-pixel mask". The demo shows the model's published test scores (ROC AUC 0.7506, recall
  0.3955, precision 0.5786, Brier 0.1508) and only the cells PYRO releases (498 of 1140).

## Results

Leave-one-year-out validation over 2012-2025 (14 years). Error is the mean absolute error of the
weekly regional total, in detections per week. Source: `web/public/data/metrics.json`.

| Check | Model | Monthly-ratio baseline |
|---|---|---|
| Weekly total, MODIS Terra + Aqua | 217.56 | 240.27 |
| Years where the model wins | 9 of 14 | |
| Weekly total, Terra only (pre-Aqua era) | 314.34 | 325.38 |
| Years where the Terra-only model wins | 8 of 14 | |

The model passes the acceptance rule (`method: "model"`), so the published calendar uses it.
Read this as a modest improvement, not a decisive one:

- The mean weekly error drops by about 9% (217.56 vs 240.27) and the model is ahead in 9 of 14
  held-out years. Most of the absolute gain comes from the megafire years: 2024 and 2020 account
  for 265 of the 318 detections per week gained, summed over the years (`by_year`).
- The Terra-only model passes the rule exactly at the threshold: 8 of 14 years.
- The model design was chosen after an earlier cell-level design failed on the same validation
  folds, so the reported score is not from a fully untouched test set and is indicative only.
  2026 data was never used for training or scoring.

| Other outputs | Value |
|---|---|
| Aqua detections with no S-NPP match in the same overpass, 2012-2021 (pooled) | 11.7% |
| S-NPP detections with no Aqua match in the same overpass, 2012-2021 (pooled) | 52.3% |
| Fire events in 2020 | 7316 from MODIS, 12624 from VIIRS |

Ghost shares use a 2 km radius and a 180 minute window.

## Method

- **Grid and weeks.** 0.1 degree cells (45 x 70) over the bounding box
  `-58.5, -22.5, -54.0, -15.5`. Each year has a fixed 52 weeks (UTC); week 52 absorbs the last
  days of the year.
- **Coverage rule.** A week with a satellite outage, or outside the downloaded interval, is a
  gap, never a zero. Known outages are listed in the config, including two Suomi NPP outages in
  2024 (2024-05-30 to 06-03 and 2024-07-24 to 07-28, padded by one day in the config, when Terra and Aqua kept detecting); those
  weeks count as `estimated`, not as a low VIIRS observation, and do not train or score the
  model.
- **Harmonizer.** A Poisson GLM on the regional weekly totals. Features: MODIS counts per
  satellite, night share, mean FRP, spatial concentration and season. A second, Terra-only model
  covers the weeks before Aqua.
- **Negative result.** A cell-level gradient boosting model was tried first. In an earlier
  run (before the 2024 outage fix, so against an earlier baseline value) it reached a mean weekly
  error of 244.88 against the baseline's 249.84, but won only 6 of 14 years, so the same
  acceptance rule rejected it and we moved to regional totals.
- **Validation.** Leave-one-year-out against a monthly-ratio baseline fitted inside each fold.
  A model is accepted only if its mean weekly error is lower than the baseline's and it wins at
  least 8 of the 14 years.
- **2026** is partial and partly near-real-time. It is excluded from training and scoring.

## Limitations

- "Pantanal region" is a bounding box, not the biome polygon.
- Harmonized values before 2012 are model estimates, not observations.
- A missing detection does not mean there was no fire.
- Only S-NPP is used for VIIRS (no NOAA-20 or NOAA-21).
- Aqua's orbit drifts after 2022, so ghost shares are not comparable across that point.
- The PYRO outlook is a seasonal projection of detection probability, not of ignition.
- The model does not win every year (9 of 14); in 2012, 2019, 2021, 2022 and 2025 the baseline
  has the lower error, and the validation score is indicative (see Results).

## Quickstart

```bash
git clone https://github.com/os-fiscal-de-rejunte/modis-viirs-harmonizer.git
cd modis-viirs-harmonizer
cp .env.example .env              # set FIRMS_OUT_DIR to your raw FIRMS folder
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pre-commit install --hook-type pre-commit --hook-type commit-msg
pytest
```

The raw FIRMS CSVs are not in the repository. Download them with the team's `fetch_firms.py`
script (maintained on a separate branch; it uses `FIRMS_MAP_KEY` from `.env`) or manually from
FIRMS, into `modis/<year>.csv` and `viirs_snpp/<year>.csv` under the folder given by
`FIRMS_OUT_DIR`. Then run the pipeline:

```bash
python -m mvh.audit               # writes docs/data-audit.md (needs FIRMS_OUT_DIR in the environment, or --raw)
python -m mvh.export              # writes calendar, points, metrics to web/public/data/
python -m mvh.forecast --pyro <PYRO artifacts dir>   # writes web/public/data/forecast.json
```

Run the web demo:

```bash
cd web
npm install
npm run dev
```

On Windows, a project path containing `&` breaks `npm run` scripts: clone into a path without
special characters.

The exported files under `web/public/data/` are versioned, so the site builds and runs without
the raw data. `npm test` runs the web unit tests and `npm run build` writes `web/dist`.

## Project structure

```
src/mvh/
  config.py      constants, week rule, coverage rule
  ingest.py      raw FIRMS CSV -> standard detections frame
  grid.py        dense cell x week cube
  baseline.py    monthly-ratio baseline
  harmonizer.py  Poisson GLM + leave-one-year-out CV
  validate.py    acceptance metrics
  pairing.py     Aqua x S-NPP ghost detections
  events.py      fire events
  forecast.py    PYRO artifacts -> forecast.json
  schema.py      validator for the static export
  audit.py       raw data audit
  export.py      pipeline entry point
tests/           unit tests on small synthetic frames
data/sample/     tiny versioned samples (raw, export, PYRO)
web/             Vite + deck.gl + Tone.js demo
web/public/data/ exported static files (versioned)
docs/            data audit and pitch material
```

## Data and acknowledgments

| Source | Product | Use |
|---|---|---|
| NASA FIRMS | MODIS C6.1 (Terra/Aqua) | hotspots, 2001-2026 |
| NASA FIRMS | VIIRS 375 m (S-NPP) | hotspots, 2012-2026 |
| NASA GIBS | Blue Marble Shaded Relief Bathymetry | globe imagery |
| PYRO (`exp-pyro-predictive`) | released model artifacts | forecast outlook |

We acknowledge the use of data and imagery from LANCE FIRMS operated by NASA's Earth Science
Data and Information System (ESDIS) with funding provided by NASA Headquarters.

## Use of AI

AI coding assistants were used to help write and review code and documentation; all results
were produced by running the code in this repository on NASA FIRMS data.

## Contributing

Branch, commit and PR rules: [CONTRIBUTING.md](https://github.com/os-fiscal-de-rejunte/.github/blob/main/CONTRIBUTING.md).

```
git switch -c feat/12-short-description
git commit -m "feat(pipeline): add firms archive ingestion"
```

## Team

Built by **[Os Fiscal de Rejunte](https://github.com/os-fiscal-de-rejunte)** for the NASA Space Apps Challenge 2026, São Paulo.

## License

[MIT](LICENSE).
