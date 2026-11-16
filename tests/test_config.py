from datetime import date, timedelta

import pytest

from mvh import config


def test_week_of_edges():
    assert config.week_of(date(2021, 1, 1)) == 1
    assert config.week_of(date(2021, 1, 7)) == 1
    assert config.week_of(date(2021, 1, 8)) == 2
    assert config.week_of(date(2021, 12, 30)) == 52
    assert config.week_of(date(2021, 12, 31)) == 52
    assert config.week_of(date(2020, 12, 31)) == 52


def test_week_bounds():
    assert config.week_bounds(2021, 52) == (date(2021, 12, 24), date(2021, 12, 31))
    assert config.week_bounds(2020, 1) == (date(2020, 1, 1), date(2020, 1, 7))


@pytest.mark.parametrize("year", [2020, 2021])
def test_week_round_trip(year):
    d = date(year, 1, 1)
    while d.year == year:
        start, end = config.week_bounds(year, config.week_of(d))
        assert start <= d <= end
        d += timedelta(days=1)


def test_sat_covers_snpp():
    assert not config.sat_covers("SNPP", 2011, 30)
    assert not config.sat_covers("SNPP", 2012, 3)
    assert config.sat_covers("SNPP", 2012, 4)
    # Jul 26 - Aug 11 2022 touches weeks 30..32
    for week in (30, 31, 32):
        assert not config.sat_covers("SNPP", 2022, week)


def test_sat_covers_snpp_2024_outages():
    for lo, hi in (
        (date(2024, 5, 29), date(2024, 6, 4)),
        (date(2024, 7, 23), date(2024, 7, 29)),
    ):
        first, last = config.week_of(lo), config.week_of(hi)
        for week in range(first, last + 1):
            assert not config.sat_covers("SNPP", 2024, week)
        assert config.sat_covers("SNPP", 2024, first - 2)
        assert config.sat_covers("SNPP", 2024, last + 2)


def test_sat_covers_aqua_and_terra():
    assert not config.sat_covers("Aqua", 2001, 10)
    assert not config.sat_covers("Aqua", 2002, 27)
    assert not config.sat_covers("Aqua", 2002, 30)
    assert config.sat_covers("Aqua", 2003, 10)
    assert config.sat_covers("Terra", 2026, 24)
    assert config.sat_covers("Terra", 2026, 45)
    assert not config.sat_covers("Terra", 2026, 46)
    assert not config.sat_covers("Terra", 2001, 25)


def test_sat_covers_unknown():
    with pytest.raises(ValueError):
        config.sat_covers("Landsat", 2020, 1)


def test_is_nrt():
    assert config.is_nrt("modis", 2026, 40)
    assert not config.is_nrt("modis", 2026, 10)


def test_coverage_meta_shape():
    meta = config.coverage_meta()
    assert meta["modis"][0] == ["2001-01-01", "2026-11-13"]
    assert set(meta) == {"modis", "viirs"}


def test_raw_root_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FIRMS_OUT_DIR", str(tmp_path))
    assert config.raw_root() == tmp_path
