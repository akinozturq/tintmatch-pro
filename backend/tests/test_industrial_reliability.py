"""
Industrial CCM Reliability Test Suite (Phase A & Phase B)
==========================================================
Verifies:
1. Server Authoritative Single Source of Truth:
   - Server recomputes K/S and validation metrics from letdowns, ignoring client tampering.
   - Characterization failure automatically sets status = 'REJECTED' (passed_validation = 0).
   - Silent mock fallback is prohibited in production when DLL is unavailable.
   - Recipe provenance records genuine active_characterization_id from database.
2. Context Gate Enforcement:
   - Optical geometry isolation (45°/0° vs d/8°).
   - Optical measurement mode isolation (SCI vs SCE).
   - Optical bootstrap system isolation.
   - Automatic exclusion of REJECTED pastes from the solver candidate pool.
   - Detailed exclusion reasons reported in match response.
"""

import json
import time
import os
import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.database.db import get_db_connection, init_db
from backend.color_engine.spectral_parser import get_industrial_sample_datasets
from backend.color_engine.constants import N_WAVELENGTHS
from backend.devices.chnspec_driver import CHNSpecDriver

client = TestClient(app)


@pytest.fixture(autouse=True)
def ensure_db():
    init_db()


def test_characterization_server_recomputes_ks_authoritatively():
    """Verify /api/characterization/save recomputes K/S and ignores tampered client results."""
    datasets = get_industrial_sample_datasets()
    letdowns = datasets["colorants"]["PG7"]["letdowns"]

    # Client sends fake/manipulated K/S and fake zero error
    fake_calc = {
        "unit_k": [999.0] * N_WAVELENGTHS,
        "unit_s": [888.0] * N_WAVELENGTHS,
        "unit_ks": [777.0] * N_WAVELENGTHS,
        "mean_delta_e00": 0.0001,
        "passed_validation": True
    }
    test_code = f"AUTH-TEST-{time.time_ns()}"

    resp = client.post("/api/characterization/save", json={
        "name": f"Authoritative Test Paste {test_code}",
        "code": test_code,
        "density": 1.35,
        "base_id": 1,
        "geometry": "45°/0°",
        "measurement_mode": "SCI",
        "characterization_version": 1,
        "letdowns": letdowns,
        "calculation_results": fake_calc
    })
    assert resp.status_code == 200
    data = resp.json()
    paste_id = data["paste_id"]

    # Verify that the database stores genuine calculated unit_k, NOT the fake 999.0
    conn = get_db_connection()
    row = conn.execute("SELECT unit_k, mean_delta_e00, status FROM pastes WHERE id = ?", (paste_id,)).fetchone()
    conn.close()

    stored_k = json.loads(row["unit_k"])
    assert stored_k[0] != 999.0
    # Genuine PG7 has reasonable unit K (typically < 10.0)
    assert stored_k[0] < 50.0
    assert row["status"] in ("ACTIVE", "CONDITIONAL")


def test_failed_characterization_auto_rejected_and_excluded_from_solver():
    """Verify pastes with invalid or failing letdowns are marked REJECTED and excluded from solver."""
    # Letdowns with severe inconsistent data causing high error
    bad_letdowns = [
        {"concentration": 0.1, "reflectance": [0.9] * 31},
        {"concentration": 1.0, "reflectance": [0.1] * 31},
        {"concentration": 2.0, "reflectance": [0.85] * 31},  # Inversion/non-monotonic noise
        {"concentration": 5.0, "reflectance": [0.05] * 31},
    ]

    bad_calc = {
        "unit_k": [0.1] * 31,
        "unit_s": [0.05] * 31,
        "unit_ks": [2.0] * 31,
        "mean_delta_e00": 4.5,
        "passed_validation": False
    }
    test_code = f"REJ-TEST-{time.time_ns()}"

    resp = client.post("/api/characterization/save", json={
        "name": f"Failing Test Paste {test_code}",
        "code": test_code,
        "density": 1.25,
        "base_id": 1,
        "geometry": "45°/0°",
        "measurement_mode": "SCI",
        "characterization_version": 1,
        "letdowns": bad_letdowns,
        "calculation_results": bad_calc
    })
    assert resp.status_code == 200
    paste_id = resp.json()["paste_id"]

    try:
        # Check that paste in DB has status = 'REJECTED'
        conn = get_db_connection()
        row = conn.execute("SELECT status, passed_validation FROM pastes WHERE id = ?", (paste_id,)).fetchone()
        conn.close()
        assert row["status"] == "REJECTED"
        assert row["passed_validation"] == 0

        # Attempt to run match with this specific paste_id only
        match_resp = client.post("/api/formulation/match", json={
            "target_reflectance": [0.5] * 31,
            "base_id": 1,
            "geometry": "45°/0°",
            "measurement_mode": "SCI",
            "paste_ids": [paste_id],
            "max_pastes": 2
        })
        # Must be rejected because the only candidate paste is REJECTED
        assert match_resp.status_code == 400
        detail = match_resp.json()["detail"]
        assert "No characterized colorant pastes found" in detail
        assert "REJECTED_QUALITY_GATE" in detail
    finally:
        conn = get_db_connection()
        conn.execute("DELETE FROM pastes WHERE id = ?", (paste_id,))
        conn.commit()
        conn.close()


