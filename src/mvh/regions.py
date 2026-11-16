"""Registry of the regions of interest and the grid rules. Imports nothing from the pipeline."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

CELL_DEG = 0.1
MAX_CELLS = 65536
BUDGET_CELLS = 12600
_EDGES = ("lon_min", "lat_min", "lon_max", "lat_max")


@dataclass(frozen=True)
class Region:
    id: str
    name: str
    bbox: tuple[float, float, float, float]  # lon_min, lat_min, lon_max, lat_max
    raw: str  # sub-folder of the raw root
    light: bool


REGIONS: dict[str, Region] = {
    r.id: r
    for r in (
        Region("pantanal", "Pantanal", (-58.5, -22.5, -54.0, -15.5), "", False),
        Region("indonesia", "Indonesia", (100.0, -4.0, 116.0, 3.0), "regions/indonesia", True),
        Region(
            "north_australia",
            "Northern Australia",
            (122.0, -18.0, 138.0, -11.0),
            "regions/north_australia",
            True,
        ),
        Region(
            "southern_africa",
            "Southern Africa",
            (14.0, -17.0, 30.0, -10.0),
            "regions/southern_africa",
            True,
        ),
        Region("iberia", "Iberia", (-10.0, 36.0, 3.0, 43.0), "regions/iberia", True),
    )
}
SYNTHETIC = Region(
    "synthetic", "Synthetic test region", (20.0, -10.0, 23.0, -3.0), "regions/synthetic", True
)


def get(region_id: str) -> Region:
    if region_id == SYNTHETIC.id:
        return SYNTHETIC
    if region_id not in REGIONS:
        raise ValueError(f"unknown region {region_id!r}; known: {', '.join(REGIONS)}")
    return REGIONS[region_id]


def grid_size(region: Region) -> tuple[int, int]:
    ticks = []
    for edge, value in zip(_EDGES, region.bbox, strict=True):
        tick = round(value * 10, 6)
        if tick != int(tick):
            raise ValueError(
                f"region {region.id!r}: bbox edge {edge}={value} is not a multiple of 0.1 degree"
            )
        ticks.append(int(tick))
    nx, ny = ticks[2] - ticks[0], ticks[3] - ticks[1]
    if nx * ny > MAX_CELLS:
        raise ValueError(
            f"region {region.id!r}: {nx * ny} cells is above the {MAX_CELLS} limit "
            "of the cube format"
        )
    return nx, ny


def read_coverage(raw: Path) -> tuple[dict[str, list[tuple[date, date]]], dict[str, date]]:
    coverage: dict[str, list[tuple[date, date]]] = {"modis": [], "viirs": []}
    nrt: dict[str, date] = {"modis": date.max, "viirs": date.max}
    path = Path(raw) / "coverage.json"
    if not path.is_file():
        return coverage, nrt
    data = json.loads(path.read_text(encoding="utf-8"))
    for sensor in coverage:
        entry = data.get(sensor, {})
        coverage[sensor] = [
            (date.fromisoformat(a), date.fromisoformat(b)) for a, b in entry.get("intervals", [])
        ]
        if entry.get("nrt_start"):
            nrt[sensor] = date.fromisoformat(entry["nrt_start"])
    return coverage, nrt


def region_from_argv(argv: list[str]) -> str | None:
    for i, arg in enumerate(argv):
        if arg == "--region":
            return argv[i + 1] if i + 1 < len(argv) else None
        if arg.startswith("--region="):
            return arg.split("=", 1)[1]
    return None
