"""Fire events: space-time connected components of detections."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from mvh import config

EPS_KM = 2.0
EPS_DAYS = 2

_VOXEL_KM = 0.25
_KM_PER_DEG_LON = 111.32 * np.cos(np.radians(-19.0))
_KM_PER_DEG_LAT = 110.57


def label_events(df: pd.DataFrame, eps_km: float = EPS_KM, eps_days: int = EPS_DAYS) -> np.ndarray:
    """Return an event id (0..k-1) per row of `df`, in row order."""
    n = len(df)
    if n == 0:
        return np.zeros(0, dtype=np.int64)
    x = df["lon"].to_numpy(dtype="float64") * _KM_PER_DEG_LON
    y = df["lat"].to_numpy(dtype="float64") * _KM_PER_DEG_LAT
    day = df["ts"].to_numpy(dtype="datetime64[D]").astype("int64")

    # Dense megafires pack many detections per voxel; cluster unique voxels only.
    vox = np.stack(
        [np.floor(x / _VOXEL_KM), np.floor(y / _VOXEL_KM), day.astype("float64")], axis=1
    ).astype("int64")
    uniq, inverse = np.unique(vox, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    pts = np.stack(
        [
            (uniq[:, 0] + 0.5) * _VOXEL_KM / eps_km,
            (uniq[:, 1] + 0.5) * _VOXEL_KM / eps_km,
            uniq[:, 2] / eps_days,
        ],
        axis=1,
    )
    pairs = cKDTree(pts).query_pairs(r=1.0, p=np.inf, output_type="ndarray")
    m = len(pts)
    graph = coo_matrix((np.ones(len(pairs), dtype=np.int8), (pairs[:, 0], pairs[:, 1])), (m, m))
    _, comp = connected_components(graph, directed=False)
    return comp[inverse].astype(np.int64)


def _count(df: pd.DataFrame) -> dict[int, int]:
    out: dict[int, int] = {}
    for year, sub in df.groupby("year"):
        out[int(year)] = int(label_events(sub).max()) + 1 if len(sub) else 0
    return out


def events_per_year(modis: pd.DataFrame, viirs: pd.DataFrame) -> list[dict]:
    """Event counts per sensor for every year in the study period."""
    m, v = _count(modis), _count(viirs)
    return [
        {"year": y, "modis": m.get(y, 0), "viirs": v.get(y, 0)}
        for y in range(config.YEAR_START, config.YEAR_END + 1)
    ]
