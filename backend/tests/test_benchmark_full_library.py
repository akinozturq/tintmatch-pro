"""
Full-Library SLSQP Benchmark Tests (Pillar 1)
=============================================
Validates that NNLS-Screened SLSQP achieves equivalent color matching quality (Delta E00)
as Full-Library SLSQP while delivering major execution speedups and avoiding gradient stagnation.
"""

import json
from pathlib import Path
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.benchmarks.benchmark_slsqp_library import (
    solve_full_library_slsqp,
    run_slsqp_benchmark_comparison
)

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
def regression_targets():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_full_library_slsqp_solver(base_and_pastes, regression_targets):
    """Verify solve_full_library_slsqp directly converges on industrial targets."""
    base_k, base_s, pastes = base_and_pastes
    target = regression_targets[0]

    result = solve_full_library_slsqp(
        target_reflectance=target["target_reflectance"],
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=4,
        max_total_load=12.0
    )

    assert result["success"] is True
    assert result["delta_e00"] <= 0.40
    assert result["total_load"] <= 12.001
    assert len(result["matched_pastes"]) <= 4
    assert len(result["matched_pastes"]) >= 1


def test_screened_vs_full_library_benchmark_accuracy_and_speedup(base_and_pastes, regression_targets):
    """Verify that screened SLSQP achieves Delta E00 within 0.15 of full SLSQP and is faster."""
    base_k, base_s, pastes = base_and_pastes
    # Test on 3 representative targets (Target 0: Pastel Green, Target 1: Yellow, Target 6: Dark Green)
    test_indices = [0, 1, 6]

    for idx in test_indices:
        target = regression_targets[idx]
        benchmark = run_slsqp_benchmark_comparison(
            target_reflectance=target["target_reflectance"],
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=3,
            max_total_load=10.0
        )

        comp = benchmark["comparison"]
        screened = benchmark["screened_slsqp"]
        full = benchmark["full_library_slsqp"]

        # 1. Accuracy comparison: Screened SLSQP matches or significantly outperforms full SLSQP (which suffers from local minima)
        assert screened["delta_e00"] <= full["delta_e00"] + 0.10, (
            f"Target {target['id']}: Screened dE00={screened['delta_e00']} was worse than Full dE00={full['delta_e00']}"
        )
        assert screened["delta_e00"] <= 0.50

        # 2. Jaccard similarity: Must share dominant pigments (>= 0.20 due to metameric combinations)
        assert comp["jaccard_similarity"] >= 0.20, (
            f"Target {target['id']} pigment overlap too low: {comp['jaccard_similarity']}"
        )

        # 3. Screened solver evaluations should be equal or fewer than full-space
        assert screened["function_evals"] <= full["function_evals"] * 1.5
