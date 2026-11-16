"""regions.json: the index of regions the browser reads, with each region's acceptance state."""

from __future__ import annotations

import json
from pathlib import Path

from mvh import regions

MIN_YEARS_SCORED = 14
REF_FIRST, REF_LAST = 2001, 2025
WEEKS = 52
CRITICAL_SHARE = 0.8
_LAST_SEVEN = (
    "as_of",
    "method",
    "accepted",
    "terra_accepted",
    "weekly_total",
    "years_scored",
    "season_wraps",
)


def critical_period(weeks: list[dict]) -> tuple[int, int] | None:
    """Shortest run of weeks (no wrap) holding 80% of the mean yearly total; earliest on ties."""
    sums = [0.0] * (WEEKS + 1)
    counts = [0] * (WEEKS + 1)
    for w in weeks:
        value = w.get("harmonized")
        if value is None or not REF_FIRST <= w["year"] <= REF_LAST:
            continue
        sums[w["week"]] += value
        counts[w["week"]] += 1
    mean = [s / n if n else 0.0 for s, n in zip(sums, counts, strict=True)]
    total = sum(mean)
    if not total > 0:
        return None
    target = CRITICAL_SHARE * total - 1e-9
    best = None
    for start in range(1, WEEKS + 1):
        acc = 0.0
        for end in range(start, WEEKS + 1):
            acc += mean[end]
            if acc >= target:
                if best is None or end - start < best[1] - best[0]:
                    best = (start, end)
                break
    return best


def season_wraps(weeks: list[dict]) -> bool:
    period = critical_period(weeks)
    return period is not None and (period[0] == 1 or period[1] == WEEKS)


def acceptance_state(accepted: bool, years_scored: int) -> str:
    if years_scored < MIN_YEARS_SCORED:
        return "not_validated"
    return "accepted" if accepted else "baseline"


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _row(data_root: Path, region: regions.Region, path: str) -> dict:
    base = data_root if path == "." else data_root / path
    nx, ny = regions.grid_size(region)
    row = {
        "id": region.id,
        "name": region.name,
        "bbox": list(region.bbox),
        "nx": nx,
        "ny": ny,
        "path": path,
    }
    calendar_path = base / "calendar.json"
    if not calendar_path.is_file():
        return {**row, "status": "no_data", "has": [], **dict.fromkeys(_LAST_SEVEN)}
    calendar = _load(calendar_path)
    metrics = _load(base / "metrics.json")
    meta = calendar["meta"]
    has = []
    if (base / "points" / "index.json").is_file():
        has.append("points")
    has += [k for k in ("events", "pairing") if k in metrics]
    if (base / "forecast.json").is_file():
        has.append("forecast")
    return {
        **row,
        "status": "ok",
        "has": has,
        "as_of": meta["as_of"],
        "method": metrics["method"],
        "accepted": metrics["accepted"],
        "terra_accepted": metrics["terra_only"]["accepted"],
        "weekly_total": metrics["weekly_total"],
        "years_scored": metrics["weekly_total"]["years"],
        "season_wraps": season_wraps(calendar["weeks"]),
    }


def build(data_root: Path) -> list[dict]:
    data_root = Path(data_root)
    rows = [
        _row(data_root, r, "." if r.id == "pantanal" else f"regions/{r.id}")
        for r in regions.REGIONS.values()
    ]
    if (data_root / "regions" / "synthetic" / "calendar.json").is_file():
        rows.append(_row(data_root, regions.SYNTHETIC, "regions/synthetic"))
    return rows


def write(data_root: Path) -> None:
    text = json.dumps(build(data_root), separators=(",", ":")) + "\n"
    (Path(data_root) / "regions.json").write_bytes(text.encode("utf-8"))


def validate(data_root: Path) -> None:
    data_root = Path(data_root)
    for row in _load(data_root / "regions.json"):
        if row["status"] != "ok":
            continue
        rid = row["id"]
        base = data_root if row["path"] == "." else data_root / row["path"]
        metrics = _load(base / "metrics.json")
        has = set(row["has"])
        exists = {
            "points": (base / "points" / "index.json").is_file(),
            "events": "events" in metrics,
            "pairing": "pairing" in metrics,
            "forecast": (base / "forecast.json").is_file(),
        }
        files = {"points": "points/index.json", "forecast": "forecast.json"}
        for name, present in exists.items():
            source = files.get(name, f"{name} in metrics.json")
            if name in has and not present:
                raise ValueError(f"regions.json: {rid}.has lists '{name}' but {source} is missing")
            if present and name not in has:
                raise ValueError(f"regions.json: {rid}.has omits '{name}' but {source} exists")
        expected = {
            "accepted": metrics["accepted"],
            "method": metrics["method"],
            "weekly_total": metrics["weekly_total"],
            "terra_accepted": metrics["terra_only"]["accepted"],
            "years_scored": metrics["weekly_total"]["years"],
        }
        for field, value in expected.items():
            if row[field] != value:
                raise ValueError(f"regions.json: {rid}.{field} must equal metrics.json")
        cube = _load(base / "cube" / "index.json")
        if (row["nx"], row["ny"]) != (cube["nx"], cube["ny"]):
            raise ValueError(f"regions.json: {rid}.nx, ny must equal cube/index.json")
        if row["as_of"] != _load(base / "calendar.json")["meta"]["as_of"]:
            raise ValueError(f"regions.json: {rid}.as_of must equal calendar.json")
