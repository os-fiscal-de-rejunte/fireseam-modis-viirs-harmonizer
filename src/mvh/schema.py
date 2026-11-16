"""Validator for the static export consumed by the web demo."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from mvh import config

_WEEK_KEYS = (
    "year",
    "week",
    "modis",
    "viirs",
    "pred",
    "lo",
    "hi",
    "harmonized",
    "status",
    "nrt",
    "why",
)
_WHY_CODES = ("pre_viirs", "viirs_outage", "modis_outage", "not_downloaded")
_N_WEEKS = (config.YEAR_END - config.YEAR_START + 1) * config.WEEKS_PER_YEAR


def _fail(msg: str) -> None:
    raise ValueError(msg)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def _load(path: Path):
    if not path.is_file():
        _fail(f"{path.name}: file is missing")

    def reject(token):
        _fail(f"{path.name}: non-finite number {token} is not valid JSON")

    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject)
    except json.JSONDecodeError as exc:
        _fail(f"{path.name}: invalid JSON ({exc})")


def _check_calendar(cal) -> str:
    name = "calendar.json"
    if not isinstance(cal, dict) or not isinstance(cal.get("meta"), dict):
        _fail(f"{name}: meta must be an object")
    meta = cal["meta"]
    if meta.get("bbox") != list(config.BBOX):
        _fail(f"{name}: meta.bbox must equal {list(config.BBOX)}")
    if meta.get("cell_deg") != config.CELL_DEG:
        _fail(f"{name}: meta.cell_deg must equal {config.CELL_DEG}")
    if meta.get("method") not in ("model", "baseline"):
        _fail(f"{name}: meta.method must be 'model' or 'baseline'")
    if meta.get("coverage") != config.coverage_meta():
        _fail(f"{name}: meta.coverage does not match config.COVERAGE")
    if meta.get("region") != config.REGION_ID:
        _fail(f"{name}: meta.region must equal {config.REGION_ID!r}")
    if (meta.get("nx"), meta.get("ny")) != (config.NX, config.NY):
        _fail(f"{name}: meta.nx, meta.ny must equal {config.NX}, {config.NY}")

    weeks = cal.get("weeks")
    if not isinstance(weeks, list) or len(weeks) != _N_WEEKS:
        _fail(f"{name}: weeks must be a list of {_N_WEEKS} entries")
    expected = iter(
        (y, w)
        for y in range(config.YEAR_START, config.YEAR_END + 1)
        for w in range(1, config.WEEKS_PER_YEAR + 1)
    )
    statuses: list[tuple[int, int, str]] = []
    for i, wk in enumerate(weeks):
        at = f"{name}: weeks[{i}]"
        if not isinstance(wk, dict):
            _fail(f"{at} must be an object")
        year, week = next(expected)
        missing = [k for k in _WEEK_KEYS if k not in wk]
        if missing:
            _fail(f"{at} is missing {missing}")
        if not (_is_int(wk["year"]) and _is_int(wk["week"])) or (wk["year"], wk["week"]) != (
            year,
            week,
        ):
            _fail(f"{at} must be year {year} week {week}")
        for key in ("modis", "viirs"):
            v = wk.get(key)
            if v is not None and not (_is_int(v) and v >= 0):
                _fail(f"{at}.{key} must be int >= 0 or null")
        for key in ("pred", "harmonized"):
            v = wk.get(key)
            if v is not None and not (_is_num(v) and v >= 0):
                _fail(f"{at}.{key} must be number >= 0 or null")
        if not isinstance(wk.get("nrt"), bool):
            _fail(f"{at}.nrt must be bool")
        viirs, pred = wk["viirs"], wk["pred"]
        terra, aqua, snpp = (config.sat_covers(x, year, week) for x in ("Terra", "Aqua", "SNPP"))
        if (wk["modis"] is None) == (terra or aqua):
            _fail(f"{at}.modis must be null iff neither Terra nor Aqua covers the week")
        if (viirs is None) == snpp:
            _fail(f"{at}.viirs must be null iff SNPP does not cover the week")
        if (pred is None) == terra:
            _fail(f"{at}.pred must be null iff Terra does not cover the week")
        if viirs is not None and not _is_int(wk["harmonized"]):
            _fail(f"{at}.harmonized must be an int when viirs is observed")
        want_h = viirs if viirs is not None else pred
        if wk["harmonized"] != want_h:
            _fail(f"{at}.harmonized must equal viirs, else pred, else null")
        status = "observed" if viirs is not None else "estimated" if pred is not None else "gap"
        if wk.get("status") != status:
            _fail(f"{at}.status must be {status!r}")
        lo, hi = wk["lo"], wk["hi"]
        if status != "estimated":
            if lo is not None or hi is not None:
                _fail(f"{at}: lo and hi must be null unless status is 'estimated'")
        elif not (_is_num(lo) and _is_num(hi) and lo >= 0 and hi >= 0):
            _fail(f"{at}: lo and hi must be numbers >= 0 when status is 'estimated'")
        elif lo > hi:
            _fail(f"{at}: lo must be <= hi")
        why = wk["why"]
        if (why is None) != (status == "observed"):
            _fail(f"{at}.why must be null iff status is 'observed'")
        if why is not None and why not in _WHY_CODES:
            _fail(f"{at}.why must be one of {list(_WHY_CODES)}")
        if why != config.why_code(status, year, week):
            _fail(f"{at}.why must be {config.why_code(status, year, week)!r}")
        statuses.append((year, week, status))
    if meta.get("as_of") != config.as_of_date(statuses):
        _fail(f"{name}: meta.as_of must be the end of the last non-gap week")
    return meta["method"]


def _check_points(root: Path) -> None:
    index = _load(root / "points" / "index.json")
    name = "points/index.json"
    if not isinstance(index, dict):
        _fail(f"{name}: must be an object keyed by year")
    for key, entry in index.items():
        at = f"{name}: [{key!r}]"
        if key not in {str(y) for y in range(config.YEAR_START, config.YEAR_END + 1)}:
            _fail(f"{at} key must be a year in {config.YEAR_START}..{config.YEAR_END}")
        if not isinstance(entry, dict) or not (_is_int(entry.get("n")) and entry["n"] >= 0):
            _fail(f"{at}.n must be int >= 0")
        n, ws = entry["n"], entry.get("week_start")
        if (
            not isinstance(ws, list)
            or len(ws) != config.WEEKS_PER_YEAR
            or not all(_is_int(v) for v in ws)
        ):
            _fail(f"{at}.week_start must be {config.WEEKS_PER_YEAR} ints")
        if ws[0] != 0 or any(a > b for a, b in zip(ws, ws[1:], strict=False)) or ws[-1] > n:
            _fail(f"{at}.week_start must start at 0, be non-decreasing and <= n")

        bin_path = root / "points" / f"{key}.bin"
        if not bin_path.is_file():
            _fail(f"points/{key}.bin: file is missing")
        if bin_path.stat().st_size != 8 * n:
            _fail(f"points/{key}.bin: size must be {8 * n} bytes (8 * n)")
        doy = np.fromfile(bin_path, dtype="<u2", count=n, offset=4 * n)
        if n and (doy.min() < 1 or doy.max() > 366 or np.any(np.diff(doy.astype(np.int32)) < 0)):
            _fail(f"points/{key}.bin: doy must be sorted within 1..366")
        week_of_doy = np.minimum((doy.astype(np.int32) - 1) // 7 + 1, config.WEEKS_PER_YEAR)
        want = np.searchsorted(week_of_doy, np.arange(1, config.WEEKS_PER_YEAR + 1)).tolist()
        if ws != want:
            _fail(f"{at}.week_start does not match the doy block of points/{key}.bin")
    for path in (root / "points").glob("*.bin"):
        if path.stem not in index:
            _fail(f"points/{path.name}: not listed in points/index.json")


def _check_cube(root: Path, cal: dict) -> None:
    index = _load(root / "cube" / "index.json")
    name = "cube/index.json"
    if not isinstance(index, dict) or (index.get("nx"), index.get("ny")) != (
        config.NX,
        config.NY,
    ):
        _fail(f"{name}: nx, ny must equal {config.NX}, {config.NY}")
    years = index.get("years")
    if not isinstance(years, dict):
        _fail(f"{name}: years must be an object keyed by year")
    n_cells = config.NX * config.NY
    valid = {str(y) for y in range(config.YEAR_START, config.YEAR_END + 1)}
    sums: dict[tuple[int, int], tuple[int, int]] = {}
    for key, entry in years.items():
        at = f"{name}: years[{key!r}]"
        if key not in valid:
            _fail(f"{at} key must be a year in {config.YEAR_START}..{config.YEAR_END}")
        if not isinstance(entry, dict) or not (_is_int(entry.get("n")) and entry["n"] >= 0):
            _fail(f"{at}.n must be int >= 0")
        n = entry["n"]
        bin_path = root / "cube" / f"{key}.bin"
        if not bin_path.is_file():
            _fail(f"cube/{key}.bin: file is missing")
        if bin_path.stat().st_size != 7 * n:
            _fail(f"cube/{key}.bin: size must be {7 * n} bytes (7 * n)")
        cell = np.fromfile(bin_path, dtype="<u2", count=n, offset=0).astype(np.int64)
        week = np.fromfile(bin_path, dtype="u1", count=n, offset=2 * n).astype(np.int64)
        modis = np.fromfile(bin_path, dtype="<u2", count=n, offset=3 * n).astype(np.int64)
        viirs = np.fromfile(bin_path, dtype="<u2", count=n, offset=5 * n).astype(np.int64)
        if n and cell.max() >= n_cells:
            _fail(f"cube/{key}.bin: cell must be below {n_cells}")
        if n and (week.min() < 1 or week.max() > config.WEEKS_PER_YEAR):
            _fail(f"cube/{key}.bin: week must be within 1..{config.WEEKS_PER_YEAR}")
        if np.any(np.diff(week * 65536 + cell) <= 0):
            _fail(f"cube/{key}.bin: entries must be sorted by week then cell and unique")
        if np.any(modis + viirs <= 0):
            _fail(f"cube/{key}.bin: every entry needs a count above zero")
        for w in range(1, config.WEEKS_PER_YEAR + 1):
            sel = week == w
            sums[(int(key), w)] = (int(modis[sel].sum()), int(viirs[sel].sum()))
    for wk in cal["weeks"]:
        got = sums.get((wk["year"], wk["week"]), (0, 0))
        for i, sensor in enumerate(("modis", "viirs")):
            want = wk[sensor]
            if want is not None and got[i] != want:
                _fail(
                    f"cube: {sensor} sum of {wk['year']} week {wk['week']} is {got[i]}, "
                    f"calendar has {want}"
                )
    for path in (root / "cube").glob("*.bin"):
        if path.stem not in years:
            _fail(f"cube/{path.name}: not listed in cube/index.json")


def _check_metrics(metrics, method: str, light: bool = False) -> None:
    name = "metrics.json"

    def need(obj, key, kind, at):
        if not isinstance(obj, dict) or key not in obj:
            _fail(f"{name}: {at}.{key} is missing")
        v = obj[key]
        ok = {
            "num": _is_num(v),
            "int": _is_int(v),
            "bool": isinstance(v, bool),
            "str": isinstance(v, str),
            "list": isinstance(v, list),
            "obj": isinstance(v, dict),
            "frac": _is_num(v) and 0 <= v <= 1,
        }[kind]
        if not ok:
            _fail(f"{name}: {at}.{key} must be of type {kind}")
        return v

    need(metrics, "method", "str", "root")
    if metrics["method"] != method:
        _fail(f"{name}: method must equal calendar.json meta.method ({method!r})")
    if need(metrics, "accepted", "bool", "root") != (method == "model"):
        _fail(f"{name}: accepted must be true iff method == 'model'")

    wt = need(metrics, "weekly_total", "obj", "root")
    for k in ("mae_model", "mae_baseline"):
        need(wt, k, "num", "weekly_total")
    for k in ("years_won", "years"):
        need(wt, k, "int", "weekly_total")

    for i, row in enumerate(need(metrics, "by_year", "list", "root")):
        need(row, "year", "int", f"by_year[{i}]")
        for k in ("mae_model", "mae_baseline", "ratio_raw"):
            need(row, k, "num", f"by_year[{i}]")

    to = need(metrics, "terra_only", "obj", "root")
    need(to, "accepted", "bool", "terra_only")
    for k in ("mae_model", "mae_baseline"):
        need(to, k, "num", "terra_only")
    for k in ("years_won", "years"):
        need(to, k, "int", "terra_only")

    if not light:
        for i, row in enumerate(need(metrics, "events", "list", "root")):
            for k in ("year", "modis", "viirs"):
                need(row, k, "int", f"events[{i}]")

        pr = need(metrics, "pairing", "obj", "root")
        need(pr, "radius_km", "num", "pairing")
        need(pr, "window_min", "int", "pairing")
        hy = need(pr, "headline_years", "list", "pairing")
        if len(hy) != 2 or not all(_is_int(v) for v in hy):
            _fail(f"{name}: pairing.headline_years must be two ints")
        for i, row in enumerate(need(pr, "by_year", "list", "pairing")):
            at = f"pairing.by_year[{i}]"
            for k in ("year", "aqua_n", "viirs_n", "dt_p50_min"):
                need(row, k, "int", at)
            for k in ("aqua_unmatched", "viirs_unmatched"):
                need(row, k, "frac", at)

    unc = need(metrics, "uncertainty", "obj", "root")
    for mode in ("full", "terra"):
        band = need(unc, mode, "obj", "uncertainty")
        for k in ("q10", "q90"):
            need(band, k, "num", f"uncertainty.{mode}")

    dropped = need(need(metrics, "filters", "obj", "root"), "dropped_type", "obj", "filters")
    for k in ("modis", "viirs"):
        need(dropped, k, "int", "filters.dropped_type")


def validate_export(root: Path, light: bool = False) -> None:
    root = Path(root)
    cal = _load(root / "calendar.json")
    method = _check_calendar(cal)
    if not light:
        _check_points(root)
    _check_cube(root, cal)
    _check_metrics(_load(root / "metrics.json"), method, light)
