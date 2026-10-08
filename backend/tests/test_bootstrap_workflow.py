"""
Bootstrap Optical Framework End-to-End Tests
=============================================
Tests for the 3-Stage Industrial Calibration:
Stage 1: Core Triplet (Clear Base + Bootstrap Black + Bootstrap White)
Stage 2: Colorant Pastes characterized against the Bootstrap reference
Stage 3: Production Bases characterized using Bootstrap Black dilutions
"""

import pytest
import numpy as np
from fastapi.testclient import TestClient
from backend.main import app
from backend.database.db import get_db_connection, init_db
from backend.color_engine.kubelka_munk import characterize_production_base

client = TestClient(app)


@pytest.fixture(autouse=True)
def ensure_db():
    init_db()


def test_bootstrap_status_endpoint():
    """Verify GET /api/characterization/bootstrap-status reports all 3 stages accurately."""
    resp = client.get("/api/characterization/bootstrap-status")
    assert resp.status_code == 200
    data = resp.json()

    assert data["optical_system"] == "bootstrap_v1"
    assert "stages" in data

    s1 = data["stages"]["stage1"]
    assert s1["status"] in ("COMPLETED", "PENDING")
    if s1["status"] == "COMPLETED":
        assert s1["clear_base"] is not None
        assert s1["black_paste"] is not None
        assert s1["white_paste"] is not None

    s2 = data["stages"]["stage2"]
    assert "pastes" in s2
    assert isinstance(s2["count"], int)

    s3 = data["stages"]["stage3"]
    assert "bases" in s3
    assert isinstance(s3["count"], int)
    # The clear bootstrap base must NOT be in stage3 production bases
    if s1["clear_base"]:
        clear_id = s1["clear_base"]["id"]
        assert all(b["id"] != clear_id for b in s3["bases"])


def test_characterize_production_base_algorithm():
    """Verify analytical & least-squares solution of base S and K from black dilutions."""
    # Synthetic ground-truth base: S = 1.0, K = 0.05 across 31 wavelengths
    true_s = np.ones(31, dtype=float)
    true_k = np.full(31, 0.05, dtype=float)
    theta_true = true_k / true_s
    # Untinted reflectance:
    from backend.color_engine.kubelka_munk import ks_to_reflectance
    r_base_int = ks_to_reflectance(theta_true)
    k1, k2 = 0.04, 0.60
    r_base_meas = k1 + (1.0 - k1) * (1.0 - k2) * r_base_int / (1.0 - k2 * r_base_int)

    # Black paste: high K, low S
    black_k = np.full(31, 4.5, dtype=float)
    black_s = np.full(31, 0.05, dtype=float)

    # Create 3 dilutions of black in this base: 0.5%, 1.5%, 3.0%
    black_letdowns = []
    for c in [0.5, 1.5, 3.0]:
        k_mix = true_k + c * black_k
        s_mix = true_s + c * black_s
        th_mix = k_mix / s_mix
        r_int = ks_to_reflectance(th_mix)
        r_meas = k1 + (1.0 - k1) * (1.0 - k2) * r_int / (1.0 - k2 * r_int)
        black_letdowns.append({
            "concentration": c,
            "reflectance": r_meas.tolist()
        })

    res = characterize_production_base(
        un_tinted_reflectance=r_base_meas.tolist(),
        black_letdowns=black_letdowns,
        bootstrap_black_k=black_k.tolist(),
        bootstrap_black_s=black_s.tolist(),
        k1=k1,
        k2=k2
    )

    assert res["passed_validation"] is True
    assert res["mean_delta_e00"] < 0.20
    # S_base should be very close to 1.0 (true_s)
    est_s = np.array(res["scattering_s"])
    est_k = np.array(res["absorption_k"])
    np.testing.assert_allclose(est_s, 1.0, atol=0.15)
    np.testing.assert_allclose(est_k, 0.05, atol=0.03)


def test_characterize_base_from_bootstrap_api():
    """Verify POST /api/characterization/base-from-bootstrap saves valid base to DB."""
    # Ensure bootstrap black exists
    conn = get_db_connection()
    black_row = conn.execute("SELECT id, unit_k, unit_s FROM pastes WHERE bootstrap_role = 'black' LIMIT 1").fetchone()
    conn.close()
    assert black_row is not None
    black_id = black_row["id"]

    import time
    base_code = f"TEST-BASE-{time.time_ns()}"

    # Base A like un-tinted white
    un_tinted_r = [0.85] * 31
    black_letdowns = [
        {"concentration": 0.5, "reflectance": [0.45] * 31},
        {"concentration": 1.5, "reflectance": [0.25] * 31},
        {"concentration": 3.0, "reflectance": [0.15] * 31},
    ]

    payload = {
        "name": f"Fabrika Test Beyaz Baz {base_code}",
        "code": base_code,
        "base_type": "white_a",
        "density": 1.48,
        "un_tinted_reflectance": un_tinted_r,
        "black_letdowns": black_letdowns,
        "bootstrap_black_paste_id": black_id,
        "k1": 0.04,
        "k2": 0.60,
        "thickness": 100.0,
        "geometry": "45°/0°",
        "measurement_mode": "SCI",
        "optical_system": "bootstrap_v1"
    }

    resp = client.post("/api/characterization/base-from-bootstrap", json=payload)
    assert resp.status_code == 200
    res_data = resp.json()

    assert res_data["success"] is True
    new_base_id = res_data["base_id"]
    assert new_base_id > 0
    assert res_data["contrast_ratio"] > 80.0
    assert len(res_data["absorption_k"]) == 31
    assert len(res_data["scattering_s"]) == 31

    # Verify base in DB
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM bases WHERE id = ?", (new_base_id,)).fetchone()
    conn.close()
    assert row["code"] == base_code
    assert row["optical_system"] == "bootstrap_v1"
    assert row["is_bootstrap_base"] == 0

    # Cleanup test base
    conn = get_db_connection()
    conn.execute("DELETE FROM bases WHERE id = ?", (new_base_id,))
    conn.commit()
    conn.close()


def test_setup_bootstrap_system_api():
    """Verify POST /api/characterization/bootstrap-system locks core triplet."""
    conn = get_db_connection()
    bases = conn.execute("SELECT id FROM bases ORDER BY id ASC").fetchall()
    pastes = conn.execute("SELECT id FROM pastes ORDER BY id ASC").fetchall()
    conn.close()

    assert len(bases) >= 1
    assert len(pastes) >= 2

    clear_base_id = bases[0]["id"]
    black_id = pastes[0]["id"]
    white_id = pastes[1]["id"]

    resp = client.post("/api/characterization/bootstrap-system", json={
        "clear_base_id": clear_base_id,
        "black_paste_id": black_id,
        "white_paste_id": white_id,
        "optical_system": "bootstrap_v1"
    })
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # Check status endpoint reflects this
    stat_resp = client.get("/api/characterization/bootstrap-status")
    assert stat_resp.status_code == 200
    stat = stat_resp.json()
    assert stat["stages"]["stage1"]["clear_base"]["id"] == clear_base_id
    assert stat["stages"]["stage1"]["black_paste"]["id"] == black_id
    assert stat["stages"]["stage1"]["white_paste"]["id"] == white_id
