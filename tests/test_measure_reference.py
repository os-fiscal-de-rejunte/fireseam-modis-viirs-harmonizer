import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "measure_reference", ROOT / "src/scripts/measure_reference.py"
)
mr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mr)


def test_measure_counts(tmp_path):
    weeks = [
        {"year": y, "week": w, "modis": 5, "status": "observed", "nrt": False}
        for y in range(2001, 2027)
        for w in range(1, 53)
    ]
    assert len(weeks) == 1352
    by = {(w["year"], w["week"]): w for w in weeks}
    by[(2001, 24)]["status"] = "gap"
    for w in (1, 2, 3):
        by[(2005, w)]["status"] = "estimated"
    by[(2005, 2)]["modis"] = 0
    by[(2013, 9)]["status"] = "estimated"
    for w in (40, 41):
        by[(2026, w)]["nrt"] = True
    by[(2026, 30)]["status"] = "gap"
    for w in range(45, 53):
        by[(2026, w)]["status"] = "gap"
    path = tmp_path / "calendar.json"
    path.write_text(json.dumps({"meta": {}, "weeks": weeks}), encoding="utf-8")
    got = mr.measure(tmp_path)
    assert got == {
        "export_bytes": path.stat().st_size,
        "as_of_week": [2026, 44],
        "gap_weeks_file": 10,
        "gap_weeks_f1": 2,
        "gap_weeks_2026": [30],
        "estimated": 4,
        "estimated_2012_on": 1,
        "nrt": 2,
        "no_factor": 1,
    }
