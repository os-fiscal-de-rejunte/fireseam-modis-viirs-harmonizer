import pandas as pd

from mvh.audit import (
    count_duplicates,
    find_outages,
    frp_stats,
    overpass_lag,
    parse_acq_time,
)


def test_parse_acq_time_pads_to_hhmm():
    ts = parse_acq_time(pd.Series(["2020-08-01", "2020-08-01"]), pd.Series(["5", "1944"]))
    assert list(ts) == [pd.Timestamp("2020-08-01 00:05"), pd.Timestamp("2020-08-01 19:44")]


def test_count_duplicates_exact_vs_key():
    df = pd.DataFrame(
        {
            "latitude": ["-16.1", "-16.1", "-16.1", "-17.0"],
            "longitude": ["-56.1", "-56.1", "-56.1", "-56.0"],
            "acq_date": ["2020-08-01"] * 4,
            "acq_time": ["100", "100", "100", "100"],
            "satellite": ["Terra"] * 4,
            "frp": ["1.0", "1.0", "2.0", "3.0"],
        }
    )
    assert count_duplicates(df) == {"exact": 1, "by_key": 2}


def _detections(dates, sat="Terra"):
    ts = pd.to_datetime(pd.Series(dates))
    return pd.DataFrame({"ts": ts, "sat": sat})


def test_find_outages_reports_six_day_hole_only():
    days = pd.date_range("2020-01-01", "2020-12-31")
    gap6 = pd.date_range("2020-08-10", "2020-08-15")
    gap4 = pd.date_range("2020-09-10", "2020-09-13")
    jan = pd.date_range("2020-01-10", "2020-01-20")
    keep = days.difference(gap6).difference(gap4).difference(jan)
    out = find_outages(_detections(keep))
    assert len(out) == 1
    assert out.iloc[0]["start"] == pd.Timestamp("2020-08-10")
    assert out.iloc[0]["end"] == pd.Timestamp("2020-08-15")
    assert out.iloc[0]["days"] == 6


def test_overpass_lag_p50_is_thirty_minutes():
    dates = pd.date_range("2020-08-01", periods=5)
    aqua = pd.DataFrame({"ts": dates + pd.Timedelta(hours=17), "night": False})
    snpp = pd.DataFrame({"ts": dates + pd.Timedelta(hours=17, minutes=30), "night": False})
    out = overpass_lag(aqua, snpp)
    assert out.loc[2020, "p50"] == 30


def test_frp_stats_counts_empty_and_negative():
    stats = frp_stats(pd.Series(["1.5", "", "-0.2", "10", None]))
    assert stats["empty"] == 2
    assert stats["negative"] == 1
    assert stats["min"] == -0.2
    assert stats["max"] == 10.0
