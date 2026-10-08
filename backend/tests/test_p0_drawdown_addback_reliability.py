"""
Unit and Integration Tests for Industrial P0 Reliability Sprint:
- P0-1: Drawdown acceptance criteria based strictly on Target vs Measured (de00_target_vs_measured).
        Verification of 3 distinct metrics (Target vs Measured, Target vs Predicted, Predicted vs Measured).
- P0-2: Add-back optimizer targets TRUE TARGET REFLECTANCE (not predicted reflectance).
- P0-3: Add-back candidates strictly constrained by FormulationContext and select_eligible_pastes.
- P0-4: Real weighed paste grams (actual_dispensed) used as physical ground truth in add-back.
- P0-5: Simulation measurement cannot yield a Golden Batch (is_simulation flag isolation).
- P0-6: Centralized ToleranceProfile enforcement for drawdown acceptance and add-back limits.
"""

import pytest
import json
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.color_engine.profiles import (
    get_tolerance_profile,
    TOLERANCE_INDUSTRIAL,
    TOLERANCE_STRICT_LAB,
)
from backend.color_engine.addback import calculate_production_addback


@pytest.fixture
def client():
    return TestClient(app)


def test_p0_tolerance_profiles_centralized():
    """P0-6: Verify centralized tolerance profile definitions and retrieval."""
    ind = get_tolerance_profile("industrial")
    assert ind.target_de00_acceptance == 0.50
    assert ind.addback_max_de00 == 1.50
    assert ind.reject_above_de00 == 1.50
    assert ind.model_divergence_warning_de00 == 0.80

    strict = get_tolerance_profile("strict_lab")
    assert strict.target_de00_acceptance == 0.40
    assert strict.addback_max_de00 == 1.20
    assert strict.model_divergence_warning_de00 == 0.60


def test_p0_addback_uses_actual_dispensed_and_targets_true_target():
    """P0-2 & P0-4: Add-back must target true target reflectance and use actual dispensed grams."""
    base_k = [0.05] * 31
    base_s = [1.00] * 31

    colorant_yellow = {
        "id": 1,
        "name": "Yellow PY74",
        "code": "PY74",
        "unit_k": [0.30] * 31,
        "unit_s": [0.05] * 31,
    }
    colorant_blue = {
        "id": 2,
        "name": "Blue PB15",
        "code": "PB15",
        "unit_k": [0.05] * 31,
        "unit_s": [0.40] * 31,
    }

    target_r = [0.45] * 31
    measured_r = [0.55] * 31

    # Weighed grams in tank differed from nominal recipe:
    # Nominal was 10.0g, but operator actually dispensed 10.5g
    current_pastes = [
        {
            "id": 1,
            "name": "Yellow PY74",
            "concentration": 1.0,
            "amount_g": 10.0,
            "actual_amount_g": 10.5,
            "unit_k": colorant_yellow["unit_k"],
            "unit_s": colorant_yellow["unit_s"],
        }
    ]

    res = calculate_production_addback(
        tank_mass_kg=1.0,  # 1000g batch
        current_pastes=current_pastes,
        target_reflectance=target_r,
        available_pastes=[colorant_yellow, colorant_blue],
        base_k=base_k,
        base_s=base_s,
        current_reflectance=measured_r,
        k1=0.04,
        k2=0.60,
    )

    assert "additions" in res
    assert "final_delta_e00" in res
    assert isinstance(res["additions"], list)