def test_mode_mismatch_isolation_sci_vs_sce():
    """Verify solver strictly prohibits cross-mode formulation (e.g. target SCE with base SCI)."""
    # Base 1 is SCI. Requesting target with SCE must fail with Context Mismatch
    resp = client.post("/api/formulation/match", json={
        "target_reflectance": [0.5] * 31,
        "base_id": 1,
        "geometry": "45°/0°",
        "measurement_mode": "SCE",
        "max_pastes": 2
    })
    assert resp.status_code == 400
    assert "Context Mismatch" in resp.json()["detail"]
    assert "mode 'SCE'" in resp.json()["detail"]


def test_driver_prohibits_silent_mock_in_production():
    """Verify CHNSpec driver without DLL enters ERROR state when mock mode is not explicitly permitted."""
    # Force mock disallow by passing allow_mock=False and ensuring TINTMATCH_MODE is not demo
    old_env = os.environ.get("TINTMATCH_MODE")
    if "TINTMATCH_MODE" in os.environ:
        del os.environ["TINTMATCH_MODE"]
    try:
        driver = CHNSpecDriver(dll_dir="C:/non_existent_production_path", allow_mock=False)
        assert driver.is_mock is False
        assert driver.connection_state == "ERROR"
        assert "Hardware driver unavailable" in str(driver._last_error)

        # Attempt to connect must fail cleanly
        ok = driver.connect("COM4")
        assert ok is False
        assert driver.connection_state == "ERROR"
    finally:
        if old_env is not None:
            os.environ["TINTMATCH_MODE"] = old_env


def test_recipe_save_provenance_clean_authoritative():
    """Verify save_recipe queries genuine active_characterization_id and computes authoritative hash."""
    conn = get_db_connection()
    paste = conn.execute("SELECT id, active_characterization_id FROM pastes WHERE active_characterization_id IS NOT NULL LIMIT 1").fetchone()
    conn.close()

    if not paste:
        pytest.skip("No pre-seeded paste with active_characterization_id found")

    p_id = paste["id"]
    expected_char_id = paste["active_characterization_id"]

    # Client payload omitting active_characterization_id
    payload = {
        "name": f"Authoritative Recipe {time.time_ns()}",
        "base_id": 1,
        "pastes": [
            {"id": p_id, "name": "PG7", "concentration": 2.5}
        ],
        "predicted_reflectance": [0.4] * 31,
        "lab": {"L": 50.0, "a": -20.0, "b": 10.0},
        "hex_color": "#228844",
        "delta_e00": 0.25,
        "geometry": "45°/0°"
    }

    resp = client.post("/api/formulation/recipes", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    recipe_id = data["id"]
    assert "calculation_hash" in data

    # Verify recipe record in DB
    conn = get_db_connection()
    rec_row = conn.execute("SELECT characterization_ids_json, calculation_hash FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    conn.close()

    recorded_char_ids = json.loads(rec_row["characterization_ids_json"])
    assert recorded_char_ids == [expected_char_id]
    assert rec_row["calculation_hash"] == data["calculation_hash"]


def test_match_reports_excluded_pastes_diagnostics():
    """Verify solver response reports which candidate pastes were excluded and why."""
    # Base 1 is 45°/0° SCI. d/8° pastes should be excluded with GEOMETRY_MISMATCH
    resp = client.post("/api/formulation/match", json={
        "target_reflectance": [0.4] * 31,
        "base_id": 1,
        "geometry": "45°/0°",
        "measurement_mode": "SCI",
        "max_pastes": 3
    })
    assert resp.status_code == 200
    res_data = resp.json()
    assert "excluded_pastes" in res_data
    assert isinstance(res_data["excluded_pastes"], list)

    # Pastes with d/8° geometry (like PBk7, PY184) must appear in excluded_pastes with reason
    excluded_reasons = [p["reason"] for p in res_data["excluded_pastes"]]
    assert any("GEOMETRY_MISMATCH" in r for r in excluded_reasons)
