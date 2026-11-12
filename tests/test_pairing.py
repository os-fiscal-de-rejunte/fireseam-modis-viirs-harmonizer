import numpy as np
import pandas as pd

from mvh.pairing import find_ghosts, pairing_stats

LON0, LAT0 = -56.0, -19.0
KM_LON = 111.32 * np.cos(np.radians(19.0))


def _frame(rows, sat):
    """rows: (minutes since 2020-08-01 00:00, east offset km)."""
    base = pd.Timestamp("2020-08-01")
    ts = [base + pd.Timedelta(minutes=m) for m, _ in rows]
    lon = [LON0 + km / KM_LON for _, km in rows]
    return pd.DataFrame(
        {
            "lon": np.array(lon, dtype="float64"),
            "lat": np.full(len(rows), LAT0),
            "ts": pd.to_datetime(ts).astype("datetime64[ns]"),
            "sat": sat,
        }
    )


def _modis(rows, sat="Aqua"):
    df = _frame(rows, sat)
    df["sensor"] = "modis"
    return df


def _viirs(rows):
    df = _frame(rows, "SNPP")
    df["sensor"] = "viirs"
    return df


def test_close_in_space_and_time_not_ghosts():
    m, v = find_ghosts(_modis([(600, 0.0)]), _viirs([(625, 0.5)]))
    assert not m.any() and not v.any()


def test_same_place_four_hours_apart_are_ghosts():
    m, v = find_ghosts(_modis([(600, 0.0)]), _viirs([(840, 0.0)]))
    assert m.all() and v.all()


def test_close_in_time_but_five_km_apart_are_ghosts():
    m, v = find_ghosts(_modis([(600, 0.0)]), _viirs([(625, 5.0)]))
    assert m.all() and v.all()


def test_terra_is_never_a_ghost():
    m, v = find_ghosts(_modis([(600, 0.0)], sat="Terra"), _viirs([]))
    assert not m.any()
    assert len(v) == 0


def test_ineligible_dates_are_not_ghosts_and_not_counted():
    m2011 = _modis([(600, 0.0)])
    m2011["ts"] = pd.Timestamp("2011-08-01 10:00")
    v2011 = _viirs([(600, 50.0)])
    v2011["ts"] = pd.Timestamp("2011-08-01 10:00")
    outage = pd.Timestamp("2022-08-01 10:00")
    m2022 = _modis([(600, 0.0)])
    m2022["ts"] = outage
    v2022 = _viirs([(600, 50.0)])
    v2022["ts"] = outage
    for m_df, v_df in [(m2011, v2011), (m2022, v2022)]:
        m, v = find_ghosts(m_df, v_df)
        assert not m.any() and not v.any()
        m_df["year"] = m_df.ts.dt.year
        v_df["year"] = v_df.ts.dt.year
        assert pairing_stats(m_df, v_df, m, v) == []


def test_empty_inputs():
    m, v = find_ghosts(_modis([]), _viirs([]))
    assert m.dtype == bool and v.dtype == bool
    assert len(m) == 0 and len(v) == 0
    assert pairing_stats(_modis([]).assign(year=[]), _viirs([]).assign(year=[]), m, v) == []


def test_stats_shares_and_median_lag():
    modis = _modis([(600, 0.0), (1000, 0.0), (2000, 0.0), (3000, 0.0)])
    viirs = _viirs([(610, 0.0), (1030, 0.0), (2020, 0.0), (5000, 0.0)])
    modis["year"] = 2020
    viirs["year"] = 2020
    m, v = find_ghosts(modis, viirs)
    assert m.tolist() == [False, False, False, True]
    assert v.tolist() == [False, False, False, True]
    (row,) = pairing_stats(modis, viirs, m, v)
    assert row == {
        "year": 2020,
        "aqua_n": 4,
        "aqua_unmatched": 0.25,
        "viirs_n": 4,
        "viirs_unmatched": 0.25,
        "dt_p50_min": 20.0,
    }


def test_output_aligned_with_unsorted_input():
    modis = _modis([(3000, 0.0), (600, 0.0)])
    viirs = _viirs([(5000, 0.0), (620, 0.0)])
    m, v = find_ghosts(modis, viirs)
    assert m.tolist() == [True, False]
    assert v.tolist() == [True, False]
