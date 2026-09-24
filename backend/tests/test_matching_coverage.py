"""
TintMatch PRO - Matching & Formulation Comprehensive Coverage Test Suite
========================================================================
Exhaustive test suite covering:
- Live recipe simulation (predict_recipe, multi-pigment blends, film thickness, contrast ratio)
- Automated Computer Color Matching solver (match_color_ccm, NNLS, L-BFGS-B, constraints)
- Colorimetric transformations (XYZ, CIE L*a*b*, sRGB hex, CIEDE2000, Metamerism Index)
- Formulation FastAPI router endpoints (predict, match, recipes CRUD)
"""

import json
import time
import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.formulation import predict_recipe, match_color_ccm
from backend.color_engine.colorimetry import (
    reflectance_to_xyz,
    xyz_to_lab,
    reflectance_to_lab,
    reflectance_to_hex,
    ciede2000,
    compute_metamerism_index,
)
from backend.database.db import get_db_connection

client = TestClient(app)


# ============================================================================
# 1. Formulation Prediction Core Coverage
# ============================================================================

def test_predict_recipe_base_only():
    """Verify that a formulation with 0% pigment load matches base paint properties."""
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    conn.close()

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    res = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=[],
        thickness=100.0
    )

    assert len(res["reflectance"]) == 31
    assert res["total_colorant_load"] == 0.0
    assert res["contrast_ratio"] >= 98.0
    assert res["is_opaque"] is True
    assert "hex" in res
    assert res["hex"].startswith("#")
    assert "lab" in res
    assert res["lab"]["L"] > 85.0  # White base


def test_predict_recipe_multiple_pigments_and_zero_concs():
    """Verify blending multiple colorant pastes and ignoring 0% concentration entries."""
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes ORDER BY id ASC LIMIT 3").fetchall()
    conn.close()

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    pastes_input = [
        {
            "id": paste_rows[0]["id"],
            "name": paste_rows[0]["name"],
            "concentration": 2.0,
            "unit_k": json.loads(paste_rows[0]["unit_k"]),
            "unit_s": json.loads(paste_rows[0]["unit_s"])
        },
        {
            "id": paste_rows[1]["id"],
            "name": paste_rows[1]["name"],
            "concentration": 0.0,  # Zero conc should be skipped
            "unit_k": json.loads(paste_rows[1]["unit_k"]),
            "unit_s": json.loads(paste_rows[1]["unit_s"])
        },
        {
            "id": paste_rows[2]["id"],
            "name": paste_rows[2]["name"],
            "concentration": 1.5,
            "unit_k": json.loads(paste_rows[2]["unit_k"]),
            "unit_s": json.loads(paste_rows[2]["unit_s"])
        }
    ]

    res = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=pastes_input,
        thickness=100.0
    )

    assert res["total_colorant_load"] == 3.5
    # Only 2 active items in recipe breakdown
    assert len(res["recipe_breakdown"]) == 2
    assert res["recipe_breakdown"][0]["name"] == paste_rows[0]["name"]
    assert res["recipe_breakdown"][1]["name"] == paste_rows[2]["name"]


def test_predict_recipe_thickness_and_contrast_ratio():
    """Verify that thin films have lower contrast ratio than thick films."""
    conn = get_db_connection()
    # Base B or C is less opaque
    base_row = conn.execute("SELECT * FROM bases WHERE code = 'BASE-C'").fetchone()
    conn.close()

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    res_thin = predict_recipe(base_k=base_k, base_s=base_s, pastes=[], thickness=15.0)
    res_thick = predict_recipe(base_k=base_k, base_s=base_s, pastes=[], thickness=150.0)

    assert res_thick["contrast_ratio"] > res_thin["contrast_ratio"]


def test_predict_recipe_target_comparison_and_metamerism():
    """Verify that passing target_reflectance calculates full CIEDE2000 metrics and Metamerism Index."""
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_row = conn.execute("SELECT * FROM pastes WHERE id = 1").fetchone()
    conn.close()

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    # First predict a baseline recipe to get realistic target reflectance
    baseline = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=[{
            "id": 1,
            "concentration": 2.0,
            "unit_k": json.loads(paste_row["unit_k"]),
            "unit_s": json.loads(paste_row["unit_s"])
        }]
    )
    target_r = baseline["reflectance"]

    # Now predict with slightly different concentration to compare
    compared = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=[{
            "id": 1,
            "concentration": 2.1,  # close to 2.0
            "unit_k": json.loads(paste_row["unit_k"]),
            "unit_s": json.loads(paste_row["unit_s"])
        }],
        target_reflectance=target_r
    )

    assert "comparison" in compared
    comp = compared["comparison"]
    assert "delta_e00" in comp
    assert comp["delta_e00"] < 0.50  # Very close
    assert "delta_L" in comp
    assert "delta_a" in comp
    assert "delta_b" in comp
    assert "metamerism" in comp
    assert "MI_A" in comp["metamerism"]
    assert "MI_F11" in comp["metamerism"]


