#!/usr/bin/env python3
"""Build the raw folder of the synthetic test region from the Pantanal sample.

Usage:
    python src/scripts/make_synthetic_region.py --src data/sample/raw --dst <folder>

Copies modis/*.csv and viirs_snpp/*.csv shifted by 78.5 degrees of longitude and 12.5 of
latitude, and writes coverage.json with the Pantanal intervals.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mvh import config  # noqa: E402

LON_SHIFT, LAT_SHIFT = 78.5, 12.5
FOLDERS = ("modis", "viirs_snpp")


def _shift(series: pd.Series, delta: float) -> pd.Series:
    return (series.astype("float64") + delta).round(4).astype(str)


def make(src: Path, dst: Path) -> None:
    src, dst = Path(src), Path(dst)
    for folder in FOLDERS:
        (dst / folder).mkdir(parents=True, exist_ok=True)
        for path in sorted((src / folder).glob("*.csv")):
            df = pd.read_csv(path, dtype=str, keep_default_na=False)
            df["longitude"] = _shift(df["longitude"], LON_SHIFT)
            df["latitude"] = _shift(df["latitude"], LAT_SHIFT)
            df.to_csv(dst / folder / path.name, index=False)
    coverage = {
        sensor: {
            "intervals": [[lo.isoformat(), hi.isoformat()] for lo, hi in config.COVERAGE[sensor]],
            "nrt_start": config.NRT_START[sensor].isoformat(),
        }
        for sensor in ("modis", "viirs")
    }
    (dst / "coverage.json").write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Make the synthetic region raw folder.")
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--dst", type=Path, required=True)
    args = parser.parse_args()
    make(args.src, args.dst)


if __name__ == "__main__":
    main()
