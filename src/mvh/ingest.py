"""Read raw FIRMS CSV exports into the standard detections frame."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd

from mvh import config

_FOLDER = {"modis": "modis", "viirs": "viirs_snpp"}
_KEY = ["latitude", "longitude", "acq_date", "acq_time", "satellite"]
_COLUMNS = {
    "lon": "float64",
    "lat": "float64",
    "ts": "datetime64[ns]",
    "year": "int16",
    "doy": "int16",
    "week": "int8",
    "frp": "float32",
    "conf": "float32",
    "night": "bool",
    "sat": "object",
    "sensor": "object",
    "nrt": "bool",
}
_USECOLS = [*_KEY, "confidence", "version", "frp", "daynight", "type"]


def _empty() -> pd.DataFrame:
    return pd.DataFrame({c: pd.Series(dtype=t) for c, t in _COLUMNS.items()})


def _read_all(folder: Path) -> pd.DataFrame:
    parts = [
        pd.read_csv(p, dtype=str, keep_default_na=False, usecols=lambda c: c in _USECOLS)
        for p in sorted(folder.glob("*.csv"))
    ]
    parts = [p for p in parts if len(p)]
    if not parts:
        return pd.DataFrame(columns=_USECOLS)
    # rows that omit the trailing `type` value come back as NaN
    return pd.concat(parts, ignore_index=True).fillna("")


def load_firms(sensor: Literal["modis", "viirs"], root: Path | None = None) -> pd.DataFrame:
    """Return one row per detection, sorted by `ts`, with the standard columns."""
    if sensor not in _FOLDER:
        raise ValueError(f"unknown sensor: {sensor!r}")
    root = config.raw_root() if root is None else Path(root)
    raw = _read_all(root / _FOLDER[sensor])

    bad_type = raw["type"].isin(["1", "2"])
    dropped = int(bad_type.sum())
    raw = raw[~bad_type].drop_duplicates(_KEY)

    lon = raw["longitude"].astype("float64")
    lat = raw["latitude"].astype("float64")
    lon_min, lat_min, lon_max, lat_max = config.BBOX
    raw = raw[lon.between(lon_min, lon_max) & lat.between(lat_min, lat_max)]

    ts = pd.to_datetime(
        raw["acq_date"] + raw["acq_time"].str.zfill(4), format="%Y-%m-%d%H%M"
    ).astype("datetime64[ns]")
    doy = ts.dt.day_of_year
    frp = pd.to_numeric(raw["frp"], errors="coerce").fillna(0).clip(lower=0)
    if sensor == "modis":
        conf = pd.to_numeric(raw["confidence"], errors="coerce")
        sat = raw["satellite"]
    else:
        conf = pd.Series(np.nan, index=raw.index)
        sat = raw["satellite"].replace({"N": "SNPP"})

    df = pd.DataFrame(
        {
            "lon": raw["longitude"].astype("float64"),
            "lat": raw["latitude"].astype("float64"),
            "ts": ts,
            "year": ts.dt.year.astype("int16"),
            "doy": doy.astype("int16"),
            "week": np.minimum((doy - 1) // 7 + 1, config.WEEKS_PER_YEAR).astype("int8"),
            "frp": frp.astype("float32"),
            "conf": conf.astype("float32"),
            "night": raw["daynight"] == "N",
            "sat": sat.astype(object),
            "sensor": sensor,
            "nrt": raw["version"].str.endswith("NRT"),
        }
    )
    df = df.sort_values("ts", kind="stable").reset_index(drop=True)
    df["sensor"] = df["sensor"].astype(object)
    df.attrs["dropped_type"] = dropped
    return df
