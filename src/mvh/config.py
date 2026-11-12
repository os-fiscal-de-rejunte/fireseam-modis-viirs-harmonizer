"""Project constants and the week / coverage rules shared by every module."""

from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

BBOX = (-58.5, -22.5, -54.0, -15.5)  # lon_min, lat_min, lon_max, lat_max
CELL_DEG = 0.1
NX, NY = 45, 70
YEAR_START, YEAR_END = 2001, 2026
WEEKS_PER_YEAR = 52
AQUA_START = date(2002, 7, 4)
TRAIN_START, TRAIN_END = date(2012, 1, 20), date(2025, 12, 31)

# downloaded intervals per sensor (inclusive)
COVERAGE = {
    "modis": [(date(2001, 1, 1), date(2026, 6, 13)), (date(2026, 9, 1), date(2026, 11, 10))],
    "viirs": [(date(2012, 1, 20), date(2026, 6, 14)), (date(2026, 8, 1), date(2026, 11, 2))],
}
NRT_START = {"modis": date(2026, 9, 1), "viirs": date(2026, 8, 1)}

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


def week_of(d: date) -> int:
    return min((d.timetuple().tm_yday - 1) // 7 + 1, WEEKS_PER_YEAR)


def week_bounds(year: int, week: int) -> tuple[date, date]:
    start = date(year, 1, 1) + timedelta(days=7 * (week - 1))
    end = date(year, 12, 31) if week == WEEKS_PER_YEAR else start + timedelta(days=6)
    return start, end


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


def raw_root() -> Path:
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