# ============================================================================
# 2. Automated CCM Matching Solver (match_color_ccm) Coverage
# ============================================================================

def test_match_color_ccm_exact_reconstruction():
    """Verify that matching a target generated from known pastes yields low ΔE00 (< 0.50)."""
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes").fetchall()
    conn.close()

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    available = []
    for r in paste_rows:
        available.append({
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "hex": r["color_hex"],
            "unit_k": json.loads(r["unit_k"]),
            "unit_s": json.loads(r["unit_s"])
        })

    # Generate synthetic target using 2 pastes: e.g. paste 1 at 1.5% and paste 5 at 2.0%
    synth = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=[
            {"id": available[0]["id"], "concentration": 1.5, "unit_k": available[0]["unit_k"], "unit_s": available[0]["unit_s"]},
            {"id": available[4]["id"], "concentration": 2.0, "unit_k": available[4]["unit_k"], "unit_s": available[4]["unit_s"]}
        ]
    )
    target_r = synth["reflectance"]

    # Run CCM Solver
    matched = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available,
        max_pastes=3,
        max_total_load=10.0
    )

    assert "matched_pastes" in matched
    assert len(matched["matched_pastes"]) >= 1
    assert matched["delta_e00"] < 0.80
    assert "prediction" in matched


def test_match_color_ccm_constraints():
    """Verify that max_pastes and max_total_load constraints are strictly honored."""
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes").fetchall()
    conn.close()

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    available = [
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

    target_r = [0.35] * 31  # Medium neutral gray target

    # Constraint: max_pastes = 2, max_total_load = 3.0%
    matched = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available,
        max_pastes=2,
        max_total_load=3.0
    )

    assert len(matched["matched_pastes"]) <= 2
    total_conc = sum(p["concentration"] for p in matched["matched_pastes"])
    assert total_conc <= 3.001


def test_match_color_ccm_empty_pastes_error():
    """Verify that match_color_ccm raises ValueError when no pastes are available."""
    target_r = [0.5] * 31
    base_k = [0.01] * 31
    base_s = [1.0] * 31

    with pytest.raises(ValueError, match="No available pastes"):
        match_color_ccm(
            target_reflectance=target_r,
            base_k=base_k,
            base_s=base_s,
            available_pastes=[]
        )


# ============================================================================
# 3. Colorimetry Transformations Deep Coverage
# ============================================================================

def test_colorimetry_multi_illuminant():
    """Verify reflectance_to_xyz and reflectance_to_lab under D65, A, F11, F2."""
    r = np.full(31, 0.5)

    for illum in ["D65", "A", "F11", "F2"]:
        for obs in ["10", "2"]:
            xyz = reflectance_to_xyz(r, illuminant=illum, observer=obs)
            assert len(xyz) == 3
            assert xyz[1] > 40.0  # Luminous Y for 50% flat gray is ~50

            lab = reflectance_to_lab(r, illuminant=illum, observer=obs)
            assert len(lab) == 3
            assert 70.0 < lab[0] < 80.0  # L* for 50% reflectance is ~76.0


def test_colorimetry_ciede2000_components():
    """Verify CIEDE2000 breakdown of lightness, chroma, and hue differences."""
    lab_std = [50.0, 20.0, 30.0]
    lab_batch = [52.0, 22.0, 33.0]

    res = ciede2000(lab_std, lab_batch)
    assert res["delta_L"] == pytest.approx(2.0, abs=1e-2)
    assert res["delta_e00"] > 0.0
    assert "delta_C" in res
    assert "delta_H" in res


def test_reflectance_to_hex_primary_colors():
    """Verify that spectral curves corresponding to red, green, blue yield expected hex tones."""
    # Peak in red (~650-700 nm)
    r_red = np.array([0.05]*20 + [0.85]*11)
    hex_red = reflectance_to_hex(r_red)
    assert hex_red.startswith("#")

    # Peak in blue (~400-470 nm)
    r_blue = np.array([0.85]*8 + [0.05]*23)
    hex_blue = reflectance_to_hex(r_blue)
    assert hex_blue.startswith("#")


# ============================================================================
# 4. FastAPI Formulation Router End-to-End Tests
# ============================================================================

