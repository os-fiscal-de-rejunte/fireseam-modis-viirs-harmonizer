"""Measure the Pantanal reference counts of an export.

Usage: python src/scripts/measure_reference.py [--data web/public/data]
                                               [--out web/src/pantanal.reference.json]
"""

import argparse
import json
from pathlib import Path


def measure(data_root: Path) -> dict:
    data_root = Path(data_root)
    export_bytes = sum(
        p.stat().st_size
        for p in data_root.rglob("*")
        if p.is_file()
        and p.relative_to(data_root).parts[0] != "regions"
        and p.relative_to(data_root).as_posix() != "regions.json"
    )
    cal = json.loads((data_root / "calendar.json").read_text(encoding="utf-8"))
    weeks = cal["weeks"]
    last = max((i for i, w in enumerate(weeks) if w["status"] != "gap"), default=-1)
    as_of = [weeks[last]["year"], weeks[last]["week"]]
    counted = weeks[: last + 1]
    estimated = [w for w in weeks if w["status"] == "estimated"]
    return {
        "export_bytes": export_bytes,
        "as_of_week": as_of,
        "gap_weeks_file": sum(w["status"] == "gap" for w in weeks),
        "gap_weeks_f1": sum(w["status"] == "gap" for w in counted),
        "gap_weeks_2026": [
            w["week"] for w in counted if w["status"] == "gap" and w["year"] == 2026
        ],
        "estimated": len(estimated),
        "estimated_2012_on": sum(w["year"] >= 2012 for w in estimated),
        "nrt": sum(bool(w.get("nrt")) for w in weeks),
        "no_factor": sum(not w.get("modis") for w in estimated),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="web/public/data")
    ap.add_argument("--out", default="web/src/pantanal.reference.json")
    args = ap.parse_args()
    out = Path(args.out)
    old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    new = measure(Path(args.data))
    for k, v in new.items():
        print(f"{k}: {old.get(k)} -> {v}")
    out.write_text(json.dumps(new, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
