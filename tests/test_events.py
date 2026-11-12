import math

import numpy as np
import pandas as pd

from mvh.events import events_per_year, label_events

KM_LON = 1 / (111.32 * math.cos(math.radians(19.0)))  # degrees of longitude per km


def frame(rows):
    """rows: (east_km, date) pairs placed on a fixed latitude."""
    return pd.DataFrame(
        {
            "lon": [-56.0 + km * KM_LON for km, _ in rows],
            "lat": [-19.0] * len(rows),
            "ts": pd.to_datetime([d for _, d in rows]),
            "year": pd.to_datetime([d for _, d in rows]).year.astype("int16"),
        }
    )


def n_events(rows):
    return len(set(label_events(frame(rows))))


def test_close_points_same_day_one_event():
    assert n_events([(0, "2020-09-01"), (1, "2020-09-01")]) == 1


def test_far_points_same_day_two_events():
    assert n_events([(0, "2020-09-01"), (10, "2020-09-01")]) == 2


def test_time_gap():
    assert n_events([(0, "2020-09-01"), (0, "2020-09-06")]) == 2
    assert n_events([(0, "2020-09-01"), (0, "2020-09-03")]) == 1


def test_chain_links_distant_ends():
    assert n_events([(0, "2020-09-01"), (1.2, "2020-09-01"), (2.4, "2020-09-01")]) == 1


def test_single_and_empty():
    assert list(label_events(frame([(0, "2020-09-01")]))) == [0]
    out = label_events(frame([]))
    assert len(out) == 0


def test_labels_align_with_shuffled_input():
    rows = [(0, "2020-09-01"), (1, "2020-09-01"), (30, "2020-09-01"), (31, "2020-09-02")]
    df = frame(rows)
    perm = np.array([2, 0, 3, 1])
    labels = label_events(df.iloc[perm].reset_index(drop=True))
    assert labels[0] == labels[2]  # original rows 2 and 3
    assert labels[1] == labels[3]  # original rows 0 and 1
    assert labels[0] != labels[1]


def test_events_per_year_counts_each_sensor():
    modis = frame([(0, "2020-09-01"), (50, "2020-09-01"), (0, "2021-03-01")])
    viirs = frame([(0, "2020-09-01")])
    rows = events_per_year(modis, viirs)
    assert len(rows) == 26
    assert [r["year"] for r in rows] == list(range(2001, 2027))
    by = {r["year"]: r for r in rows}
    assert by[2020] == {"year": 2020, "modis": 2, "viirs": 1}
    assert by[2021] == {"year": 2021, "modis": 1, "viirs": 0}


def test_events_per_year_empty_is_zeros():
    rows = events_per_year(frame([]), frame([]))
    assert len(rows) == 26
    assert all(r["modis"] == 0 and r["viirs"] == 0 for r in rows)


def test_event_crossing_new_year_counts_once_per_year():
    df = frame([(0, "2020-12-31"), (0, "2021-01-01")])
    by = {r["year"]: r for r in events_per_year(df, frame([]))}
    assert by[2020]["modis"] == 1 and by[2021]["modis"] == 1
