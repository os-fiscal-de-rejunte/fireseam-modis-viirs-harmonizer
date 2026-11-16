import importlib.util
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("fetch_firms", ROOT / "src/scripts/fetch_firms.py")
ff = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ff)

D = date
AVAIL = {
    "MODIS_SP": (D(2000, 11, 1), D(2026, 7, 31)),
    "MODIS_NRT": (D(2026, 9, 1), D(2026, 11, 12)),
    "VIIRS_SNPP_SP": (D(2012, 1, 20), D(2026, 8, 15)),
    "VIIRS_SNPP_NRT": (D(2026, 8, 10), D(2026, 11, 12)),
}
TODAY = D(2026, 11, 13)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(ff.time, "sleep", lambda *_: None)

    def boom(*_a, **_k):
        raise AssertionError("network")

    monkeypatch.setattr(ff._session, "get", boom)


@pytest.fixture
def calls(monkeypatch):
    got = []

    def fake(key, source, bbox, start, days):
        got.append((source, bbox, start, days))
        return "latitude,longitude\n1,2"

    monkeypatch.setattr(ff, "fetch_chunk", fake)
    return got


@pytest.fixture
def short_products(monkeypatch):
    monkeypatch.setattr(
        ff,
        "PRODUCTS",
        {
            "modis": ("MODIS_SP", "MODIS_NRT", D(2025, 12, 1)),
            "viirs_snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", D(2025, 12, 1)),
        },
    )


EXPECTED = {
    "modis": {
        "intervals": [["2025-12-01", "2026-07-31"], ["2026-09-01", "2026-11-12"]],
        "nrt_start": "2026-09-01",
    },
    "viirs": {"intervals": [["2025-12-01", "2026-11-12"]], "nrt_start": "2026-08-16"},
}


def test_split_segment():
    got = ff.split_segment(D(2026, 1, 1), D(2026, 11, 12), AVAIL["MODIS_SP"], AVAIL["MODIS_NRT"])
    assert got == ((D(2026, 1, 1), D(2026, 7, 31)), (D(2026, 9, 1), D(2026, 11, 12)))
    assert ff.split_segment(
        D(2020, 1, 1), D(2020, 12, 31), AVAIL["MODIS_SP"], AVAIL["MODIS_NRT"]
    ) == ((D(2020, 1, 1), D(2020, 12, 31)), None)


