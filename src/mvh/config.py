"""Project constants and the week / coverage rules shared by every module."""

from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

from mvh import regions

REGION = regions.get(os.environ.get("MVH_REGION", "pantanal"))
REGION_ID = REGION.id
BBOX = REGION.bbox  # lon_min, lat_min, lon_max, lat_max
CELL_DEG = 0.1
NX, NY = regions.grid_size(REGION)
YEAR_START, YEAR_END = 2001, 2026
WEEKS_PER_YEAR = 52
AQUA_START = date(2002, 7, 4)
VIIRS_START = date(2012, 1, 20)
TRAIN_START, TRAIN_END = date(2012, 1, 20), date(2025, 12, 31)

# satellite outages (inclusive): runs of at least 5 days without detections while the other
# satellites stayed active, padded by one day on each side
KNOWN_GAPS = {
    "Terra": [(date(2001, 6, 15), date(2001, 7, 4)), (date(2022, 10, 9), date(2022, 10, 24))],
    "Aqua": [(date(2002, 7, 29), date(2002, 8, 8))],
    "SNPP": [
        (date(2022, 7, 26), date(2022, 8, 11)),
        (date(2024, 5, 29), date(2024, 6, 4)),
        (date(2024, 7, 23), date(2024, 7, 29)),
    ],
}

_SENSOR_OF = {"Terra": "modis", "Aqua": "modis", "SNPP": "viirs"}
_REPO_ROOT = Path(__file__).resolve().parents[2]


def raw_root() -> Path:
    base = _raw_base()
    return base / REGION.raw if REGION.raw else base


def _raw_base() -> Path:
    value = os.environ.get("FIRMS_OUT_DIR")
    if value:
        return Path(value)
    env_file = _REPO_ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, sep, val = line.partition("=")
            if sep and key.strip() == "FIRMS_OUT_DIR" and val.strip():
                return Path(val.strip().strip("\"'"))
    return _REPO_ROOT / "data" / "raw"


# downloaded intervals per sensor (inclusive)
if REGION.id == "pantanal":
    COVERAGE = {
        "modis": [(date(2001, 1, 1), date(2026, 11, 13))],
        "viirs": [(date(2012, 1, 20), date(2026, 11, 2))],
    }
    NRT_START = {"modis": date(2026, 9, 1), "viirs": date(2026, 8, 1)}
else:
    COVERAGE, NRT_START = regions.read_coverage(raw_root())


def week_of(d: date) -> int:
    return min((d.timetuple().tm_yday - 1) // 7 + 1, WEEKS_PER_YEAR)


def week_bounds(year: int, week: int) -> tuple[date, date]:
    start = date(year, 1, 1) + timedelta(days=7 * (week - 1))
    end = date(year, 12, 31) if week == WEEKS_PER_YEAR else start + timedelta(days=6)
    return start, end


def why_code(status: str, year: int, week: int) -> str | None:
    """Why a week is not observed: None, pre_viirs, viirs_outage, modis_outage, not_downloaded."""
    if status == "observed":
        return None
    start, end = week_bounds(year, week)

    def hit(sat: str) -> bool:
        return any(start <= hi and lo <= end for lo, hi in KNOWN_GAPS[sat])

    if status == "estimated":
        if start < VIIRS_START:
            return "pre_viirs"
        return "viirs_outage" if hit("SNPP") else "not_downloaded"
    return "modis_outage" if hit("Terra") else "not_downloaded"


def as_of_date(statuses_by_week: list[tuple[int, int, str]]) -> str | None:
    """ISO end date of the last week whose status is not 'gap'; None if all are gaps."""
    last = None
    for year, week, status in statuses_by_week:
        if status != "gap":
            last = week_bounds(year, week)[1].isoformat()
    return last


def sat_covers(sat: str, year: int, week: int) -> bool:
    if sat not in _SENSOR_OF:
        raise ValueError(f"unknown satellite: {sat!r}")
    start, end = week_bounds(year, week)
    if sat == "Aqua" and start < AQUA_START:
        return False
    if not any(lo <= start and end <= hi for lo, hi in COVERAGE[_SENSOR_OF[sat]]):
        return False
    return not any(start <= hi and lo <= end for lo, hi in KNOWN_GAPS[sat])


def is_nrt(sensor: str, year: int, week: int) -> bool:
    return week_bounds(year, week)[1] >= NRT_START[sensor]


def coverage_meta() -> dict:
    return {
        sensor: [[lo.isoformat(), hi.isoformat()] for lo, hi in spans]
        for sensor, spans in COVERAGE.items()
    }
