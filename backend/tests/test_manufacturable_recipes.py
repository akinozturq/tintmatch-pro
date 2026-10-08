"""
Tests for Manufacturable Recipes, Deterministic Hashing, Recipe Confidence, and Physical Verification
===================================================================================================
Covers Phase C, Phase D, Phase E, and Phase F:
1. Grams weighing calculation & 0.01g rounding re-prediction
2. Dynamic minimum dispense threshold based on batch size and scale resolution
3. Lexicographic candidate ranking (commercial simplicity)
4. Deterministic input_hash and output_hash
5. Recipe confidence evaluation with operator guidance
6. Physical drawdown verification endpoint and add-back suggestion
"""

import json
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database.db import get_db_connection
from backend.color_engine.constraints import FormulationConstraints, ConstraintEngine
from backend.color_engine.formulation import compute_manufacturable_recipe
from backend.color_engine.recipe_confidence import evaluate_recipe_confidence
from backend.color_engine.hashing import compute_formulation_input_hash, compute_recipe_output_hash


@pytest.fixture
def client():
    return TestClient(app)


def test_effective_min_dispense_threshold_dynamic():
    """Verify that scale resolution and batch size dynamically determine minimum wt% threshold."""
    # 100g lab batch on 0.01g scale -> min wt% is 0.01%
    c_100g = FormulationConstraints(batch_size_g=100.0, scale_resolution_g=0.01)
    assert pytest.approx(c_100g.effective_min_dispense_wt, 1e-5) == 0.01

    # 1000g batch on 0.01g scale -> min wt% is 0.001%
    c_1000g = FormulationConstraints(batch_size_g=1000.0, scale_resolution_g=0.01)
    assert pytest.approx(c_1000g.effective_min_dispense_wt, 1e-5) == 0.001

    # If user specifies higher min_dispense_threshold (e.g. 0.05%), it respects the higher limit
    c_custom = FormulationConstraints(batch_size_g=1000.0, scale_resolution_g=0.01, min_dispense_threshold=0.05)
    assert pytest.approx(c_custom.effective_min_dispense_wt, 1e-5) == 0.05


def test_compute_manufacturable_recipe_rounding():
    """Verify conversion from floating-point wt% to physical grams rounded to scale precision."""
    pastes = [
        {"id": 1, "name": "Yellow", "concentration": 1.237, "unit_k": [0.1]*31, "unit_s": [0.01]*31},
        {"id": 2, "name": "Red", "concentration": 0.481, "unit_k": [0.2]*31, "unit_s": [0.01]*31},
        {"id": 3, "name": "Black", "concentration": 0.072, "unit_k": [1.0]*31, "unit_s": [0.01]*31},
    ]

    base_k = [0.02] * 31
    base_s = [1.0] * 31

    # 1000 g batch:
    res = compute_manufacturable_recipe(
        matched_pastes=pastes,
        batch_size_g=1000.0,
        scale_resolution_g=0.01,
        base_k=base_k,
        base_s=base_s
    )

    # 1.237% of 1000g = 12.37g
    # 0.481% of 1000g = 4.81g
    # 0.072% of 1000g = 0.72g
    # Total paste = 17.90g
    # Base = 1000 - 17.90 = 982.10g
    assert res["total_paste_g"] == 17.90
    assert res["base_amount_g"] == 982.10
    assert len(res["matched_pastes"]) == 3
    assert res["matched_pastes"][0]["amount_g"] == 12.37
    assert res["matched_pastes"][1]["amount_g"] == 4.81
    assert res["matched_pastes"][2]["amount_g"] == 0.72
    assert res["prediction"] is not None


def test_recipe_confidence_evaluation():
    """Verify recipe confidence evaluation and actionable Turkish operator guidance."""
    recipe = {
        "matched_pastes": [
            {"id": 1, "name": "Yellow", "amount_g": 12.40, "concentration": 1.24, "status": "ACTIVE"},
            {"id": 2, "name": "Red", "amount_g": 3.80, "concentration": 0.38, "status": "ACTIVE"}
        ],
        "delta_e00": 0.18,
        "status": "OPTIMAL_CONVERGED",
        "scale_resolution_g": 0.01,
        "batch_size_g": 1000.0,
        "geometry": "d/8°",
        "measurement_mode": "SCI"
    }

    conf = evaluate_recipe_confidence(recipe, tolerance_de00=0.30)
    assert conf["confidence_level"] == "HIGH"
    assert conf["status_color"] == "green"
    assert any("0.01 g terazi hassasiyetinde" in g for g in conf["operator_guidance"])
    assert any("tolerans içinde" in g for g in conf["operator_guidance"])

    # High delta_e00 should downgrade confidence
    recipe_poor = dict(recipe)
    recipe_poor["delta_e00"] = 1.10
    conf_poor = evaluate_recipe_confidence(recipe_poor, tolerance_de00=0.30)
    assert conf_poor["confidence_level"] == "LOW"
    assert conf_poor["status_color"] == "red"


