"""
TintMatch PRO - Deterministic Regression Test Suite (Set C)
===========================================================
Validates the CCM Engine 2.0 against 10 pre-calibrated industrial color targets.
Guarantees:
1. Multi-profile optimization (Recipe A, B, C) converges reliably with ΔE00 <= 0.50.
2. SLSQP mass inequality constraints (sum(c_i) <= max_total_load) are strictly satisfied.
3. Deterministic repeatability up to 1e-4 tolerance.
4. Correct DIN 6172 / ASTM E805 Composite Metamerism Index calculation.
5. Analytical pigment sensitivity matrix correctness.
"""

import json
from pathlib import Path
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.formulation import match_color_ccm, predict_recipe, calculate_pigment_sensitivity_matrix
from backend.color_engine.profiles import PROFILE_COLOR_MATCH, PROFILE_LIGHT_STABILITY, PROFILE_ECONOMY

DATA_PATH = Path(__file__).resolve().parent / "data" / "regression_targets.json"


@pytest.fixture(scope="module")
def base_and_pastes():
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes").fetchall()
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


def test_set_c_all_targets_convergence(base_and_pastes, regression_targets):
    """Verifies that all 10 industrial targets converge within the 0.50 ΔE00 threshold."""
    base_k, base_s, pastes = base_and_pastes
    assert len(regression_targets) == 10

    for target in regression_targets:
        target_r = target["target_reflectance"]
        result = match_color_ccm(
            target_reflectance=target_r,
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=12.0
        )

        assert result["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"], (
            f"Target {target['id']} solver status was {result['status']}"
        )
        assert result["delta_e00"] <= 0.50, (
            f"Target {target['id']} ({target['name']}) ΔE00={result['delta_e00']} exceeded threshold 0.50"
        )
        assert result["total_colorant_load"] <= 12.001, (
            f"Target {target['id']} exceeded max total load constraint"
        )
        assert len(result["matched_pastes"]) <= 4
        assert len(result["matched_pastes"]) >= 1

        # Check all 3 recipes exist
        recipes = result["recipes"]
        assert "recipe_a" in recipes
        assert "recipe_b" in recipes
        assert "recipe_c" in recipes

        # Check sensitivity matrix
        sens = result["sensitivity_matrix"]
        assert len(sens) == len(result["matched_pastes"])
        for item in sens:
            assert "paste_id" in item
            assert "name" in item
            assert "d_de00_dc" in item
            assert "d_L_dc" in item
            assert "interpretation" in item


def test_deterministic_repeatability(base_and_pastes, regression_targets):
    """Verifies that two consecutive runs produce numerically identical results within 1e-4."""
    base_k, base_s, pastes = base_and_pastes
    target = regression_targets[0]
    target_r = target["target_reflectance"]

    run1 = match_color_ccm(target_r, base_k, base_s, pastes, max_pastes=3, max_total_load=10.0)
    run2 = match_color_ccm(target_r, base_k, base_s, pastes, max_pastes=3, max_total_load=10.0)

    assert abs(run1["delta_e00"] - run2["delta_e00"]) < 1e-4
    assert abs(run1["total_colorant_load"] - run2["total_colorant_load"]) < 1e-4
    assert len(run1["matched_pastes"]) == len(run2["matched_pastes"])

    for p1, p2 in zip(run1["matched_pastes"], run2["matched_pastes"]):
        assert p1["id"] == p2["id"]
        assert abs(p1["concentration"] - p2["concentration"]) < 1e-3


def test_slsqp_mass_constraint_strictness(base_and_pastes, regression_targets):
    """Enforces strict sum(c_i) <= max_total_load with a tight bound (e.g. 1.0%)."""
    base_k, base_s, pastes = base_and_pastes
    # Use dark target (Target 7: Forest Green) which wants ~2.5% load
    target = regression_targets[6]
    target_r = target["target_reflectance"]

    tight_limit = 1.0
    result = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=tight_limit
    )

    assert result["total_colorant_load"] <= tight_limit + 1e-4, (
        f"Total load {result['total_colorant_load']} strictly exceeded limit {tight_limit}"
    )


def test_metamerism_composite_definition(base_and_pastes, regression_targets):
    """Validates DIN 6172 / ASTM E805 Composite MI definition: max(MI(A), MI(F11))."""
    base_k, base_s, pastes = base_and_pastes
    target = regression_targets[1]
    result = match_color_ccm(target["target_reflectance"], base_k, base_s, pastes)

    mi_data = result["prediction"]["comparison"]["metamerism"]
    expected_composite = max(mi_data["MI_A"], mi_data["MI_F11"])
    assert abs(result["composite_mi"] - expected_composite) < 1e-3
    assert result["composite_mi"] >= 0.0


def test_pigment_sensitivity_direction(base_and_pastes):
    """Validates that dark pigments have negative lightness derivative dL/dc."""
    base_k, base_s, pastes = base_and_pastes
    black_paste = next((p for p in pastes if "Black" in p["name"]), pastes[0])

    matched_pastes = [
        {
            "id": black_paste["id"],
            "name": black_paste["name"],
            "code": black_paste["code"],
            "hex": black_paste["hex"],
            "concentration": 0.5,
            "unit_k": black_paste["unit_k"],
            "unit_s": black_paste["unit_s"]
        }
    ]

    matrix = calculate_pigment_sensitivity_matrix(
        base_k=base_k,
        base_s=base_s,
        matched_pastes=matched_pastes,
        delta=0.05
    )

    assert len(matrix) == 1
    # Adding black must decrease L* (darken shade)
    assert matrix[0]["d_L_dc"] < 0.0, "Carbon Black must have negative dL/dc"
    assert "Darkens" in matrix[0]["interpretation"]
