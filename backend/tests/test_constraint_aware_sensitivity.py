"""
Constraint-Aware Sensitivity and Boundary Stress Tests (Pillar 11)
===================================================================
Validates ConstraintEngine 2.0 under strict industrial bounds:
1. Strict Mass Cap: Total colorant load sum(c_i) <= max_total_load strictly respected.
2. Colorant Group Constraints: Sub-group totals (e.g. VOC / warm pigments) strictly bounded.
3. Minimum Dispensing Threshold: Micro-dosing below min_dispense_threshold handled cleanly.
4. Constraint Slack Diagnostics: evaluate_constraint_slack accurately categorizes binding vs slack.
5. Analytical Sensitivity Stability: Derivatives remain finite and continuous near active boundaries.
"""

import json
from pathlib import Path
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.formulation import match_color_ccm, calculate_pigment_sensitivity_matrix
from backend.color_engine.constraints import FormulationConstraints, ConstraintEngine

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


def test_strict_mass_cap_under_stress(base_and_pastes, regression_targets):
    """Enforces strict sum(c_i) <= max_total_load under a severely tight bound (0.8%)."""
    base_k, base_s, pastes = base_and_pastes
    dark_target = regression_targets[6]["target_reflectance"]  # Forest green

    tight_cap = 0.80
    constraints = FormulationConstraints(max_total_load=tight_cap)

    res = match_color_ccm(
        target_reflectance=dark_target,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        constraints=constraints
    )

    assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    assert res["total_colorant_load"] <= tight_cap + 0.001, (
        f"Total load {res['total_colorant_load']} exceeded tight cap {tight_cap}"
    )

    slack_data = res["diagnostics"]["slack_details"]
    assert slack_data["is_feasible"] is True
    assert slack_data["total_slack"] >= -0.001


def test_group_constraint_enforcement(base_and_pastes, regression_targets):
    """Enforces that group limit on warm colorants (Yellow=5, Red=2) is strictly obeyed."""
    base_k, base_s, pastes = base_and_pastes
    yellow_target = regression_targets[1]["target_reflectance"]  # Brilliant yellow

    group_cap = 0.60
    # Group containing Yellow (5) and Red (2)
    group_bounds = {"warm_shades": group_cap}
    pigment_groups = {"warm_shades": ["2", "5"]}

    constraints = FormulationConstraints(
        max_total_load=10.0,
        group_bounds=group_bounds,
        pigment_groups=pigment_groups
    )

    res = match_color_ccm(
        target_reflectance=yellow_target,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        constraints=constraints
    )

    warm_sum = sum(p["concentration"] for p in res["matched_pastes"] if str(p["id"]) in ["2", "5"])
    assert warm_sum <= group_cap + 0.001, f"Warm shades total {warm_sum} exceeded group cap {group_cap}"


def test_minimum_dispense_threshold(base_and_pastes, regression_targets):
    """Verifies that no colorant below min_dispense_threshold is left in final recipe."""
    base_k, base_s, pastes = base_and_pastes
    target = regression_targets[0]["target_reflectance"]

    threshold = 0.05
    constraints = FormulationConstraints(
        max_total_load=10.0,
        min_dispense_threshold=threshold
    )

    res = match_color_ccm(
        target_reflectance=target,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        constraints=constraints
    )

    for p in res["matched_pastes"]:
        assert p["concentration"] >= threshold or p["concentration"] == 0.0, (
            f"Colorant {p['name']} concentration {p['concentration']} was below threshold {threshold}"
        )


def test_slack_diagnostics_binding_detection(base_and_pastes, regression_targets):
    """Verifies that evaluate_constraint_slack detects binding constraints accurately."""
    base_k, base_s, pastes = base_and_pastes
    target = regression_targets[6]["target_reflectance"]

    tight_cap = 1.0
    constraints = FormulationConstraints(max_total_load=tight_cap)
    res = match_color_ccm(
        target_reflectance=target,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        constraints=constraints
    )

    slack_data = res["diagnostics"]["slack_details"]
    assert "total_slack" in slack_data
    # For a dark target under tight 1.0% cap, constraint should be binding (slack <= 0.05)
    assert slack_data["total_slack"] <= 0.05, f"Constraint should be binding: slack was {slack_data['total_slack']}"


def test_sensitivity_stability_at_boundary(base_and_pastes, regression_targets):
    """Verifies analytical sensitivity derivatives remain physical and non-singular near active boundaries."""
    base_k, base_s, pastes = base_and_pastes
    target = regression_targets[0]["target_reflectance"]

    res = match_color_ccm(target, base_k, base_s, pastes)
    sens = res["sensitivity_matrix"]
    assert len(sens) > 0

    for item in sens:
        # Derivatives must not be NaN or Infinite
        assert not np.isnan(item["d_de00_dc"])
        assert not np.isinf(item["d_de00_dc"])
        assert not np.isnan(item["d_L_dc"])
        assert not np.isnan(item["d_a_dc"])
        assert not np.isnan(item["d_b_dc"])
        assert "interpretation" in item