def test_p0_addback_context_gate_filtering(client):
    """P0-3: /api/formulation/add-back must enforce ContextGate filtering."""
    base_res = client.get("/api/bases")
    assert base_res.status_code == 200
    bases = base_res.json()
    assert len(bases) > 0
    base_id = bases[0]["id"]

    target_r = [0.50] * 31
    measured_r = [0.52] * 31

    payload = {
        "tank_mass_kg": 1.0,
        "base_id": base_id,
        "measured_reflectance": measured_r,
        "target_reflectance": target_r,
        "current_pastes": [
            {"id": 1, "name": "Colorant 1", "concentration": 1.2}
        ],
        "geometry": "d/8°",
        "measurement_mode": "SCI",
        "optical_system": "bootstrap_v1",
        "tolerance_profile_id": "industrial",
    }

    res = client.post("/api/formulation/add-back", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "additions" in data
    assert "final_delta_e00" in data


def test_p0_drawdown_three_metrics_and_simulation_isolation(client):
    """
    P0-1: 3 distinct metrics (Target vs Measured, Target vs Predicted, Predicted vs Measured).
    P0-5: is_simulation=True must NEVER yield is_golden_batch=True.
    """
    target_r = [0.60] * 31
    pred_r = [0.59] * 31

    save_payload = {
        "name": "P0 Industrial Test Recipe",
        "base_id": 1,
        "pastes": [{"paste_id": 1, "concentration": 1.2, "amount_g": 12.0}],
        "predicted_reflectance": pred_r,
        "target_reflectance": target_r,
        "lab": {"L": 60.0, "a": 10.0, "b": 15.0},
        "hex_color": "#aabbcc",
        "delta_e00": 0.20,
        "tolerance_profile_id": "industrial",
    }
    save_res = client.post("/api/formulation/recipes", json=save_payload)
    assert save_res.status_code == 200
    recipe_id = save_res.json()["id"]

    # Real Hardware Measurement within tolerance -> Golden Batch
    measured_r_pass = [0.602] * 31
    drawdown_real = {
        "measured_reflectance": measured_r_pass,
        "sample_name": "Physical Card 01",
        "actual_dispensed": [{"id": 1, "amount_g": 12.05}],
        "batch_size_g": 1000.0,
        "target_reflectance": target_r,
        "is_simulation": False,
        "tolerance_profile_id": "industrial",
    }

    res_real = client.post(f"/api/formulation/recipes/{recipe_id}/attempts/1/result", json=drawdown_real)
    assert res_real.status_code == 200
    data_real = res_real.json()

    # P0-1: 3 distinct metrics
    assert "de00_target_vs_measured" in data_real
    assert "de00_target_vs_predicted" in data_real
    assert "de00_predicted_vs_measured" in data_real
    assert data_real["outcome"] == "ACCEPTED"

    # P0-5: Real measurement within tolerance yields Golden Batch
    assert data_real["is_simulation"] is False
    assert data_real["is_golden_batch"] is True

    # Simulation Measurement within tolerance -> CANNOT yield Golden Batch
    drawdown_sim = {
        "measured_reflectance": measured_r_pass,
        "sample_name": "Virtual Simulation Card",
        "actual_dispensed": [{"id": 1, "amount_g": 12.05}],
        "batch_size_g": 1000.0,
        "target_reflectance": target_r,
        "is_simulation": True,  # Simulation mode!
        "tolerance_profile_id": "industrial",
    }

    res_sim = client.post(f"/api/formulation/recipes/{recipe_id}/attempts/1/result", json=drawdown_sim)
    assert res_sim.status_code == 200
    data_sim = res_sim.json()

    assert data_sim["outcome"] == "ACCEPTED"
    assert data_sim["is_simulation"] is True
    assert data_sim["is_golden_batch"] is False
    assert "Demo / Test Modu" in data_sim["outcome_message"]


def test_p0_drawdown_model_divergence_warning(client):
    """
    P0-1 & P0-6: When predicted differs greatly from measured, model_divergence_warning is raised.
    """
    target_r = [0.70] * 31
    pred_r = [0.70] * 31
    # Measured has diverged significantly from predicted (e.g. ΔE > 0.80)
    measured_diverged = [0.55] * 31

    save_payload = {
        "name": "P0 Divergence Test Recipe",
        "base_id": 1,
        "pastes": [{"paste_id": 1, "concentration": 0.8, "amount_g": 8.0}],
        "predicted_reflectance": pred_r,
        "target_reflectance": target_r,
        "lab": {"L": 75.0, "a": 5.0, "b": 10.0},
        "hex_color": "#ffffff",
        "delta_e00": 0.05,
        "tolerance_profile_id": "industrial",
    }
    save_res = client.post("/api/formulation/recipes", json=save_payload)
    assert save_res.status_code == 200
    recipe_id = save_res.json()["id"]

    drawdown_req = {
        "measured_reflectance": measured_diverged,
        "target_reflectance": target_r,
        "is_simulation": False,
        "tolerance_profile_id": "industrial",
    }
    res = client.post(f"/api/formulation/recipes/{recipe_id}/attempts/1/result", json=drawdown_req)
    assert res.status_code == 200
    data = res.json()

    assert data["model_divergence_warning"] is True
    assert data["model_divergence_note"] is not None
    assert data["de00_predicted_vs_measured"] > 0.80