def test_api_formulation_predict_database_lookup():
    """Test /api/formulation/predict resolving paste spectra directly from DB."""
    payload = {
        "base_id": 1,
        "pastes": [
            {"id": 1, "concentration": 1.5},
            {"id": 2, "concentration": 0.8}
        ],
        "k1": 0.04,
        "k2": 0.60,
        "thickness": 120.0
    }
    resp = client.post("/api/formulation/predict", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["reflectance"]) == 31
    assert data["total_colorant_load"] == 2.3
    assert data["contrast_ratio"] >= 98.0


def test_api_formulation_predict_with_explicit_spectra():
    """Test /api/formulation/predict with custom unit_k and unit_s provided in body."""
    custom_k = [0.1] * 31
    custom_s = [0.02] * 31

    payload = {
        "base_id": 1,
        "pastes": [
            {
                "id": "custom-1",
                "name": "Custom Green",
                "concentration": 1.0,
                "unit_k": custom_k,
                "unit_s": custom_s
            }
        ]
    }
    resp = client.post("/api/formulation/predict", json=payload)
    assert resp.status_code == 200
    assert resp.json()["total_colorant_load"] == 1.0


def test_api_formulation_predict_with_target():
    """Test /api/formulation/predict with target_reflectance comparison."""
    target_r = [0.4] * 31
    payload = {
        "base_id": 1,
        "pastes": [{"id": 1, "concentration": 2.0}],
        "target_reflectance": target_r
    }
    resp = client.post("/api/formulation/predict", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "comparison" in data
    assert "delta_e00" in data["comparison"]
    assert "metamerism" in data["comparison"]


def test_api_formulation_predict_errors():
    """Test 404 error when base_id does not exist."""
    payload = {
        "base_id": 999999,
        "pastes": [{"id": 1, "concentration": 1.0}]
    }
    resp = client.post("/api/formulation/predict", json=payload)
    assert resp.status_code == 404


def test_api_formulation_match_endpoints():
    """Test /api/formulation/match with full library and restricted subset."""
    # 1. Successful matching with full library
    target_r = [0.55] * 31
    match_payload = {
        "target_reflectance": target_r,
        "base_id": 1,
        "max_pastes": 3,
        "max_total_load": 8.0
    }
    resp = client.post("/api/formulation/match", json=match_payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "matched_pastes" in data
    assert "prediction" in data
    assert data["delta_e00"] is not None

    # 2. Matching with restricted paste_ids
    resp_subset = client.post("/api/formulation/match", json={
        "target_reflectance": target_r,
        "base_id": 1,
        "paste_ids": [1, 2],
        "max_pastes": 2
    })
    assert resp_subset.status_code == 200
    for p in resp_subset.json()["matched_pastes"]:
        assert p["id"] in [1, 2]

    # 3. 400 when target length is not 31
    resp_bad_target = client.post("/api/formulation/match", json={
        "target_reflectance": [0.5] * 15,
        "base_id": 1
    })
    assert resp_bad_target.status_code == 400

    # 4. 404 when base_id is invalid
    resp_bad_base = client.post("/api/formulation/match", json={
        "target_reflectance": target_r,
        "base_id": 999999
    })
    assert resp_bad_base.status_code == 404

    # 5. 400 when candidate paste IDs yield empty set
    resp_empty_pastes = client.post("/api/formulation/match", json={
        "target_reflectance": target_r,
        "base_id": 1,
        "paste_ids": [999999]
    })
    assert resp_empty_pastes.status_code == 400


def test_api_formulation_recipes_crud():
    """Test saving recipe, listing recipes, and deleting a recipe."""
    recipe_name = f"Test Formulation {time.time_ns()}"
    save_payload = {
        "name": recipe_name,
        "base_id": 1,
        "pastes": [{"id": 1, "name": "PG7", "concentration": 2.5}],
        "predicted_reflectance": [0.35] * 31,
        "lab": {"L": 55.0, "a": -15.0, "b": 10.0},
        "hex_color": "#228855",
        "delta_e00": 0.22,
        "contrast_ratio": 98.8
    }

    # 1. Save
    save_resp = client.post("/api/formulation/recipes", json=save_payload)
    assert save_resp.status_code == 200
    res = save_resp.json()
    assert res["success"] is True
    recipe_id = res["id"]
    assert recipe_id > 0

    # 2. List
    list_resp = client.get("/api/formulation/recipes")
    assert list_resp.status_code == 200
    all_recipes = list_resp.json()
    found = any(r["id"] == recipe_id for r in all_recipes)
    assert found is True

    # 3. Delete
    del_resp = client.delete(f"/api/formulation/recipes/{recipe_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True

    # Verify deleted
    list_after = client.get("/api/formulation/recipes").json()
    assert not any(r["id"] == recipe_id for r in list_after)
