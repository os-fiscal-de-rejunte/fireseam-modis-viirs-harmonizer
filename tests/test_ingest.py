from pathlib import Path

import pandas as pd
import pytest

from mvh import config
from mvh.ingest import load_firms

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "sample" / "raw"
MODIS_HEADER = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_t31,frp,daynight,type"
)
VIIRS_HEADER = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_ti5,frp,daynight,type"
)
COLUMNS = [
    "lon",
    "lat",
    "ts",
    "year",
    "doy",
    "week",
    "frp",
    "conf",
    "night",
    "sat",
    "sensor",
    "nrt",
]
DTYPES = {
    "lon": "float64",
    "lat": "float64",
    "ts": "datetime64[ns]",
    "year": "int16",
    "doy": "int16",
    "week": "int8",
    "frp": "float32",
    "conf": "float32",
    "night": "bool",
}


def modis_row(
    lat=-17.0,
    lon=-56.0,
    date="2020-08-01",
    time="1330",
    sat="Terra",
    conf="80",
    version="6.1",
    frp="10.0",
    dn="D",
    typ="0",
):
    return f"{lat},{lon},330,1,1,{date},{time},{sat},MODIS,{conf},{version},290,{frp},{dn},{typ}"


def viirs_row(
    lat=-17.0,
    lon=-56.0,
    date="2020-08-01",
    time="1330",
    conf="n",
    version="2.0",
    frp="10.0",
    dn="D",
    typ="0",
):
    return f"{lat},{lon},330,0.4,0.4,{date},{time},N,VIIRS,{conf},{version},290,{frp},{dn},{typ}"


def write(root: Path, folder: str, name: str, header: str, rows: list[str]) -> None:
    (root / folder).mkdir(parents=True, exist_ok=True)
    (root / folder / name).write_text("\n".join([header, *rows]) + "\n")


def modis_frame(tmp_path: Path, rows: list[str]) -> pd.DataFrame:
    write(tmp_path, "modis", "2020.csv", MODIS_HEADER, rows)
    return load_firms("modis", tmp_path)


def test_viirs_satellite_sensor_and_conf(tmp_path):
    write(tmp_path, "viirs_snpp", "2020.csv", VIIRS_HEADER, [viirs_row()])
    df = load_firms("viirs", tmp_path)
    assert df["sat"].tolist() == ["SNPP"]
    assert df["sensor"].tolist() == ["viirs"]
    assert df["conf"].isna().all()


def test_modis_conf_numeric(tmp_path):
    df = modis_frame(tmp_path, [modis_row(conf="73"), modis_row(lat=-17.1, sat="Aqua", conf="0")])
    assert sorted(df["conf"].tolist()) == [0.0, 73.0]
    assert set(df["sat"]) == {"Terra", "Aqua"}
    assert set(df["sensor"]) == {"modis"}


def test_acq_time_padding(tmp_path):
    df = modis_frame(
        tmp_path,
        [
            modis_row(time="5", date="2020-03-01"),
            modis_row(lat=-17.1, time="1944", date="2020-03-02"),
        ],
    )
    assert df["ts"].tolist() == [pd.Timestamp("2020-03-01 00:05"), pd.Timestamp("2020-03-02 19:44")]
    assert df["year"].tolist() == [2020, 2020]
    assert df["doy"].tolist() == [61, 62]


def test_type_1_2_dropped_and_counted(tmp_path):
    rows = [
        modis_row(lat=-17.0, typ="0"),
        modis_row(lat=-17.1, typ="1"),
        modis_row(lat=-17.2, typ="2"),
        modis_row(lat=-17.3, typ="3"),
        modis_row(lat=-17.4, typ="", version="6.1NRT"),
    ]
    df = modis_frame(tmp_path, rows)
    assert len(df) == 3
    assert df.attrs["dropped_type"] == 2


def test_duplicate_key_kept_once(tmp_path):
    df = modis_frame(tmp_path, [modis_row(), modis_row(), modis_row(sat="Aqua")])
    assert len(df) == 2


def test_empty_and_negative_frp_become_zero(tmp_path):
    df = modis_frame(
        tmp_path,
        [modis_row(lat=-17.0, frp=""), modis_row(lat=-17.1, frp="-1.5"), modis_row(lat=-17.2)],
    )
    assert sorted(df["frp"].tolist()) == [0.0, 0.0, 10.0]


def test_bbox_clip_edges_inclusive(tmp_path):
    lon_min, lat_min, lon_max, lat_max = config.BBOX
    rows = [
        modis_row(lat=lat_min, lon=lon_min),
        modis_row(lat=lat_max, lon=lon_max),
        modis_row(lat=lat_max + 0.001, lon=-56.0),
        modis_row(lat=-17.0, lon=lon_min - 0.001),
    ]
    df = modis_frame(tmp_path, rows)
    assert len(df) == 2
    assert df["lat"].min() == lat_min and df["lon"].max() == lon_max


def test_nrt_flag(tmp_path):
    rows = [
        modis_row(lat=-17.0, version="6.1"),
        modis_row(lat=-17.1, version="6.1NRT", typ=""),
        modis_row(lat=-17.2, version="6.03"),
    ]
    df = modis_frame(tmp_path, rows).sort_values("lat", ascending=False)
    assert df["nrt"].tolist() == [False, True, False]


def test_nrt_row_without_trailing_type_value(tmp_path):
    short = modis_row(version="6.1NRT", typ="").rsplit(",", 1)[0]
    df = modis_frame(tmp_path, [short])
    assert len(df) == 1 and bool(df["nrt"].iloc[0])


@pytest.mark.parametrize("sensor", ["modis", "viirs"])
def test_empty_frame_has_columns_and_dtypes(tmp_path, sensor):
    folder = "modis" if sensor == "modis" else "viirs_snpp"
    header = MODIS_HEADER if sensor == "modis" else VIIRS_HEADER
    write(tmp_path, folder, "2020.csv", header, [])
    for df in (load_firms(sensor, tmp_path), load_firms(sensor, tmp_path / "missing")):
        assert df.empty
        assert list(df.columns) == COLUMNS
        for col, dtype in DTYPES.items():
            assert str(df[col].dtype) == dtype, col
        assert df.attrs["dropped_type"] == 0


def test_unknown_sensor():
    with pytest.raises(ValueError):
        load_firms("goes")  # type: ignore[arg-type]


@pytest.mark.parametrize("sensor", ["modis", "viirs"])
def test_sample_frame_contract(sensor):
    df = load_firms(sensor, SAMPLE)
    assert len(df) > 20
    assert list(df.columns) == COLUMNS
    assert df["ts"].is_monotonic_increasing
    assert df.index.equals(pd.RangeIndex(len(df)))
    for col, dtype in DTYPES.items():
        assert str(df[col].dtype) == dtype, col
    assert df["sat"].dtype == object or pd.api.types.is_string_dtype(df["sat"])
    assert (df["frp"] >= 0).all()
    assert df.attrs["dropped_type"] > 0
    expected = [config.week_of(t.date()) for t in df["ts"]]
    assert df["week"].tolist() == expected
    assert df["nrt"].any()


def test_sample_contains_both_modis_satellites():
    df = load_firms("modis", SAMPLE)
    assert {"Terra", "Aqua"} <= set(df["sat"])
    assert df["night"].any() and (~df["night"]).any()
