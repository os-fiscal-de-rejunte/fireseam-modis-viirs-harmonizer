from __future__ import annotations

import numpy as np
import pandas as pd

from mvh.config import NX, NY, WEEKS_PER_YEAR, YEAR_END, YEAR_START, week_of
from mvh.grid import cell_index, weekly_cube, weekly_totals

N_YEARS = YEAR_END - YEAR_START + 1
N_ROWS = NX * NY * N_YEARS * WEEKS_PER_YEAR


def make_frame(rows, sensor):
    """rows: (lon, lat, ts, sat, frp, conf, night)."""
    cols = ["lon", "lat", "ts", "sat", "frp", "conf", "night"]
    df = pd.DataFrame(rows, columns=cols)
    df["ts"] = pd.to_datetime(df["ts"]).astype("datetime64[ns]")
    df["year"] = df["ts"].dt.year.astype("int16")
    df["doy"] = df["ts"].dt.day_of_year.astype("int16")
    df["week"] = np.array([week_of(t.date()) for t in df["ts"]], dtype="int8")
    df["frp"] = df["frp"].astype("float32")
    df["conf"] = df["conf"].astype("float32")
    df["night"] = df["night"].astype(bool)
    df["sensor"] = sensor
    df["nrt"] = False
    return df


def empty(sensor):
    return make_frame([], sensor)


def pick(cube, year, week, cx, cy):
    sel = cube[
        (cube["year"] == year) & (cube["week"] == week) & (cube["cx"] == cx) & (cube["cy"] == cy)
    ]
    assert len(sel) == 1
    return sel.iloc[0]


def test_cell_index_corners_and_edges():
    cx, cy = cell_index(np.array([-58.5, -54.0]), np.array([-22.5, -15.5]))
    assert cx.tolist() == [0, NX - 1]
    assert cy.tolist() == [0, NY - 1]
    assert cx.dtype == np.int16 and cy.dtype == np.int16


def test_cell_index_inside_and_boundary():
    cx, cy = cell_index(np.array([-58.04, -58.2]), np.array([-22.5, -22.4]))
    assert cx.tolist() == [4, 3]
    assert cy.tolist() == [0, 1]


def test_cube_shape_sorted_dtypes_no_nan():
    cube = weekly_cube(empty("modis"), empty("viirs"))
    assert len(cube) == N_ROWS
    assert isinstance(cube.index, pd.RangeIndex)
    keys = cube[["year", "week", "cy", "cx"]]
    assert keys.equals(keys.sort_values(["year", "week", "cy", "cx"]))
    assert not cube.isna().any().any()
    expected = {
        "year": "int16",
        "week": "int8",
        "month": "int8",
        "cx": "int16",
        "cy": "int16",
        "n_terra": "int32",
        "n_aqua": "int32",
        "frp_terra": "float32",
        "frp_aqua": "float32",
        "night_terra": "int32",
        "night_aqua": "int32",
        "conf_terra": "float32",
        "conf_aqua": "float32",
        "n_viirs": "int32",
        "cov_terra": "bool",
        "cov_aqua": "bool",
        "cov_snpp": "bool",
    }
    assert {c: str(t) for c, t in cube.dtypes.items()} == expected
    assert list(cube.columns) == list(expected)


def test_empty_inputs_all_zero_with_coverage():
    cube = weekly_cube(empty("modis"), empty("viirs"))
    counts = [c for c in cube.columns if c.startswith(("n_", "frp_", "night_", "conf_"))]
    assert (cube[counts] == 0).all().all()
    assert cube.loc[cube["year"] == 2015, "cov_terra"].all()


def test_modis_aggregation_in_one_cell_week():
    # 2020-07-10 is day 192 -> week 28; lon -57.55/lat -17.55 -> cell (9, 49)
    rows = [
        (-57.55, -17.55, "2020-07-10 03:10", "Terra", 10.0, 80, True),
        (-57.56, -17.56, "2020-07-11 13:00", "Terra", 5.0, 60, False),
        (-57.55, -17.55, "2020-07-12 04:00", "Aqua", 7.0, 90, True),
    ]
    cube = weekly_cube(make_frame(rows, "modis"), empty("viirs"))
    r = pick(cube, 2020, 28, 9, 49)
    assert (r.n_terra, r.n_aqua) == (2, 1)
    assert (r.frp_terra, r.frp_aqua) == (15.0, 7.0)
    assert (r.night_terra, r.night_aqua) == (1, 1)
    assert (r.conf_terra, r.conf_aqua) == (70.0, 90.0)
    assert r.n_viirs == 0
    week = cube[(cube["year"] == 2020) & (cube["week"] == 28)]
    assert week["n_terra"].sum() == 2 and week["n_aqua"].sum() == 1
    other = pick(cube, 2020, 28, 10, 49)
    assert other.n_terra == 0 and other.conf_terra == 0


def test_viirs_point_lands_in_cell_week():
    rows = [(-55.05, -16.05, "2021-01-02 18:30", "SNPP", 3.0, np.nan, False)]
    cube = weekly_cube(empty("modis"), make_frame(rows, "viirs"))
    # lon -55.05 -> floor(34.5) = 34; lat -16.05 -> floor(64.5) = 64; week 1
    assert pick(cube, 2021, 1, 34, 64).n_viirs == 1
    assert cube["n_viirs"].sum() == 1


def test_coverage_flags():
    cube = weekly_cube(empty("modis"), empty("viirs"))
    flag = lambda y, w, c: bool(pick(cube, y, w, 0, 0)[c])  # noqa: E731
    assert not flag(2011, 30, "cov_snpp")
    assert flag(2015, 30, "cov_snpp")
    assert not flag(2001, 30, "cov_aqua")
    assert flag(2015, 30, "cov_aqua")


def test_weekly_totals_match_cube():
    rows = [
        (-57.55, -17.55, "2020-07-10 03:10", "Terra", 10.0, 80, True),
        (-57.0, -18.0, "2020-07-10 03:10", "Aqua", 1.0, 50, False),
    ]
    vrows = [(-55.05, -16.05, "2020-07-10 18:30", "SNPP", 3.0, np.nan, False)]
    cube = weekly_cube(make_frame(rows, "modis"), make_frame(vrows, "viirs"))
    tot = weekly_totals(cube)
    assert len(tot) == N_YEARS * WEEKS_PER_YEAR
    assert tot[["year", "week"]].equals(
        tot[["year", "week"]].sort_values(["year", "week"]).reset_index(drop=True)
    )
    assert tot["n_terra"].sum() == cube["n_terra"].sum() == 1
    assert tot["n_aqua"].sum() == 1 and tot["n_viirs"].sum() == 1
    row = tot[(tot["year"] == 2020) & (tot["week"] == 28)].iloc[0]
    assert (row.n_terra, row.n_aqua, row.n_viirs) == (1, 1, 1)
    for c in ("month", "cov_terra", "cov_aqua", "cov_snpp"):
        assert c in tot.columns
    assert (row.frp_terra, row.frp_aqua) == (10.0, 1.0)
    assert (row.night_terra, row.night_aqua) == (1, 0)
    assert (row.cells_terra, row.cells_aqua) == (1, 1)
