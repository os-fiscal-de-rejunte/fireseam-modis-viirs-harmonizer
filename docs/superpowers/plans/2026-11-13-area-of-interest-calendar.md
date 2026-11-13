# Area-of-Interest Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user select a rectangle inside the Pantanal region and see that area's harmonized weekly calendar, its unusual weeks, its critical period, an uncertainty range and a CSV download.

**Architecture:** The Python pipeline exports a sparse cell x week cube and an uncertainty band next to the existing static files. The browser sums the cube over the selected cells and applies each week's regional MODIS to VIIRS factor from `calendar.json`. Statistics run in the browser on whichever calendar is active. There is no backend.

**Tech Stack:** Python 3.12 (numpy, pandas, scikit-learn, pytest, ruff); Vite, deck.gl 9 (`GlobeView`), vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-11-13-modis-viirs-harmonizer-design.md` (Part B, sections 7-14).

## Global Constraints

- Execution: Sonnet subagents implement each task; Opus reviews and does not implement.
- Branch: `feat/area-of-interest-calendar`, cut from `feat/harmonized-fire-calendar`. One commit per task.
- Commits: Conventional Commits in English, lower-case subject, no full stop, header at most 72 characters. Allowed scopes: `pipeline`, `model`, `web`, `data`, `docs`.
- Test first in every task: write the failing test, see it fail, implement, see it pass, commit.
- Grid: `NX = 45`, `NY = 70`, `CELL_DEG = 0.1`, bbox `-58.5, -22.5, -54.0, -15.5`. Cell id is `cy * 45 + cx`.
- Weeks: `week = min((doy - 1) // 7 + 1, 52)`; years 2001-2026; 1352 weeks.
- Thresholds: unusual at percentile `>= 0.90`; critical period covers `>= 0.80` of the mean yearly total; at least `10` reference values per week; mean yearly total at least `100`; reference years 2001-2025.
- Uncertainty: 10th and 90th percentiles of `(observed + 1) / (predicted + 1)`.
- Before every Python commit: `ruff check . && ruff format --check . && pytest -q` (repo root). Before every web commit: `npm test && npm run build` (in `web/`).
- Area values assume a spatially uniform conversion factor. The app and the README must say so.
- Events, ghost shares and the PYRO outlook stay regional.

## Review Focus

1. **Drag that leaves the globe or the region.** A corner with no map coordinate cancels the selection; a corner outside the bbox is clamped to the edge cell. Pinned in Task 5 (`cellsFromLonLat` clamp) and Task 9 (cancel rule).
2. **Malformed, reversed or out-of-range URL hash** (`#aoi=3,4,1,2`, `#aoi=0,0,45,0`, `#aoi=1.5,2,3,4`, `#aoi=a,b,c,d`). The app loads the whole region and does not throw. Pinned in Task 5 (`parseAoiHash`).
3. **Area with no detections at all.** Every value is 0 or null; no week is unusual; no critical period; the insufficient-data message shows; the CSV still downloads. Pinned in Task 6 (zero tests) and Task 7 (gap row).
4. **Estimated week whose regional MODIS count is 0 while the model predicts above 0.** The area value is 0 with `factor: false`, never `NaN` or `Infinity`. Pinned in Task 5.
5. **Changing the area while a year is playing or sounding.** Playback and sound stop before the calendar is swapped. Pinned in Task 10 (manual check 6).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/mvh/export.py` | modify | Write `cube/`, pass the band into the calendar |
| `src/mvh/validate.py` | modify | `ratio_quantiles` |
| `src/mvh/harmonizer.py` | modify | Add `uncertainty` to the metrics |
| `src/mvh/schema.py` | modify | Check the cube, `lo`/`hi`, `uncertainty` |
| `data/sample/export/` | regenerate | Sample with cube and band |
| `web/public/data/` | regenerate | Real export with cube and band |
| `web/src/data.js` | modify | `decodeCube`, `loadCube` |
| `web/src/aoi.js` | create | Area calendar and area/hash/coordinate helpers (pure) |
| `web/src/stats.js` | create | Percentiles, unusual weeks, critical period (pure) |
| `web/src/csv.js` | create | CSV text, file name, download |
| `web/src/heatmap.js`, `web/src/yearly.js` | modify | Swap calendar; draw markers |
| `web/src/globe.js` | modify | Area outline, drag selection, dimming |
| `web/src/main.js`, `web/index.html`, `web/src/style.css` | modify | State, wiring, copy |
| `README.md`, `docs/pitch-script.md`, `docs/slides-outline.md` | modify | Method, limitations, demo beat |

Tasks 1-3 (pipeline) run in order. Tasks 4-9 (web) do not depend on Tasks 1-3 and can run alongside them. Task 10 needs all of 1-9.

---

### Task 1: Sparse cube export

**Files:**
- Modify: `src/mvh/export.py`, `src/mvh/schema.py`
- Test: `tests/test_export.py`, `tests/test_schema.py`
- Regenerate: `data/sample/export/cube/`

**Interfaces:**
- Consumes: `grid.weekly_cube` frame (columns `year`, `week`, `cx`, `cy`, `n_terra`, `n_aqua`, `n_viirs`).
- Produces:
  - `export._cube_blocks(cube: pd.DataFrame) -> dict[int, dict]`, `{year: {"n": int, "blob": bytes}}`, only for years with at least one entry.
  - Files `cube/<year>.bin` (7 bytes per entry) and `cube/index.json` = `{"nx": 45, "ny": 70, "years": {"<year>": {"n": int}}}`.
  - Blob layout, each block of length `n`: `cell` `<u2` at offset 0, `week` `u1` at `2n`, `modis` `<u2` at `3n`, `viirs` `<u2` at `5n`. `modis = n_terra + n_aqua`. One entry per (cell, week) with `modis + viirs > 0`, sorted by week then cell.

- [ ] **Step 1: Write the failing tests in `tests/test_export.py`**

```python
def _read_cube(path: Path) -> dict[str, np.ndarray]:
    raw = path.read_bytes()
    n = len(raw) // 7
    return {
        "cell": np.frombuffer(raw, "<u2", n, 0),
        "week": np.frombuffer(raw, "u1", n, 2 * n),
        "modis": np.frombuffer(raw, "<u2", n, 3 * n),
        "viirs": np.frombuffer(raw, "<u2", n, 5 * n),
    }


def test_cube_2020_matches_the_detections(exported):
    from mvh.grid import cell_index

    index = json.loads((exported / "cube" / "index.json").read_text(encoding="utf-8"))
    assert (index["nx"], index["ny"]) == (config.NX, config.NY)
    assert sorted(index["years"]) == ["2011", "2020"]
    cube = _read_cube(exported / "cube" / "2020.bin")
    assert len(cube["cell"]) == index["years"]["2020"]["n"]
    for sensor, col in (("modis", "modis"), ("viirs", "viirs")):
        df = load_firms(sensor, SAMPLE)
        df = df[df["year"] == 2020]
        cx, cy = cell_index(df["lon"].to_numpy(), df["lat"].to_numpy())
        want: dict[tuple[int, int], int] = {}
        for c, w in zip((cy.astype(int) * config.NX + cx).tolist(), df["week"].tolist(), strict=True):
            want[(c, int(w))] = want.get((c, int(w)), 0) + 1
        got = {
            (int(c), int(w)): int(v)
            for c, w, v in zip(cube["cell"], cube["week"], cube[col], strict=True)
            if v
        }
        assert got == want
    order = cube["week"].astype(np.int64) * 65536 + cube["cell"]
    assert np.all(np.diff(order) > 0)
    assert np.all(cube["modis"].astype(int) + cube["viirs"] > 0)


def test_cube_count_above_uint16_fails():
    import pandas as pd

    from mvh.export import _cube_blocks

    cube = pd.DataFrame(
        {"year": [2020], "week": [1], "cx": [0], "cy": [0],
         "n_terra": [40000], "n_aqua": [30000], "n_viirs": [0]}
    )  # fmt: skip
    with pytest.raises(ValueError, match="65535"):
        _cube_blocks(cube)
```

Extend the existing `test_second_run_is_byte_identical_and_removes_stale_files`: also plant `cube/1999.bin` before the second run and assert it is gone.

- [ ] **Step 2: Write the failing tests in `tests/test_schema.py`**

```python
def _cube_n(export, year="2020"):
    return json.loads((export / "cube" / "index.json").read_text(encoding="utf-8"))["years"][year]["n"]


def test_truncated_cube_rejected(export):
    path = export / "cube" / "2020.bin"
    path.write_bytes(path.read_bytes()[:-1])
    with pytest.raises(ValueError, match=r"cube/2020.bin: size must be"):
        validate_export(export)


def test_cube_sum_must_match_calendar(export):
    path = export / "cube" / "2020.bin"
    raw = bytearray(path.read_bytes())
    n = _cube_n(export)
    raw[5 * n + 1] ^= 1  # high byte of the first viirs count: off by 256, never zero
    path.write_bytes(bytes(raw))
    with pytest.raises(ValueError, match="calendar has"):
        validate_export(export)


def test_orphan_cube_rejected(export):
    (export / "cube" / "2019.bin").write_bytes(b"")
    with pytest.raises(ValueError, match="not listed in cube/index.json"):
        validate_export(export)


def test_cube_grid_must_match_config(export):
    _edit(export / "cube" / "index.json", lambda d: d.update(nx=44))
    with pytest.raises(ValueError, match="nx, ny must equal 45, 70"):
        validate_export(export)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pytest tests/test_export.py tests/test_schema.py -q`
Expected: the new tests FAIL (no `cube/` directory, no `_cube_blocks`).

- [ ] **Step 4: Implement `_cube_blocks` and the writing in `src/mvh/export.py`**

`_cube_blocks` raises `ValueError("cube count exceeds 65535 ...")` naming the year, week and cell; it never clips. `export_all` writes `cube/<year>.bin` and `cube/index.json` after the points. `_clean` also removes `cube/*.bin` and `cube/index.json`.

- [ ] **Step 5: Implement `_check_cube(root: Path, cal: dict) -> None` in `src/mvh/schema.py` and call it from `validate_export`**

Checks, with these messages: `cube/index.json: nx, ny must equal 45, 70`; year keys in 2001..2026; `cube/<y>.bin: size must be <7n> bytes (7 * n)`; cell `< 3150`; week in 1..52; `entries must be sorted by week then cell and unique`; `every entry needs a count above zero`; per week and sensor, where the calendar value is not null, `cube: <sensor> sum of <year> week <week> is <a>, calendar has <b>` (a year absent from the index sums to 0); `cube/<file>: not listed in cube/index.json`.

- [ ] **Step 6: Regenerate the sample export**

Run: `python -m mvh.export --raw data/sample/raw --out data/sample/export`
Expected: `git status --short data/sample/export` shows only new files under `cube/`.

- [ ] **Step 7: Run all checks**

Run: `ruff check . && ruff format --check . && pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/mvh/export.py src/mvh/schema.py tests/test_export.py tests/test_schema.py data/sample/export/cube
git commit -m "feat(pipeline): export sparse cell by week cube"
```

---

### Task 2: Uncertainty band

**Files:**
- Modify: `src/mvh/validate.py`, `src/mvh/harmonizer.py`, `src/mvh/export.py`, `src/mvh/schema.py`
- Test: `tests/test_validate.py`, `tests/test_export.py`, `tests/test_schema.py`
- Regenerate: `data/sample/export/calendar.json`, `data/sample/export/metrics.json`

**Interfaces:**
- Consumes: the frame from `harmonizer.cross_validate` (columns `y`, `pred_model`, `pred_baseline`, `valid`).
- Produces:
  - `validate.ratio_quantiles(cv: pd.DataFrame, pred_col: str) -> dict[str, float]`, keys `q10`, `q90`, rounded to 4 decimals.
  - `metrics["uncertainty"] = {"full": {"q10", "q90"}, "terra": {"q10", "q90"}}`.
  - Calendar weeks gain `lo` and `hi`.

- [ ] **Step 1: Write the failing tests**

`tests/test_validate.py`:

```python
def test_ratio_quantiles_use_valid_weeks_only():
    cv = pd.DataFrame(
        {
            "y": [0, 9, 19, 39, 999],
            "pred_model": [0.0, 9.0, 9.0, 9.0, 0.0],
            "valid": [True, True, True, True, False],
        }
    )
    # ratios (y + 1) / (pred + 1) on valid rows: 1, 1, 2, 4
    assert ratio_quantiles(cv, "pred_model") == {"q10": 1.0, "q90": 3.4}
```

`tests/test_export.py`:

```python
def test_band_only_on_estimated_weeks(exported):
    cal = json.loads((exported / "calendar.json").read_text(encoding="utf-8"))
    unc = json.loads((exported / "metrics.json").read_text(encoding="utf-8"))["uncertainty"]
    seen = set()
    for w in cal["weeks"]:
        if w["status"] != "estimated":
            assert w["lo"] is None and w["hi"] is None
            continue
        mode = "full" if config.sat_covers("Aqua", w["year"], w["week"]) else "terra"
        seen.add(mode)
        assert w["lo"] == round(w["pred"] * unc[mode]["q10"], 1)
        assert w["hi"] == round(w["pred"] * unc[mode]["q90"], 1)
    assert seen == {"full", "terra"}
```

`tests/test_schema.py`, added to the existing `test_bad_calendar_rejected` parametrization in that file's style (an observed week given `lo=1.0`; an estimated week with `lo` above `hi`; an estimated week with `lo=None`) with matches `lo and hi must be null unless status is 'estimated'`, `lo must be <= hi`, `lo and hi must be numbers >= 0 when status is 'estimated'`. Plus:

```python
def test_missing_uncertainty_rejected(export):
    _edit(export / "metrics.json", lambda d: d.pop("uncertainty"))
    with pytest.raises(ValueError, match="uncertainty is missing"):
        validate_export(export)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_validate.py tests/test_export.py tests/test_schema.py -q`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

- `validate.ratio_quantiles`: `np.quantile` with the default linear method on rows where `valid` is true.
- `harmonizer.harmonize`: `metrics["uncertainty"][mode] = ratio_quantiles(cvs[mode], "pred_model" if use_model[mode] else "pred_baseline")`.
- `export._calendar(totals, weekly, method, uncertainty)`: for an estimated week, the mode is `"full"` when `cov_aqua` is true for that week, else `"terra"`; `lo = round(pred * q10, 1)`, `hi = round(pred * q90, 1)`; otherwise both `None`.
- `schema`: `lo`, `hi` join `_WEEK_KEYS` with the three rules above; `_check_metrics` requires `uncertainty.full` and `uncertainty.terra`, each with numeric `q10` and `q90`.

- [ ] **Step 4: Regenerate the sample export**

Run: `python -m mvh.export --raw data/sample/raw --out data/sample/export`

- [ ] **Step 5: Run all checks**

Run: `ruff check . && ruff format --check . && pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/mvh tests data/sample/export
git commit -m "feat(model): add uncertainty band to estimated weeks"
```

---

### Task 3: Regenerate the real export

**Files:**
- Regenerate: `web/public/data/calendar.json`, `web/public/data/metrics.json`, `web/public/data/cube/`

**Interfaces:**
- Consumes: Tasks 1-2; the raw FIRMS archive under `FIRMS_OUT_DIR` (`modis/<year>.csv`, `viirs_snpp/<year>.csv`).
- Produces: the real cube and band that Task 10 loads.

- [ ] **Step 1: Confirm the raw data is reachable**

Run: `python -c "from mvh import config; p = config.raw_root(); print(p, (p / 'modis').is_dir(), (p / 'viirs_snpp').is_dir())"`
Expected: both `True`. If not, STOP and ask the user for the `FIRMS_OUT_DIR` path. Do not build the cube from `points/*.bin`.

- [ ] **Step 2: Save the published calendar for comparison, then export**

```bash
git show HEAD:web/public/data/calendar.json > /tmp/calendar.before.json
python -m mvh.export
```

Use the session scratch directory in place of `/tmp` where one is provided.

- [ ] **Step 3: Verify nothing else moved**

```bash
python - <<'EOF'
import json, pathlib
old = json.load(open("/tmp/calendar.before.json"))["weeks"]
new = json.load(open("web/public/data/calendar.json"))["weeks"]
keys = ("year", "week", "modis", "viirs", "pred", "harmonized", "status", "nrt")
assert [[w[k] for k in keys] for w in old] == [[w[k] for k in keys] for w in new]
size = sum(p.stat().st_size for p in pathlib.Path("web/public/data/cube").glob("*.bin"))
print("cube bytes", size)
assert size <= 6_000_000
EOF
git status --short web/public/data
```

Expected: the assertions pass (the cube is expected near 1.5 MB); `git status` shows `calendar.json` and `metrics.json` modified, new files under `cube/`, and nothing under `points/` changed. If the calendar comparison fails or the cube is over 6 MB, STOP and report the numbers.

- [ ] **Step 4: Commit**

```bash
git add web/public/data/calendar.json web/public/data/metrics.json web/public/data/cube
git commit -m "data(web): add cube and uncertainty band to the export"
```

---

### Task 4: Cube loading in the browser

**Files:**
- Modify: `web/src/data.js`
- Test: `web/src/data.test.js`

**Interfaces:**
- Produces:
  - `decodeCube(buf: ArrayBuffer) -> {n, cell: Uint16Array, week: Uint8Array, modis: Uint16Array, viirs: Uint16Array}`; throws when the byte length is not a multiple of 7.
  - `loadCube(base = "./data") -> Promise<{nx: number, ny: number, years: Map<number, decoded>}>`; fetches `cube/index.json`, then every listed year in parallel; the promise is cached and the cache is cleared on failure.

- [ ] **Step 1: Write the failing tests**

```js
function cubeBuffer(entries) {
  const n = entries.length;
  const buf = new ArrayBuffer(7 * n);
  const dv = new DataView(buf);
  entries.forEach(([cell, week, modis, viirs], i) => {
    dv.setUint16(2 * i, cell, true);
    dv.setUint8(2 * n + i, week);
    dv.setUint16(3 * n + 2 * i, modis, true);
    dv.setUint16(5 * n + 2 * i, viirs, true);
  });
  return buf;
}

describe("decodeCube", () => {
  it("decodes the four blocks", () => {
    const c = decodeCube(cubeBuffer([[0, 1, 2, 10], [3149, 52, 65535, 0]]));
    expect(c.n).toBe(2);
    expect([...c.cell]).toEqual([0, 3149]);
    expect([...c.week]).toEqual([1, 52]);
    expect([...c.modis]).toEqual([2, 65535]);
    expect([...c.viirs]).toEqual([10, 0]);
  });
  it("rejects a size that is not a multiple of 7", () => {
    expect(() => decodeCube(new ArrayBuffer(6))).toThrow(/multiple of 7/);
  });
});

describe("loadCube", () => {
  const index = { nx: 45, ny: 70, years: { 2011: { n: 1 }, 2020: { n: 1 } } };
  const ok = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => body });

  it("loads every listed year", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      url.endsWith("index.json") ? ok(index) : ok(cubeBuffer([[7, 3, 1, 0]])),
    ));
    const cube = await loadCube("./a");
    expect([cube.nx, cube.ny]).toEqual([45, 70]);
    expect([...cube.years.keys()]).toEqual([2011, 2020]);
    expect(cube.years.get(2020).cell[0]).toBe(7);
  });

  it("names the failing file and retries on the next call", async () => {
    const fetchMock = vi.fn(async (url) =>
      url.endsWith("index.json") ? ok(index)
        : url.endsWith("2020.bin") ? { ok: false, status: 404 }
        : ok(cubeBuffer([])),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadCube("./b")).rejects.toThrow(/cube\/2020\.bin/);
    const calls = fetchMock.mock.calls.length;
    await expect(loadCube("./b")).rejects.toThrow();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/data.test.js`
Expected: FAIL, `decodeCube` is not exported.

- [ ] **Step 3: Implement `decodeCube` and `loadCube` in `web/src/data.js`**

Follow `decodePoints` and `loadYear` (slice per block; cache keyed by `base`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/data.js web/src/data.test.js
git commit -m "feat(web): load the cell by week cube"
```

---

### Task 5: Area calendar and area helpers

**Files:**
- Create: `web/src/aoi.js`
- Test: `web/src/aoi.test.js`

**Interfaces:**
- Consumes: the cube object from `loadCube`; a calendar `{meta, weeks}` whose weeks carry `lo` and `hi`.
- Produces (an area is `{cx0, cy0, cx1, cy1}`, inclusive, `cx0 <= cx1`, `cy0 <= cy1`):
  - `areaCalendar(cube, calendar, aoi) -> {meta: {...calendar.meta, aoi}, weeks}`; one output week per input week, same keys, plus `factor: false` only in the case below.
  - `cellsFromLonLat(a, b, bbox, cellDeg, nx, ny) -> aoi`, from two `[lon, lat]` corners in any order, clamped.
  - `aoiBounds(aoi, bbox, cellDeg) -> [lonMin, latMin, lonMax, latMax]`.
  - `parseAoiHash(hash, nx, ny) -> aoi | null`; `formatAoiHash(aoi) -> "#aoi=cx0,cy0,cx1,cy1"`.

Rule per week, with `M`, `V` the area sums and `w` the regional week:

| `w.status` | `harmonized` | `lo`, `hi` |
|---|---|---|
| `observed` | `V` | null |
| `estimated`, `w.modis > 0` | `round1(M * w.pred / w.modis)` | `round1(M * w.lo / w.modis)`, `round1(M * w.hi / w.modis)` |
| `estimated`, `w.modis` 0 or null | `0`, with `factor: false` | null |
| `gap` | null | null |

`modis` is `M` when `w.modis` is not null, else null; `viirs` likewise with `V`. `pred` equals `harmonized` on estimated weeks, else null. `status` and `nrt` are copied. `round1(x) = Math.round(x * 10) / 10`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { areaCalendar, cellsFromLonLat, aoiBounds, parseAoiHash, formatAoiHash } from "./aoi.js";

const BBOX = [-58.5, -22.5, -54.0, -15.5];
const u16 = (a) => Uint16Array.from(a);
// 3 x 2 grid; entries are [cell, week, modis, viirs]
const cube = {
  nx: 3, ny: 2,
  years: new Map([[2020, {
    n: 4,
    cell: u16([0, 4, 0, 5]),
    week: Uint8Array.from([1, 1, 2, 3]),
    modis: u16([2, 3, 4, 1]),
    viirs: u16([10, 20, 0, 0]),
  }]]),
};
const wk = (week, o) => ({ year: 2020, week, modis: null, viirs: null, pred: null,
  harmonized: null, lo: null, hi: null, status: "gap", nrt: false, ...o });
const calendar = { meta: { method: "model" }, weeks: [
  wk(1, { modis: 5, viirs: 30, pred: 28, harmonized: 30, status: "observed" }),
  wk(2, { modis: 4, pred: 20, harmonized: 20, lo: 10, hi: 40, status: "estimated" }),
  wk(3, { modis: 1, pred: 6, harmonized: 6, lo: 3, hi: 12, status: "estimated" }),
  wk(4, { modis: 0, pred: 1.5, harmonized: 1.5, lo: 0.8, hi: 3, status: "estimated" }),
  wk(5, {}),
  { ...wk(1, { modis: 0, viirs: 0, pred: 0, harmonized: 0, status: "observed" }), year: 2019 },
] };
const FULL = { cx0: 0, cy0: 0, cx1: 2, cy1: 1 };
const pick = (w) => [w.modis, w.viirs, w.harmonized, w.lo, w.hi, w.status];

describe("areaCalendar", () => {
  it("reproduces the regional calendar on the full grid", () => {
    const out = areaCalendar(cube, calendar, FULL).weeks;
    expect(pick(out[0])).toEqual([5, 30, 30, null, null, "observed"]);
    expect(pick(out[1])).toEqual([4, null, 20, 10, 40, "estimated"]);
    expect(pick(out[2])).toEqual([1, null, 6, 3, 12, "estimated"]);
    expect(pick(out[4])).toEqual([null, null, null, null, null, "gap"]);
  });
  it("gives 0 and factor false when the regional MODIS count is 0", () => {
    const w = areaCalendar(cube, calendar, FULL).weeks[3];
    expect(pick(w)).toEqual([0, null, 0, null, null, "estimated"]);
    expect(w.factor).toBe(false);
  });
  it("scales a single cell by the regional factor", () => {
    const out = areaCalendar(cube, calendar, { cx0: 0, cy0: 0, cx1: 0, cy1: 0 }).weeks;
    expect(pick(out[0])).toEqual([2, 10, 10, null, null, "observed"]);
    expect(pick(out[1])).toEqual([4, null, 20, 10, 40, "estimated"]);
    expect(pick(out[2])).toEqual([0, null, 0, 0, 0, "estimated"]);
    expect(out[2].factor).toBeUndefined();
  });
  it("reads cx and cy from the cell id", () => {
    const out = areaCalendar(cube, calendar, { cx0: 1, cy0: 1, cx1: 1, cy1: 1 }).weeks;
    expect(pick(out[0])).toEqual([3, 20, 20, null, null, "observed"]);
  });
  it("returns zeros for an empty area and for a year absent from the cube", () => {
    const out = areaCalendar(cube, calendar, { cx0: 2, cy0: 0, cx1: 2, cy1: 0 }).weeks;
    expect(pick(out[0])).toEqual([0, 0, 0, null, null, "observed"]);
    expect(pick(out[5])).toEqual([0, 0, 0, null, null, "observed"]);
  });
  it("rounds estimated values to one decimal and records the area", () => {
    const cal = { meta: {}, weeks: [wk(3, { modis: 3, pred: 10, harmonized: 10, lo: 5, hi: 20, status: "estimated" })] };
    const out = areaCalendar(cube, cal, { cx0: 2, cy0: 1, cx1: 2, cy1: 1 });
    expect(pick(out.weeks[0])).toEqual([1, null, 3.3, 1.7, 6.7, "estimated"]);
    expect(out.meta.aoi).toEqual({ cx0: 2, cy0: 1, cx1: 2, cy1: 1 });
  });
});

describe("cellsFromLonLat", () => {
  it("snaps two corners in any order", () => {
    const want = { cx0: 0, cy0: 0, cx1: 2, cy1: 1 };
    expect(cellsFromLonLat([-58.45, -22.45], [-58.21, -22.31], BBOX, 0.1, 45, 70)).toEqual(want);
    expect(cellsFromLonLat([-58.21, -22.31], [-58.45, -22.45], BBOX, 0.1, 45, 70)).toEqual(want);
  });
  it("clamps corners outside the region and on the far edge", () => {
    expect(cellsFromLonLat([-70, -30], [0, 0], BBOX, 0.1, 45, 70)).toEqual({ cx0: 0, cy0: 0, cx1: 44, cy1: 69 });
    expect(cellsFromLonLat([-54.0, -15.5], [-54.0, -15.5], BBOX, 0.1, 45, 70)).toEqual({ cx0: 44, cy0: 69, cx1: 44, cy1: 69 });
  });
});

describe("aoiBounds", () => {
  it("returns the outer edges of the cells", () => {
    const b = aoiBounds({ cx0: 0, cy0: 0, cx1: 2, cy1: 1 }, BBOX, 0.1);
    [-58.5, -22.5, -58.2, -22.3].forEach((v, i) => expect(b[i]).toBeCloseTo(v, 9));
  });
});

describe("area hash", () => {
  it("round-trips", () => {
    const aoi = { cx0: 1, cy0: 2, cx1: 3, cy1: 4 };
    expect(formatAoiHash(aoi)).toBe("#aoi=1,2,3,4");
    expect(parseAoiHash("#aoi=1,2,3,4", 45, 70)).toEqual(aoi);
  });
  it.each(["", "#outlook", "#aoi=1,2,3", "#aoi=3,4,1,2", "#aoi=0,0,45,0", "#aoi=0,0,0,70",
    "#aoi=-1,0,2,2", "#aoi=1.5,2,3,4", "#aoi=a,b,c,d", "#aoi=1,2,3,4,5"])(
    "ignores %s", (hash) => expect(parseAoiHash(hash, 45, 70)).toBeNull(),
  );
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/aoi.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/src/aoi.js`**

`areaCalendar` builds, once per cube year, two 52-length arrays of `M` and `V` by scanning the entries with `cx = cell % nx`, `cy = Math.floor(cell / nx)`. The module has no DOM or fetch access.

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/aoi.js web/src/aoi.test.js
git commit -m "feat(web): compute the calendar of a selected area"
```

---

### Task 6: Unusual weeks and critical period

**Files:**
- Create: `web/src/stats.js`
- Test: `web/src/stats.test.js`

**Interfaces:**
- Consumes: a calendar `{weeks}` (regional or area).
- Produces:
  - Constants `REF_FIRST = 2001`, `REF_LAST = 2025`, `MIN_REF = 10`, `UNUSUAL_P = 0.9`, `CRITICAL_SHARE = 0.8`, `MIN_YEARLY_MEAN = 100`.
  - `weekStats(calendar) -> Map<"year:week", {percentile: number | null, unusual: boolean, record: boolean}>`, one entry per week with a non-null `harmonized`.
  - `criticalPeriod(calendar) -> {start, end, share} | null` (weeks, inclusive).
  - `yearToDate(calendar, year, week) -> {value: number, percentile: number | null}`.
  - `isSufficient(calendar) -> boolean`.
  - `analyze(calendar) -> {sufficient, stats, critical}`; when not sufficient, `stats` is an empty Map and `critical` is null.

Definitions. Reference set of week `k` in year `y`: non-null `harmonized` of week `k` in years 2001-2025 except `y`. Percentile: share of reference values strictly below the value; null with fewer than 10 references. Unusual: percentile `>= 0.9` and value `> 0`. Record: percentile not null, value `> 0` and above every reference. Critical period: on the per-week mean over 2001-2025 (nulls skipped), the shortest contiguous run, no wrap, whose sum is `>= 0.8 * total - 1e-9`; earliest on ties; null when the total is 0. Year to date: sum of non-null `harmonized` over weeks `1..week`; the percentile compares it with the same sum in each reference year and is null with fewer than 10. Sufficient: the mean over 2001-2025 of each year's sum of non-null `harmonized` is `>= 100`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { weekStats, criticalPeriod, yearToDate, isSufficient, analyze } from "./stats.js";

// value(year, week) -> harmonized (null allowed), for 2001-2026 x 52 weeks
function mk(value) {
  const weeks = [];
  for (let year = 2001; year <= 2026; year++)
    for (let week = 1; week <= 52; week++)
      weeks.push({ year, week, harmonized: value(year, week), status: "observed" });
  return { weeks };
}

describe("weekStats", () => {
  const cal = mk((y, w) => (w === 30 ? (y === 2026 ? 100 : y - 2000) : 0));
  const s = weekStats(cal);
  it("ranks a week against the same week in the other years", () => {
    expect(s.get("2013:30")).toEqual({ percentile: 0.5, unusual: false, record: false });
    expect(s.get("2022:30").unusual).toBe(false); // 21 of 24 below
    expect(s.get("2023:30")).toEqual({ percentile: 22 / 24, unusual: true, record: false });
  });
  it("marks records, and scores 2026 against 2001-2025", () => {
    expect(s.get("2025:30")).toEqual({ percentile: 1, unusual: true, record: true });
    expect(s.get("2026:30")).toEqual({ percentile: 1, unusual: true, record: true });
  });
  it("never flags a zero", () => {
    expect(s.get("2020:5")).toEqual({ percentile: 0, unusual: false, record: false });
  });
  it("gives no percentile with fewer than 10 reference values", () => {
    const few = weekStats(mk((y, w) => (w === 7 && y > 2010 ? null : 5)));
    expect(few.get("2005:7")).toEqual({ percentile: null, unusual: false, record: false });
    expect(few.has("2015:7")).toBe(false);
  });
});

describe("criticalPeriod", () => {
  it("finds the shortest run holding 80% of the mean year", () => {
    const cal = mk((y, w) => ({ 30: 10, 31: 40, 32: 40, 33: 10 })[w] ?? 0);
    const c = criticalPeriod(cal);
    expect([c.start, c.end]).toEqual([31, 32]);
    expect(c.share).toBeCloseTo(0.8, 9);
  });
  it("takes the earliest run on a tie", () => {
    const c = criticalPeriod(mk(() => 1));
    expect([c.start, c.end]).toEqual([1, 42]);
  });
  it("ignores 2026 and returns null on a zero profile", () => {
    expect(criticalPeriod(mk((y) => (y === 2026 ? 9 : 0)))).toBeNull();
  });
});

describe("yearToDate", () => {
  it("compares the cumulative total with the other years", () => {
    const r = yearToDate(mk((y, w) => (w <= 3 ? y - 2000 : 0)), 2020, 3);
    expect(r).toEqual({ value: 60, percentile: 19 / 24 });
  });
  it("skips null weeks", () => {
    const r = yearToDate(mk((y, w) => (w === 2 ? null : 1)), 2020, 3);
    expect(r.value).toBe(2);
  });
});

describe("isSufficient and analyze", () => {
  it("needs a mean yearly total of at least 100", () => {
    expect(isSufficient(mk((y, w) => (w === 1 ? 99 : 0)))).toBe(false);
    expect(isSufficient(mk((y, w) => (w === 1 ? 100 : 0)))).toBe(true);
  });
  it("returns nothing to flag for a sparse area", () => {
    const a = analyze(mk((y, w) => (w === 1 && y === 2020 ? 50 : 0)));
    expect(a.sufficient).toBe(false);
    expect(a.stats.size).toBe(0);
    expect(a.critical).toBeNull();
  });
  it("returns stats and a critical period otherwise", () => {
    const a = analyze(mk((y, w) => (w === 30 ? 200 : 0)));
    expect(a.sufficient).toBe(true);
    expect([a.critical.start, a.critical.end]).toEqual([30, 30]);
    expect(a.stats.size).toBe(1352);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/stats.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/src/stats.js`**

Pure module, no imports beyond constants.

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/stats.js web/src/stats.test.js
git commit -m "feat(web): flag unusual weeks and the critical period"
```

---

### Task 7: CSV download

**Files:**
- Create: `web/src/csv.js`
- Test: `web/src/csv.test.js`

**Interfaces:**
- Consumes: a calendar; the `stats` Map from `analyze`; `aoiBounds` from Task 5.
- Produces:
  - `toCsv(calendar, stats) -> string`, header `year,week,week_start,modis,viirs,harmonized,lo,hi,status,percentile,unusual`, `\n` line ends, trailing newline, empty field for null or absent.
  - `csvFileName(bounds) -> string`, `fire-calendar_<lonMin>_<latMin>_<lonMax>_<latMax>.csv` with one decimal each.
  - `downloadCsv(name, text) -> void` (Blob and a temporary `<a download>`; browser only, not unit tested).

`week_start` is the UTC date `YYYY-MM-DD` of 1 January plus `7 * (week - 1)` days. `percentile` is `Number(p.toFixed(3))`. `unusual` is `true` or `false`, empty when the week has no stats entry or a null percentile.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { toCsv, csvFileName } from "./csv.js";

const base = { nrt: false, pred: null };
const calendar = { weeks: [
  { ...base, year: 2020, week: 1, modis: 5, viirs: 30, harmonized: 30, lo: null, hi: null, status: "observed" },
  { ...base, year: 2020, week: 2, modis: 4, viirs: null, harmonized: 20.5, lo: 10, hi: 40, status: "estimated" },
  { ...base, year: 2020, week: 5, modis: null, viirs: null, harmonized: null, lo: null, hi: null, status: "gap" },
  { ...base, year: 2024, week: 52, modis: 0, viirs: 0, harmonized: 0, lo: null, hi: null, status: "observed" },
] };
const stats = new Map([
  ["2020:1", { percentile: 22 / 24, unusual: true, record: false }],
  ["2020:2", { percentile: 0.5, unusual: false, record: false }],
  ["2024:52", { percentile: null, unusual: false, record: false }],
]);

describe("toCsv", () => {
  it("writes one row per week with empty fields for nulls", () => {
    expect(toCsv(calendar, stats)).toBe(
      "year,week,week_start,modis,viirs,harmonized,lo,hi,status,percentile,unusual\n" +
        "2020,1,2020-01-01,5,30,30,,,observed,0.917,true\n" +
        "2020,2,2020-01-08,4,,20.5,10,40,estimated,0.5,false\n" +
        "2020,5,2020-01-29,,,,,,gap,,\n" +
        "2024,52,2024-12-23,0,0,0,,,observed,,\n",
    );
  });
  it("works without stats", () => {
    expect(toCsv({ weeks: [calendar.weeks[0]] }, new Map()).split("\n")[1]).toBe(
      "2020,1,2020-01-01,5,30,30,,,observed,,",
    );
  });
});

describe("csvFileName", () => {
  it("carries the bounds with one decimal", () => {
    expect(csvFileName([-58.5, -22.5, -54, -15.5])).toBe("fire-calendar_-58.5_-22.5_-54.0_-15.5.csv");
    expect(csvFileName([-58.5, -22.5, -58.2, -22.299999999])).toBe("fire-calendar_-58.5_-22.5_-58.2_-22.3.csv");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/csv.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/src/csv.js`**

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/csv.js web/src/csv.test.js
git commit -m "feat(web): export the active calendar as csv"
```

---

### Task 8: Heatmap and yearly chart accept a new calendar

**Files:**
- Modify: `web/src/heatmap.js`, `web/src/yearly.js`

**Interfaces:**
- Consumes: the `{stats, critical, sufficient}` object from `analyze` (Task 6).
- Produces:
  - `createHeatmap(canvas, calendar, {onSelect, onHover})` returns, in addition to today's members, `setCalendar(calendar, analysis)`; `max` becomes a getter that follows the active calendar; `onHover` receives a fourth argument, the week's stats entry or `undefined`.
  - `createYearly(canvas, totals, {onSelect})` returns, in addition, `setTotals(totals)`, which recomputes the ticks and redraws and keeps the selected year.

Drawing decisions:
- Unusual week: a white filled triangle in the cell's top-right corner, legs `min(4, cell height - 2)` px.
- Record week: the triangle plus a 1 px white inner border.
- Critical period: a 2 px bar in `#ffb347` along the bottom of the month-axis strip, from the left edge of week `start` to the right edge of week `end`.
- With `analysis.sufficient` false, or no analysis, none of the three is drawn.

The canvas code has no unit tests (vitest runs in node). It is verified by the build here and by the manual checks of Task 10.

- [ ] **Step 1: Implement `setCalendar`, the getter and the markers in `web/src/heatmap.js`**

Move the grid, the years list and `max` into a function that both `createHeatmap` and `setCalendar` call. The selection survives a calendar change.

- [ ] **Step 2: Implement `setTotals` in `web/src/yearly.js`**

- [ ] **Step 3: Verify**

Run: `cd web && npm test && npm run build`
Expected: both pass; the app behaves as before (nothing calls the new methods yet).

- [ ] **Step 4: Commit**

```bash
git add web/src/heatmap.js web/src/yearly.js
git commit -m "feat(web): let the charts swap calendars and mark weeks"
```

---

### Task 9: Area outline and drag selection on the globe

**Files:**
- Modify: `web/src/globe.js`

**Interfaces:**
- Produces, on the object returned by `createGlobe(container, {onHover, onClick, onAreaDrag, onAreaSelect})`:
  - `setAoi(bounds | null)`, `bounds = [lonMin, latMin, lonMax, latMax]`; draws a `PathLayer` with id `aoi`, color `[255, 255, 255, 230]`, `widthMinPixels: 2`, built with the module's existing `densify`, above the fire layers. Shown in past mode only.
  - `setSelecting(on: boolean)`; while on, the deck `controller` is `false` and the cursor is `crosshair`.
  - `onAreaDrag(a, b)` during a drag and `onAreaSelect(a, b)` at its end, with `a` and `b` the `[lon, lat]` of the drag's start and current point.

Rules: drags are read from the Deck props `onDragStart`, `onDrag`, `onDragEnd`, and only while selecting in past mode. The coordinate is `info.coordinate`; if deck.gl leaves it undefined under `GlobeView`, use `info.viewport.unproject([info.x, info.y])`. If the start or the end has no finite coordinate (pointer off the globe), the drag is cancelled: no `onAreaSelect` call. The globe does not snap or clamp; the caller does. Switching to outlook mode turns selecting off.

- [ ] **Step 1: Implement `setAoi`, `setSelecting` and the drag callbacks**

- [ ] **Step 2: Verify the build**

Run: `cd web && npm test && npm run build`
Expected: both pass.

- [ ] **Step 3: Verify in the browser with a temporary hook**

Run `npm run dev`, and in the console of the page call the globe through a temporary `window.__globe = globe` line added in `main.js` (remove it before committing): `__globe.setAoi([-57, -19, -56, -18])` draws a white rectangle; `__globe.setSelecting(true)` makes a drag log two `[lon, lat]` pairs via a temporary `onAreaSelect: console.log`, without rotating the globe; a drag that starts off the globe logs nothing.

- [ ] **Step 4: Commit**

```bash
git add web/src/globe.js
git commit -m "feat(web): draw and drag a selection area on the globe"
```

---

### Task 10: Wire the area into the app

**Files:**
- Modify: `web/src/main.js`, `web/index.html`, `web/src/style.css`
- Test: `web/src/realdata.test.js` (create)

**Interfaces:**
- Consumes: `loadCube` (Task 4); `areaCalendar`, `cellsFromLonLat`, `aoiBounds`, `parseAoiHash`, `formatAoiHash` (Task 5); `analyze`, `yearToDate` (Task 6); `toCsv`, `csvFileName`, `downloadCsv` (Task 7); `heat.setCalendar`, `yearly.setTotals` (Task 8); `globe.setAoi`, `globe.setSelecting`, `onAreaDrag`, `onAreaSelect` (Task 9); the real cube (Task 3).
- Produces: the finished feature.

State: `state.aoi` (area or null) and `state.selecting`. A module-level `active = {calendar, analysis}` replaces every read of `data.calendar` for the heatmap, yearly totals, readout, sonification and the start-up peak search. `data.calendar` stays the regional calendar.

Markup, in the left panel under the layer chips:

```html
<div class="row">
  <button type="button" class="btn" id="aoi-select" aria-pressed="false">Select area</button>
  <button type="button" class="btn" id="aoi-clear" hidden>Whole region</button>
  <button type="button" class="btn" id="csv">Download CSV</button>
</div>
<p class="hint" id="aoi-label">Whole region</p>
<p class="hint" id="aoi-assume" hidden>
  Area values use each week's regional MODIS to VIIRS conversion.
</p>
<p class="hint warn" id="aoi-note" hidden></p>
```

In the readout, after `.nums`: `<p class="extra" id="r-extra"></p>`. In the calendar dock head, after the legend paragraph: `<p class="view-calendar" id="critical"></p>`.

Copy:
- `#aoi-label` with an area: `Area: <lonMin> to <lonMax>, <latMin> to <latMax>` (one decimal); otherwise `Whole region`.
- `#r-extra`, parts joined by ` · `: `range <lo>-<hi> (regional conversion only)` on estimated weeks with a band; `record for this week` or `unusual: above <N>% of other years` (`N = Math.round(percentile * 100)`); `<year> to date: <value>, above <N>% of other years` when the year-to-date percentile is not null; `no regional MODIS count this week` when `factor` is false.
- `#critical`: `Critical period: weeks <start>-<end> (<Mon D> - <Mon D>), <N>% of a typical year` with the dates of a non-leap year; when not sufficient, `Not enough detections in this area`.
- With an area active, `#h-ev-label` and `#h-unmatched-label` end with ` (whole region)`.
- `#aoi-note` on a cube failure: `Could not load the area data: <message>`.
- The heatmap tooltip gains the range line on estimated weeks and the unusual or record line.

Behavior:
- `setAoi(aoi)`: stop playback and sound first; with null use the regional calendar; otherwise `await loadCube()`, then `areaCalendar`. Then `analyze`, `heat.setCalendar`, `yearly.setTotals(yearlyTotals(...))`, the readout, the labels, `globe.setAoi(bounds or null)`, and the URL (`history.replaceState` with `formatAoiHash`, or the hash removed; a `#outlook` hash is left alone). On a `loadCube` failure show `#aoi-note`, then fall back to `setAoi(null)`. A stale result (the area changed while the cube was loading) is discarded.
- `#aoi-select` toggles `state.selecting`, `globe.setSelecting` and `aria-pressed`. `onAreaDrag` previews with `globe.setAoi(aoiBounds(cellsFromLonLat(...)))`. `onAreaSelect` calls `setAoi(cellsFromLonLat(...))` and turns selecting off.
- `#aoi-clear` (shown only with an area) calls `setAoi(null)`.
- `#csv` downloads `toCsv(active.calendar, active.analysis.stats)` under `csvFileName(bounds)`; the bounds are the area's, or the bbox for the whole region.
- On start, after the charts exist: `parseAoiHash(location.hash, 45, 70)`, and `setAoi` when it is not null.
- Entering outlook mode turns selecting off.

- [ ] **Step 1: Write the failing real-data test `web/src/realdata.test.js`**

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeCube } from "./data.js";
import { areaCalendar } from "./aoi.js";

const root = new URL("../public/data/", import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const calendar = json("calendar.json");
const index = json("cube/index.json");
const years = new Map(
  Object.keys(index.years).map((y) => {
    const b = readFileSync(new URL(`cube/${y}.bin`, root));
    return [Number(y), decodeCube(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))];
  }),
);
const cube = { nx: index.nx, ny: index.ny, years };

describe("published export", () => {
  it("full-grid area equals the regional calendar", () => {
    const full = { cx0: 0, cy0: 0, cx1: index.nx - 1, cy1: index.ny - 1 };
    const out = areaCalendar(cube, calendar, full).weeks;
    expect(out.length).toBe(1352);
    calendar.weeks.forEach((w, i) => {
      const a = out[i];
      expect([a.year, a.week, a.modis, a.viirs, a.status]).toEqual([w.year, w.week, w.modis, w.viirs, w.status]);
      if (a.factor === false) return;
      expect(a.harmonized).toBe(w.harmonized);
      expect([a.lo, a.hi]).toEqual([w.lo, w.hi]);
    });
  });
  it("has few weeks without a regional factor", () => {
    const n = calendar.weeks.filter((w) => w.status === "estimated" && !w.modis).length;
    console.log("estimated weeks with no regional MODIS count:", n);
    expect(n).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd web && npx vitest run src/realdata.test.js`
Expected: PASS if Tasks 3-5 are in; a failure here is a real defect in the cube or in `areaCalendar` and must be fixed in the owning module, not in the test. Report the logged count in the task summary.

- [ ] **Step 3: Implement the markup, styles and wiring**

- [ ] **Step 4: Run the automated checks**

Run: `cd web && npm test && npm run build`
Expected: both pass.

- [ ] **Step 5: Manual checks in the browser (`npm run dev`)**

1. Select area, drag a rectangle over the north of the box: the outline snaps to the grid; calendar, yearly chart, readout and label change; the URL shows `#aoi=...`.
2. Reload: the same area comes back. Open `#aoi=3,4,1,2`: the whole region loads, no error in the console.
3. Hover an estimated week (any week of 2005): the tooltip shows a range. Hover a peak week of 2020: it shows unusual or record.
4. The critical-period bar and text are present and plausible (dry season, roughly July to October).
5. Select a one-cell area in a corner with no fires: `Not enough detections in this area`, no markers, Download CSV still produces a file with 1352 rows.
6. Press Hear, then change the area while it sounds: the sound stops and the calendar swaps.
7. Whole region restores the first view and removes the hash. Outlook mode still works.
8. Block `cube/2020.bin` in the browser's network tools and select an area: the note appears and the regional calendar stays.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/src/main.js web/src/style.css web/src/realdata.test.js
git commit -m "feat(web): select an area and see its calendar"
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.md`, `docs/pitch-script.md`, `docs/slides-outline.md`

**Interfaces:**
- Consumes: the behavior of Tasks 1-10; the measured cube size (Task 3) and the no-factor week count (Task 10).

- [ ] **Step 1: Update `README.md`**

- "What you get": area of interest; unusual weeks and critical period with their exact rules (percentile at or above 90% against the same week in the other years of 2001-2025; shortest run of weeks with 80% of a typical year); uncertainty range; CSV; `cube/` in the file list.
- "Method": the cube, the area rule (observed weeks are the area's own VIIRS count; estimated weeks are the area's MODIS count times that week's regional factor), and the band (10th to 90th percentile of observed over predicted in the held-out years).
- "Limitations": the conversion factor is regional and uniform in space; the band covers the regional conversion only, not the extra noise of a small area; the area is a grid-aligned rectangle; areas with a mean below 100 detections a year get no unusual-week analysis.
- "Project structure": `aoi.js`, `stats.js`, `csv.js`.

Every number written must come from `web/public/data/` or from a test output, never from memory.

- [ ] **Step 2: Add the area beat to `docs/pitch-script.md` and `docs/slides-outline.md`**

One row or bullet each, in the documents' existing format: select an area on the globe, the calendar and unusual weeks follow, download the CSV. State the uniform-factor assumption in one clause. Do not change the existing claims or numbers.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/pitch-script.md docs/slides-outline.md
git commit -m "docs(docs): document area selection and unusual weeks"
```

---

### Task 12: Dim the points outside the area (drop first if time runs out)

**Files:**
- Modify: `web/src/globe.js`

**Interfaces:**
- Consumes: `setAoi(bounds)` from Task 9; `buildColors(points, show, category)`.
- Produces: with an area set, points whose `lon`/`lat` fall outside the bounds are drawn at 25% of their alpha. No API change.

- [ ] **Step 1: Write the failing test in `web/src/globe.test.js`**

Export `buildColors` and give it a fourth parameter `bounds` (default null).

```js
import { describe, it, expect } from "vitest";
import { buildColors } from "./globe.js";

describe("buildColors", () => {
  const points = { n: 2, flags: Uint8Array.from([0, 0]),
    lon: Float32Array.from([-57.5, -55.0]), lat: Float32Array.from([-18.5, -18.5]) };
  const show = { modis: true, viirs: true, ghostOnly: false };
  it("keeps alpha without an area and dims outside one", () => {
    const plain = buildColors(points, show, "modis");
    expect([plain[3], plain[7]]).toEqual([255, 255]);
    const dim = buildColors(points, show, "modis", [-58, -19, -57, -18]);
    expect([dim[3], dim[7]]).toEqual([255, 64]);
  });
});
```

If importing `globe.js` in node fails because deck.gl needs a browser, move `buildColors` and its constants into a new `web/src/colors.js`, import it from `globe.js`, and point the test there.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/globe.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`setAoi` stores the bounds and clears `cache.colorKey`; the color key includes the bounds.

- [ ] **Step 4: Verify**

Run: `cd web && npm test && npm run build`, then check in the browser that points outside a selected area are fainter.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): dim detections outside the selected area"
```

---

## After the last task

- Opus reviews the whole branch against the spec and this plan.
- Open one PR from `feat/area-of-interest-calendar`; the title is a Conventional Commit, for example `feat(web): add area of interest, unusual weeks and critical period`.
- Not in this plan (people, not code): confirm the sources for the MODIS end dates and for INPE's reference satellite before the pitch; record the video; tag `v1.0.0`; submit.
