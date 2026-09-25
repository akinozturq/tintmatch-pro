"""
Tests for Multi-Start SLSQP Optimization & Solver Integration (Pillar 3)
========================================================================
Validates:
1. Multi-start execution returns expected diagnostic metadata.
2. Invariance of optimality: Multi-start objective loss is monotonically non-increasing
   compared to single-start (loss_multi <= loss_single + 1e-4).
3. Convergence accuracy on difficult targets (Delta E00 <= 0.40).
"""

import json
from pathlib import Path
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.formulation import match_color_ccm
from backend.color_engine.benchmarks.benchmark_multistart import run_multistart_benchmark

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
def target_sample():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        targets = json.load(f)
    return targets[0]["target_reflectance"]


def test_multistart_solver_diagnostics(base_and_pastes, target_sample):
    """Verify that match_color_ccm with enable_multistart=True populates multistart metadata."""
    base_k, base_s, pastes = base_and_pastes

    res = match_color_ccm(
        target_reflectance=target_sample,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=4,
        max_total_load=12.0,
        enable_multistart=True,
        num_starts=3
    )

    rec_a = res["recipes"]["recipe_a"]
    diag = rec_a["diagnostics"]
    assert "multistart" in diag
    m_info = diag["multistart"]
    assert m_info["enabled"] is True
    assert m_info["num_starts_evaluated"] == 3
    assert 0 <= m_info["chosen_start_index"] < 3
    assert rec_a["delta_e00"] <= 0.40


def test_multistart_monotonic_optimality(base_and_pastes, target_sample):
    """Verify that multi-start loss is always less than or equal to single-start loss."""
    base_k, base_s, pastes = base_and_pastes

    benchmark = run_multistart_benchmark(
        target_reflectance=target_sample,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=10.0,
        num_starts=3
    )

    comp = benchmark["comparison"]
    assert comp["multi_start_is_optimal_or_better"] is True, (
        f"Multi-start loss {benchmark['multi_start']['final_loss']} was worse than single-start {benchmark['single_start']['final_loss']}"
    )
    assert benchmark["multi_start"]["delta_e00"] <= 0.40
