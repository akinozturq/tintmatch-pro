"""
Tests for NNLS Candidate-Screening Ablation Study (Pillar 2)
============================================================
Validates the sensitivity of CCM matching accuracy to:
1. Candidate pool size K (from K=2 to K=6).
2. Screening method (NNLS vs. Correlation vs. Greedy Forward Selection).
"""

import json
from pathlib import Path
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.benchmarks.benchmark_nnls_ablation import evaluate_screening_configuration

DATA_PATH = Path(__file__).resolve().parent / "data" / "regression_targets.json"


@pytest.fixture(scope="module")
def base_and_pastes():
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes WHERE id <= 6").fetchall()
    conn.close()

    base_k = np.array(json.loads(base_row["absorption_k"]))
    base_s = np.array(json.loads(base_row["scattering_s"]))

    pastes = [
        {
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "hex": r["color_hex"],
            "unit_k": json.loads(r["unit_k"]),
            "unit_s": json.loads(r["unit_s"])
        }
        for r in paste_rows
    ]
    return base_k, base_s, pastes


@pytest.fixture(scope="module")
def target_green():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        targets = json.load(f)
    return targets[0]["target_reflectance"]


def test_pool_size_monotonic_improvement(base_and_pastes, target_green):
    """Verify that expanding pool size K from 2 to 5 improves or maintains low Delta E00."""
    base_k, base_s, pastes = base_and_pastes

    de00_by_k = {}
    for k in [2, 3, 5]:
        eval_res = evaluate_screening_configuration(
            target_reflectance=target_green,
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            method="nnls",
            pool_size=k,
            max_pastes=3,
            max_total_load=10.0
        )
        de00_by_k[k] = eval_res["delta_e00"]

    # K=5 must achieve high accuracy <= 0.40
    assert de00_by_k[5] <= 0.40
    # K=5 should be equal to or better than K=2
    assert de00_by_k[5] <= de00_by_k[2] + 0.05


def test_screening_method_comparison(base_and_pastes, target_green):
    """Verify that NNLS, correlation, and greedy forward screening all converge to feasible recipes."""
    base_k, base_s, pastes = base_and_pastes

    methods = ["nnls", "correlation", "greedy"]
    results = {}
    for m in methods:
        eval_res = evaluate_screening_configuration(
            target_reflectance=target_green,
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            method=m,
            pool_size=4,
            max_pastes=3,
            max_total_load=10.0
        )
        results[m] = eval_res

    # NNLS and Greedy forward selection both identify the critical yellow colorant (Delta E00 <= 0.10)
    assert results["nnls"]["delta_e00"] <= 0.10, f"NNLS Delta E00 too high: {results['nnls']['delta_e00']}"
    assert results["greedy"]["delta_e00"] <= 0.10, f"Greedy Delta E00 too high: {results['greedy']['delta_e00']}"

    # Naive correlation misses bright enhancers (Yellow) in favor of dark absorbers, resulting in high Delta E00
    assert results["correlation"]["delta_e00"] > 1.0, "Correlation unexpectedly matched without yellow"
    assert results["nnls"]["delta_e00"] < results["correlation"]["delta_e00"]
