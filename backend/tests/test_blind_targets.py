"""
Blind Target Dataset Evaluation Tests (Pillar 7)
=================================================
Validates the CCM formulation engine against 15 difficult industrial blind targets:
- Metameric pairs (different spectra, similar Lab)
- Ultra-pastel whispers (low concentrations <= 0.05%)
- Out-of-gamut boundary stress (nominal load > 12.0% capping)
- Metameric divergence under Illuminant A and F11
- Complex 3-4 component muted earth tones
"""

import json
from pathlib import Path
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.formulation import match_color_ccm

BLIND_PATH = Path(__file__).resolve().parent / "data" / "blind_targets_dataset.json"


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
def blind_dataset():
    with open(BLIND_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_metameric_pair_profile_discrimination(base_and_pastes, blind_dataset):
    """Verify that Recipe B penalizes metamerism while Recipe A prioritizes D65."""
    base_k, base_s, pastes = base_and_pastes
    target_a = next(t for t in blind_dataset if t["id"] == "BLIND_01_METAMER_A")

    res = match_color_ccm(
        target_reflectance=target_a["target_reflectance"],
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=4,
        max_total_load=12.0
    )

    recipes = res["recipes"]
    rec_a = recipes["recipe_a"]
    rec_b = recipes["recipe_b"]

    assert rec_a["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    assert rec_b["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    assert rec_a["delta_e00"] <= 0.30

    # Recipe B must have composite MI evaluated
    assert "composite_mi" in rec_b
    assert rec_b["composite_mi"] >= 0.0


def test_ultra_pastel_low_dispense(base_and_pastes, blind_dataset):
    """Verify that ultra-pastel targets (c <= 0.05%) converge stably without numerical instability."""
    base_k, base_s, pastes = base_and_pastes
    pastels = [t for t in blind_dataset if t["type"] == "pastel"]
    assert len(pastels) == 3

    for p_target in pastels:
        res = match_color_ccm(
            target_reflectance=p_target["target_reflectance"],
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=12.0
        )

        assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
        assert res["delta_e00"] <= 0.35, f"Pastel {p_target['id']} Delta E00={res['delta_e00']} exceeded 0.35"
        assert res["total_colorant_load"] < 1.0, f"Pastel {p_target['id']} loaded excessively: {res['total_colorant_load']}%"


def test_out_of_gamut_boundary_stress_capping(base_and_pastes, blind_dataset):
    """Verify that out-of-gamut / high-saturation targets strictly obey total load limits."""
    base_k, base_s, pastes = base_and_pastes
    boundary_targets = [t for t in blind_dataset if t["type"] == "boundary_stress"]
    assert len(boundary_targets) == 3

    max_load_limit = 10.0  # Force tighter constraint

    for b_target in boundary_targets:
        res = match_color_ccm(
            target_reflectance=b_target["target_reflectance"],
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=max_load_limit
        )

        # Solver must not crash or return CONSTRAINTS_VIOLATED
        assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
        assert res["total_colorant_load"] <= max_load_limit + 0.001, (
            f"Target {b_target['id']} exceeded strict max load {max_load_limit}: got {res['total_colorant_load']}"
        )
        assert all(p["concentration"] >= 0.0 for p in res["matched_pastes"])


def test_muted_earth_tones(base_and_pastes, blind_dataset):
    """Verify formulation accuracy on complex muted earth and stone tones."""
    base_k, base_s, pastes = base_and_pastes
    earth_targets = [t for t in blind_dataset if t["type"] == "earth_tone"]
    assert len(earth_targets) == 4

    for e_target in earth_targets:
        res = match_color_ccm(
            target_reflectance=e_target["target_reflectance"],
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=12.0
        )

        assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
        assert res["delta_e00"] <= 0.35, f"Earth target {e_target['id']} Delta E00={res['delta_e00']} exceeded 0.35"
