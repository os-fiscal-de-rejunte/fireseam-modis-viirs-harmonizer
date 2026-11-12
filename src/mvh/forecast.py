"""Adapter that turns released PYRO model artifacts into one static forecast.json."""

import argparse
import json
import math
import os
import sys
from pathlib import Path

SOURCE = "os-fiscal-de-rejunte/exp-pyro-predictive"
EVENT = (
    "At least one MOD14A2 fire pixel in the 8-day composite, given a fully valid 41x41-pixel mask"
)
HORIZON_DAYS = 8
TEST_KEYS = ("n", "accuracy", "recall", "precision", "brier", "roc_auc")


def _read(artifacts: Path, rel: str):
    path = artifacts / rel
    if not path.is_file():
        raise FileNotFoundError(f"missing PYRO artifact: {rel} (looked in {artifacts})")
    return json.loads(path.read_text(encoding="utf-8"))


def _beta_params(model: dict, method: str, cell_id: str, continent: str, month: int) -> list:
    # Same lookup order as the released predictor: specific entry, month, global.
    fallback = model["month"].get(str(month), model["global"])
    if method == "seasonal":
        return model["region_month"].get(cell_id, {}).get(str(month), fallback)
    return model["continent_month"].get(continent, {}).get(str(month), fallback)


def _months(model: dict, group: dict, cell_id: str, continent: str) -> list:
    method = group.get("static_projection_model")
    if method not in ("seasonal", "regional_seasonal"):
        return [None] * 12
    allowed = set(group.get("static_projection_months", []))
    out = []
    for month in range(1, 13):
        if month not in allowed:
            out.append(None)
            continue
        a, b = _beta_params(model, method, cell_id, continent, month)
        out.append(round(a / (a + b), 3))
    return out


def build_forecast(artifacts: Path) -> dict:
    artifacts = Path(artifacts)
    cells = _read(artifacts, "evaluation/cells.json")["cells"]
    geo = _read(artifacts, "coverage.geojson")["features"]
    model = _read(artifacts, "baseline_model.json")
    groups = _read(artifacts, "release_policy.json")["groups"]
    metrics = _read(artifacts, "evaluation/metrics.json")

    rings = {f["properties"]["cell_id"]: f["geometry"]["coordinates"][0] for f in geo}
    out_cells = []
    for c in sorted(cells, key=lambda c: c["cell_id"]):
        cid = c["cell_id"]
        released = bool(c["forecast_supported"])
        if cid not in rings:
            raise ValueError(f"cell {cid} has no polygon in coverage.geojson")
        p = [None] * 12
        if released:
            p = _months(model, groups.get(cid, {}), cid, c["continent"])
        out_cells.append(
            {
                "id": cid,
                "continent": c["continent"],
                "released": released,
                "polygon": [[round(x, 4), round(y, 4)] for x, y in rings[cid]],
                "p": p,
            }
        )

    test = metrics["released_test"]
    forecast = {
        "meta": {
            "source": SOURCE,
            "model_version": metrics["version"],
            "event": EVENT,
            "horizon_days": HORIZON_DAYS,
            "cells_total": metrics["catalog_cells"],
            "cells_released": metrics["released_cells"],
            "released_area_km2": round(metrics["released_area_km2"]),
            "test": {k: (test[k] if k == "n" else round(test[k], 4)) for k in TEST_KEYS},
        },
        "cells": out_cells,
    }
    validate_forecast(forecast)
    return forecast


def _fail(field: str, msg: str):
    raise ValueError(f"{field}: {msg}")


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validate_forecast(obj: dict) -> None:
    meta = obj.get("meta")
    if not isinstance(meta, dict):
        _fail("meta", "must be an object")
    for key in ("source", "model_version", "event"):
        if not isinstance(meta.get(key), str):
            _fail(f"meta.{key}", "must be a string")
    for key in ("horizon_days", "cells_total", "cells_released", "released_area_km2"):
        if not _is_int(meta.get(key)):
            _fail(f"meta.{key}", "must be an integer")
    test = meta.get("test")
    if not isinstance(test, dict) or set(test) != set(TEST_KEYS):
        _fail("meta.test", f"must have keys {list(TEST_KEYS)}")
    cells = obj.get("cells")
    if not isinstance(cells, list):
        _fail("cells", "must be a list")
    seen = set()
    released = 0
    for c in cells:
        cid = c.get("id")
        if not isinstance(cid, str) or cid in seen:
            _fail("id", f"missing or duplicated id {cid!r}")
        seen.add(cid)
        if not isinstance(c.get("continent"), str):
            _fail("continent", f"cell {cid} must have a string continent")
        if not isinstance(c.get("released"), bool):
            _fail("released", f"cell {cid} must be a boolean")
        released += c["released"]
        ring = c.get("polygon")
        if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
            _fail("polygon", f"cell {cid} must be a closed ring with >= 4 points")
        for pt in ring:
            ok = (
                isinstance(pt, list)
                and len(pt) == 2
                and all(isinstance(v, int | float) and not isinstance(v, bool) for v in pt)
                and -180 <= pt[0] <= 180
                and -90 <= pt[1] <= 90
            )
            if not ok:
                _fail("polygon", f"cell {cid} has an invalid [lon, lat] point {pt!r}")
        p = c.get("p")
        if not isinstance(p, list) or len(p) != 12:
            _fail("p", f"cell {cid} must have exactly 12 entries")
        for v in p:
            if v is None:
                continue
            ok = isinstance(v, int | float) and not isinstance(v, bool)
            if not ok or math.isnan(v) or not 0 <= v <= 1:
                _fail("p", f"cell {cid} has an invalid probability {v!r}")
        if not c["released"] and any(v is not None for v in p):
            _fail("p", f"cell {cid} is not released but has probabilities")
    if meta["cells_released"] != released:
        _fail("cells_released", f"meta says {meta['cells_released']}, cells have {released}")
    if meta["cells_total"] != len(cells):
        _fail("cells_total", f"meta says {meta['cells_total']}, cells have {len(cells)}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m mvh.forecast")
    parser.add_argument("--pyro", default=os.environ.get("PYRO_ARTIFACTS_DIR"))
    parser.add_argument(
        "--out",
        default=str(
            Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "forecast.json"
        ),
    )
    args = parser.parse_args()
    if not args.pyro:
        print("error: pass --pyro PATH or set PYRO_ARTIFACTS_DIR", file=sys.stderr)
        sys.exit(2)
    try:
        forecast = build_forecast(Path(args.pyro))
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(2)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(forecast, separators=(",", ":"), ensure_ascii=False)
    out.write_text(text + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