def test_deterministic_input_output_hashes():
    """Verify input_hash and output_hash are order-independent and deterministic."""
    target_r = [0.5] * 31
    base_k = [0.01] * 31
    base_s = [1.0] * 31
    pastes_a = [
        {"id": 1, "code": "P1", "unit_k": [0.1]*31, "unit_s": [0.01]*31},
        {"id": 2, "code": "P2", "unit_k": [0.2]*31, "unit_s": [0.02]*31}
    ]
    pastes_b = [pastes_a[1], pastes_a[0]] # reversed order

    h1 = compute_formulation_input_hash(target_r, base_k, base_s, pastes_a, batch_size_g=1000.0)
    h2 = compute_formulation_input_hash(target_r, base_k, base_s, pastes_b, batch_size_g=1000.0)
    # Order-independent input hash
    assert h1 == h2

    # Output hash
    matched_a = [
        {"id": 1, "code": "P1", "concentration": 1.25, "amount_g": 12.50},
        {"id": 2, "code": "P2", "concentration": 0.50, "amount_g": 5.00}
    ]
    matched_b = [matched_a[1], matched_a[0]]
    out_h1 = compute_recipe_output_hash(matched_a, delta_e00=0.18, total_load=1.75, batch_size_g=1000.0)
    out_h2 = compute_recipe_output_hash(matched_b, delta_e00=0.18, total_load=1.75, batch_size_g=1000.0)
    assert out_h1 == out_h2


def test_match_target_api_manufacturable_response(client):
    """Test formulation match endpoint returns amounts in grams, confidence card, and dual hashes."""
    target_r = [0.5] * 31
    payload = {
        "target_reflectance": target_r,
        "base_id": 1,
        "batch_size_g": 2000.0,
        "scale_resolution_g": 0.01,
        "max_pastes": 3
    }
    resp = client.post("/api/formulation/match", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    # Check manufacturable properties
    assert "base_amount_g" in data
    assert "total_colorant_g" in data
    assert data["batch_size_g"] == 2000.0
    assert data["scale_resolution_g"] == 0.01
    assert "input_hash" in data
    assert "output_hash" in data
    assert "recipe_confidence" in data
    assert data["recipe_confidence"]["confidence_level"] in ("HIGH", "MEDIUM", "LOW", "BLOCKED")

    for paste in data["matched_pastes"]:
        assert "amount_g" in paste
        assert paste["amount_g"] >= 0.01


def test_physical_drawdown_verification_lifecycle(client):
    """Test the complete physical drawdown verification and add-back feedback loop (Phase F)."""
    # 1. Save a sample recipe
    save_payload = {
        "name": "Drawdown Test Recipe",
        "base_id": 1,
        "pastes": [{"id": 1, "name": "Yellow", "concentration": 1.5, "amount_g": 15.0}],
        "predicted_reflectance": [0.55] * 31,
        "lab": {"L": 60.0, "a": 10.0, "b": 20.0},
        "hex_color": "#d97706",
        "delta_e00": 0.15,
        "batch_size_g": 1000.0,
        "scale_resolution_g": 0.01
    }
    save_resp = client.post("/api/formulation/recipes", json=save_payload)
    assert save_resp.status_code == 200
    recipe_id = save_resp.json()["id"]

    # 2. Record physical drawdown measurement (good match, Delta E <= 0.40)
    good_drawdown = {
        "measured_reflectance": [0.55] * 31,
        "sample_name": "Drawdown Trial #1",
        "batch_size_g": 1000.0
    }
    res_resp = client.post(f"/api/formulation/recipes/{recipe_id}/attempts/1/result", json=good_drawdown)
    assert res_resp.status_code == 200
    res_data = res_resp.json()
    assert res_data["outcome"] == "ACCEPTED"
    assert res_data["de00_predicted_vs_measured"] <= 0.40

    # 3. Record an off-shade physical drawdown (Delta E > 0.40 but <= 1.50)
    off_shade_drawdown = {
        "measured_reflectance": [0.53] * 31, # slight off-shade (dE00 ~ 0.82)
        "sample_name": "Drawdown Trial #1 Off Shade",
        "batch_size_g": 1000.0
    }
    res_off = client.post(f"/api/formulation/recipes/{recipe_id}/attempts/1/result", json=off_shade_drawdown)
    assert res_off.status_code == 200
    off_data = res_off.json()
    assert off_data["outcome"] == "ADDBACK_REQUIRED"
    assert off_data["de00_predicted_vs_measured"] > 0.40
    assert "addback_suggestion" in off_data