def test_hole_is_not_requested_and_not_recorded(tmp_path, calls, short_products):
    ff.run("KEY", "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert calls
    for source, _bbox, start, days in calls:
        last = start + timedelta(days=days - 1)
        if source.startswith("MODIS"):
            assert last < D(2026, 8, 1) or start > D(2026, 8, 31)
    got = json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8"))
    assert got == EXPECTED


def test_second_run_keeps_the_record(tmp_path, calls, short_products):
    ff.run("KEY", "1,2,3,4", tmp_path, TODAY, AVAIL)
    first = (tmp_path / "coverage.json").read_text(encoding="utf-8")
    n_first = len(calls)
    calls.clear()
    ff.run("KEY", "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert (tmp_path / "coverage.json").read_text(encoding="utf-8") == first
    assert json.loads(first) == EXPECTED
    assert 0 < len(calls) < n_first  # 2025 skipped, 2026 fetched again
    assert all(start.year == 2026 for _s, _b, start, _d in calls)


def test_skipped_year_without_record_is_recorded(tmp_path, calls, short_products):
    for name in ("modis", "viirs_snpp"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "2025.csv").write_text("latitude,longitude\n1,2\n")
    ff.run("KEY", "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert all(start.year == 2026 for _s, _b, start, _d in calls)
    assert json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8")) == EXPECTED


def test_bad_availability_header_stops(monkeypatch):
    class R:
        status_code = 200
        text = "Invalid MAP_KEY"

    monkeypatch.setattr(ff._session, "get", lambda *a, **k: R())
    with pytest.raises(ff.FatalError):
        ff.fetch_availability("KEY")


def test_availability_is_parsed(monkeypatch):
    class R:
        status_code = 200
        text = (
            "data_id,min_date,max_date\n"
            "MODIS_SP,2000-11-01,2026-07-31\n"
            "MODIS_NRT,2026-09-01,2026-11-12\n"
            "VIIRS_SNPP_SP,2012-01-20,2026-08-15\n"
            "VIIRS_SNPP_NRT,2026-08-10,2026-11-12\n"
            "OTHER,2020-01-01,2020-02-01\n"
        )

    monkeypatch.setattr(ff._session, "get", lambda *a, **k: R())
    got = ff.fetch_availability("KEY")
    assert {k: got[k] for k in AVAIL} == AVAIL


def test_missing_source_stops(monkeypatch):
    class R:
        status_code = 200
        text = "data_id,min_date,max_date\nMODIS_SP,2000-11-01,2026-07-31\n"

    monkeypatch.setattr(ff._session, "get", lambda *a, **k: R())
    with pytest.raises(ff.FatalError):
        ff.fetch_availability("KEY")


def test_failed_year_is_not_recorded(tmp_path, monkeypatch, short_products):
    def fake(key, source, bbox, start, days):
        if source.startswith("MODIS") and start.year == 2026:
            raise RuntimeError("boom")
        return "latitude,longitude\n1,2"

    monkeypatch.setattr(ff, "fetch_chunk", fake)
    with pytest.raises(SystemExit) as e:
        ff.run("KEY", "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert e.value.code == 2
    got = json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8"))
    assert got["modis"]["intervals"] == [["2025-12-01", "2025-12-31"]]
    assert got["viirs"]["intervals"] == [["2025-12-01", "2026-11-12"]]


def test_record_coverage_merges_touching_spans(tmp_path):
    def read():
        return json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8"))["modis"]

    ff.record_coverage(tmp_path, "modis", 2019, [(D(2019, 1, 1), D(2019, 12, 31))], None)
    ff.record_coverage(tmp_path, "modis", 2020, [(D(2020, 1, 1), D(2020, 3, 1))], D(2020, 2, 1))
    assert read() == {"intervals": [["2019-01-01", "2020-03-01"]], "nrt_start": "2020-02-01"}
    # the same year again replaces its own part only; nrt_start stays when None is passed
    ff.record_coverage(tmp_path, "modis", 2020, [(D(2020, 1, 1), D(2020, 5, 1))], None)
    assert read() == {"intervals": [["2019-01-01", "2020-05-01"]], "nrt_start": "2020-02-01"}
    ff.record_coverage(tmp_path, "modis", 2021, [(D(2021, 1, 5), D(2021, 2, 1))], None)
    assert read()["intervals"] == [["2019-01-01", "2020-05-01"], ["2021-01-05", "2021-02-01"]]


GOOD_ROWS = (
    "MODIS_SP,2000-11-01,2026-07-31\n"
    "MODIS_NRT,2026-09-01,2026-11-12\n"
    "VIIRS_SNPP_SP,2012-01-20,2026-08-15\n"
    "VIIRS_SNPP_NRT,2026-08-10,2026-11-12\n"
)


def _respond(monkeypatch, body):
    class R:
        status_code = 200
        text = "data_id,min_date,max_date\n" + body

    monkeypatch.setattr(ff._session, "get", lambda *a, **k: R())


def test_unrelated_row_with_bad_date_is_ignored(monkeypatch):
    _respond(monkeypatch, "MODIS_C6,,\n" + GOOD_ROWS)
    got = ff.fetch_availability("KEY")
    assert {k: got[k] for k in AVAIL} == AVAIL


def test_wanted_row_with_bad_date_names_the_source(monkeypatch):
    _respond(monkeypatch, GOOD_ROWS.replace("2000-11-01", "not-a-date"))
    with pytest.raises(ff.FatalError, match="MODIS_SP"):
        ff.fetch_availability("KEY")


def test_repeated_data_id_is_rejected(monkeypatch):
    _respond(monkeypatch, GOOD_ROWS + "MODIS_NRT,2026-09-02,2026-11-12\n")
    with pytest.raises(ff.FatalError, match="MODIS_NRT"):
        ff.fetch_availability("KEY")


def test_availability_failure_exits_3_with_parado(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)  # no .env here
    monkeypatch.setenv("FIRMS_MAP_KEY", "KEY")
    _respond(monkeypatch, "")
    monkeypatch.setattr("sys.argv", ["fetch_firms.py", "--out", str(tmp_path / "raw")])
    with pytest.raises(SystemExit) as e:
        ff.main()
    assert e.value.code == 3
    assert "[PARADO]" in capsys.readouterr().err


def test_region_uses_the_registry_box_and_folder(tmp_path):
    assert ff.resolve_target("iberia", None, None, tmp_path) == (
        "-10.0,36.0,3.0,43.0",
        tmp_path / "regions" / "iberia",
    )
    assert ff.resolve_target("pantanal", None, None, tmp_path) == (
        "-58.5,-22.5,-54.0,-15.5",
        tmp_path,
    )


@pytest.mark.parametrize(
    ("region", "box"),
    [
        ("indonesia", "100.0,-4.0,116.0,3.0"),
        ("north_australia", "122.0,-18.0,138.0,-11.0"),
        ("southern_africa", "14.0,-17.0,30.0,-10.0"),
        ("iberia", "-10.0,36.0,3.0,43.0"),
    ],
)
def test_each_new_region_box_and_folder(tmp_path, region, box):
    assert ff.resolve_target(region, None, None, tmp_path) == (
        box,
        tmp_path / "regions" / region,
    )


def test_no_region_keeps_today_behaviour(tmp_path):
    assert ff.resolve_target(None, None, None, tmp_path) == (ff.PANTANAL_BBOX, tmp_path)
    assert ff.resolve_target(None, "1,2,3,4", tmp_path / "x", tmp_path) == (
        "1,2,3,4",
        tmp_path / "x",
    )


def test_unknown_region_exits_2(tmp_path):
    with pytest.raises(SystemExit) as e:
        ff.resolve_target("mars", None, None, tmp_path)
    assert e.value.code == 2


def test_region_run_requests_that_box(tmp_path, calls, short_products, monkeypatch):
    monkeypatch.setattr(
        ff,
        "PRODUCTS",
        {
            "modis": ("MODIS_SP", "MODIS_NRT", D(2026, 11, 1)),
            "viirs_snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", D(2026, 11, 1)),
        },
    )
    monkeypatch.chdir(tmp_path)  # no .env here
    monkeypatch.setenv("FIRMS_MAP_KEY", "KEY")
    monkeypatch.setenv("FIRMS_OUT_DIR", str(tmp_path))
    monkeypatch.setattr(ff, "fetch_availability", lambda key: AVAIL)
    monkeypatch.setattr(ff, "today", lambda: TODAY)  # pinned: no dependence on the year
    monkeypatch.setattr("sys.argv", ["fetch_firms.py", "--region", "indonesia"])
    assert ff.main() == 0
    assert calls
    assert {bbox for _s, bbox, _st, _d in calls} == {"100.0,-4.0,116.0,3.0"}
    out = tmp_path / "regions" / "indonesia"
    assert (out / "modis" / "2026.csv").exists()
    assert (out / "coverage.json").exists()


@pytest.mark.parametrize("extra", [["--bbox", "1,2,3,4"], ["--out", "somewhere"]])
def test_region_with_bbox_or_out_is_refused(monkeypatch, tmp_path, extra):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FIRMS_MAP_KEY", "KEY")
    monkeypatch.setattr("sys.argv", ["fetch_firms.py", "--region", "iberia", *extra])
    with pytest.raises(SystemExit) as e:
        ff.main()
    assert e.value.code == 2


# ---- key rotation and --region all -------------------------------------------------

KEY_VARS = ("FIRMS_MAP_KEY_1", "FIRMS_MAP_KEY_2", "FIRMS_MAP_KEY")
LIMIT = "Exceeding allowed transaction limit"
CSV = "latitude,longitude\n1,2"


def test_keys_are_read_in_order_without_empties_or_duplicates():
    env = {"FIRMS_MAP_KEY": "c", "FIRMS_MAP_KEY_2": "b", "FIRMS_MAP_KEY_1": "a"}
    assert ff.read_keys(env) == ["a", "b", "c"]
    env = {"FIRMS_MAP_KEY_1": "a", "FIRMS_MAP_KEY_2": "  ", "FIRMS_MAP_KEY": "a"}
    assert ff.read_keys(env) == ["a"]
    assert ff.read_keys({}) == []


class FakeFirms:
    """Fake _session.get: answers by the key found in the URL; records every URL."""

    def __init__(self, monkeypatch, answer):
        self.urls = []
        self.answer = answer
        monkeypatch.setattr(ff._session, "get", self.get)

    def get(self, url, timeout=None):
        self.urls.append(url)
        key = url.split("/csv/")[1].split("/")[0]
        text = self.answer(key, len(self.urls))

        class R:
            status_code = 200

        r = R()
        r.text = text
        return r

    def keys_used(self):
        return [u.split("/csv/")[1].split("/")[0] for u in self.urls]


def test_limit_error_rotates_to_the_next_key_and_retries_that_request(
    tmp_path, monkeypatch, short_products, capsys
):
    fake = FakeFirms(monkeypatch, lambda key, n: LIMIT if key == "SECRET1" else CSV)
    ring = ff.KeyRing(["SECRET1", "SECRET2"])
    ff.run(ring, "1,2,3,4", tmp_path, TODAY, AVAIL)
    used = fake.keys_used()
    assert used[:2] == ["SECRET1", "SECRET2"]
    assert set(used[1:]) == {"SECRET2"}  # never goes back
    # the retried request is the same one, only the key differs
    assert fake.urls[0].replace("SECRET1", "K") == fake.urls[1].replace("SECRET2", "K")
    out = capsys.readouterr()
    assert "usando chave 2 de 2" in out.out + out.err
    assert "SECRET" not in out.out + out.err


def test_other_errors_do_not_rotate(tmp_path, monkeypatch, short_products):
    fake = FakeFirms(monkeypatch, lambda key, n: "Something else went wrong")
    with pytest.raises(SystemExit) as e:
        ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert e.value.code == 2
    assert set(fake.keys_used()) == {"SECRET1"}


def test_every_key_exhausted_exits_3_and_keeps_coverage(
    tmp_path, monkeypatch, short_products, capsys
):
    # the first 7 requests (modis 2025) work; after that every key hits the limit
    fake = FakeFirms(monkeypatch, lambda key, n: CSV if n <= 7 else LIMIT)
    with pytest.raises(SystemExit) as e:
        ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert e.value.code == 3
    assert fake.keys_used()[-2:] == ["SECRET1", "SECRET2"]
    err = capsys.readouterr()
    assert "[PARADO]" in err.err
    assert "SECRET" not in err.out + err.err
    got = json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8"))
    assert got["modis"]["intervals"] == [["2025-12-01", "2025-12-31"]]


def test_invalid_key_is_not_retried_and_moves_on(tmp_path, monkeypatch, short_products, capsys):
    fake = FakeFirms(monkeypatch, lambda key, n: "Invalid MAP_KEY" if key == "SECRET1" else CSV)
    ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert fake.keys_used().count("SECRET1") == 1
    out = capsys.readouterr()
    assert "chave 1 de 2" in out.out + out.err
    assert "SECRET" not in out.out + out.err


def test_only_invalid_key_stops_with_3(tmp_path, monkeypatch, short_products, capsys):
    FakeFirms(monkeypatch, lambda key, n: "Invalid MAP_KEY")
    with pytest.raises(SystemExit) as e:
        ff.run(ff.KeyRing(["SECRET1"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert e.value.code == 3
    out = capsys.readouterr()
    assert "SECRET" not in out.out + out.err


def _all_env(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no .env here
    for name in KEY_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FIRMS_MAP_KEY_1", "SECRET1")
    monkeypatch.setenv("FIRMS_MAP_KEY_2", "SECRET2")
    monkeypatch.setenv("FIRMS_OUT_DIR", str(tmp_path / "raw"))
    monkeypatch.setattr("sys.argv", ["fetch_firms.py", "--region", "all"])


ORDER = ["pantanal", "indonesia", "north_australia", "southern_africa", "iberia"]


def test_region_all_runs_the_five_in_order(tmp_path, monkeypatch):
    _all_env(monkeypatch, tmp_path)
    ran = []

    def fake_run(key, bbox, out_dir, today, availability=None):
        ran.append((key.keys, bbox, out_dir))

    monkeypatch.setattr(ff, "run", fake_run)
    assert ff.main() == 0
    base = tmp_path / "raw"
    assert [r[1] for r in ran] == [ff.REGION_BOXES[n][0] for n in ORDER]
    assert [r[2] for r in ran] == [
        base / ff.REGION_BOXES[n][1] if ff.REGION_BOXES[n][1] else base for n in ORDER
    ]
    assert all(r[0] == ["SECRET1", "SECRET2"] for r in ran)


def test_region_all_stops_after_a_failed_region_and_reports(tmp_path, monkeypatch, capsys):
    _all_env(monkeypatch, tmp_path)
    ran = []

    def fake_run(key, bbox, out_dir, today, availability=None):
        ran.append(bbox)
        if len(ran) == 3:
            raise SystemExit(3)

    monkeypatch.setattr(ff, "run", fake_run)
    assert ff.main() == 3
    assert len(ran) == 3  # southern_africa and iberia never started
    err = capsys.readouterr()
    text = err.out + err.err
    assert "pantanal" in text and "indonesia" in text
    assert "north_australia" in text and "iberia" in text
    assert "SECRET" not in text
    done_line = next(line for line in text.splitlines() if line.startswith("Regiões concluídas"))
    assert "pantanal" in done_line and "indonesia" in done_line
    assert "north_australia" not in done_line


@pytest.mark.parametrize("extra", [["--bbox", "1,2,3,4"], ["--out", "somewhere"]])
def test_region_all_with_bbox_or_out_is_refused(monkeypatch, tmp_path, extra):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FIRMS_MAP_KEY", "KEY")
    monkeypatch.setattr("sys.argv", ["fetch_firms.py", "--region", "all", *extra])
    with pytest.raises(SystemExit) as e:
        ff.main()
    assert e.value.code == 2


# ---- 10-minute window: wait and retry when every key hit the limit ----------------


@pytest.fixture(autouse=True)
def waited(monkeypatch):
    got = []
    monkeypatch.setattr(ff, "wait_window", got.append)
    return got


def test_window_reopens_after_one_wait_and_the_run_completes(
    tmp_path, monkeypatch, short_products, waited, capsys
):
    # request 1 (key 1) and 2 (key 2) hit the limit; after the wait everything works
    fake = FakeFirms(monkeypatch, lambda key, n: LIMIT if n <= 2 else CSV)
    ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert waited == [600]
    assert fake.keys_used()[:3] == ["SECRET1", "SECRET2", "SECRET1"]  # back to the first key
    assert fake.urls[0].replace("SECRET1", "K") == fake.urls[2].replace("SECRET1", "K")
    got = json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8"))
    assert got == EXPECTED
    out = capsys.readouterr()
    assert "10 minutos" in out.err
    assert "SECRET" not in out.out + out.err


def test_persistent_limit_waits_six_times_then_exits_3(
    tmp_path, monkeypatch, short_products, waited, capsys
):
    FakeFirms(monkeypatch, lambda key, n: CSV if n <= 7 else LIMIT)
    with pytest.raises(SystemExit) as e:
        ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert e.value.code == 3
    assert waited == [600] * 6
    out = capsys.readouterr()
    assert "[PARADO]" in out.err
    assert "SECRET" not in out.out + out.err
    got = json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8"))
    assert got["modis"]["intervals"] == [["2025-12-01", "2025-12-31"]]


def test_invalid_in_both_windows_is_dropped_for_good(tmp_path, monkeypatch, short_products, waited):
    def answer(key, n):
        if key == "SECRET1":
            return "Invalid MAP_KEY"
        return LIMIT if n <= 2 else CSV

    fake = FakeFirms(monkeypatch, answer)
    ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert waited == [600]
    used = fake.keys_used()
    assert used[:4] == ["SECRET1", "SECRET2", "SECRET1", "SECRET2"]
    assert used.count("SECRET1") == 2  # tried again after the wait, then dropped


def test_key_invalid_once_is_tried_again_after_the_wait(
    tmp_path, monkeypatch, short_products, waited, capsys
):
    def answer(key, n):
        if key == "SECRET1":
            return LIMIT
        return "Invalid MAP_KEY" if n == 2 else CSV

    fake = FakeFirms(monkeypatch, answer)
    ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    assert waited == [600]
    assert fake.keys_used()[:4] == ["SECRET1", "SECRET2", "SECRET1", "SECRET2"]
    assert json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8")) == EXPECTED
    out = capsys.readouterr()
    assert "chave 2 de 2: MAP_KEY inválida (vai tentar de novo após a espera)" in out.err
    assert "SECRET" not in out.out + out.err


def test_key_invalid_in_two_windows_in_a_row_is_dropped(
    tmp_path, monkeypatch, short_products, waited, capsys
):
    def answer(key, n):
        if key == "SECRET2":
            return "Invalid MAP_KEY"
        return LIMIT if n <= 3 else CSV

    fake = FakeFirms(monkeypatch, answer)
    ff.run(ff.KeyRing(["SECRET1", "SECRET2"]), "1,2,3,4", tmp_path, TODAY, AVAIL)
    used = fake.keys_used()
    assert waited == [600, 600]
    assert used[:5] == ["SECRET1", "SECRET2", "SECRET1", "SECRET2", "SECRET1"]
    assert set(used[5:]) == {"SECRET1"}
    assert json.loads((tmp_path / "coverage.json").read_text(encoding="utf-8")) == EXPECTED
    out = capsys.readouterr()
    assert "SECRET" not in out.out + out.err
