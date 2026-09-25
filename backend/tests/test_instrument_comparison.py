"""
Tests for Instrument Comparison and Multi-Geometry Analysis Engine
===================================================================
Verifies:
1. compare_spectral_measurements function on identical and disparate spectra
2. Diagnostics when comparing 45°/0° vs d/8° (SCI/SCE)
3. FastApi POST /api/instruments/compare endpoint
4. Database schema columns on measurements table (geometry, measurement_mode, specular_included)
"""

import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.color_engine.instrument_comparison import compare_spectral_measurements
from backend.color_engine.constants import WAVELENGTHS
from backend.database.db import get_db_connection, init_db

client = TestClient(app)


def test_compare_identical_spectra():
    """Verify comparing identical spectra yields zero delta_E and unit correlation."""
    spectrum = [0.1 + 0.02 * np.sin((w - 400) / 50.0) for w in WAVELENGTHS]
    res = compare_spectral_measurements(
        ref_spectrum=spectrum,
        target_spectrum=spectrum,
        ref_meta={"instrument": "Test RM400", "geometry": "45°/0°"},
        target_meta={"instrument": "Test RM400 #2", "geometry": "45°/0°"}
    )
    assert res["success"] is True
    assert res["colorimetric_difference"]["delta_e00"] < 1e-3
    assert res["statistics"]["spectral_rmse"] < 1e-4
    assert res["statistics"]["r_squared"] > 0.999
    assert res["diagnostics"]["same_geometry"] is True
    assert "EXCELLENT" in res["diagnostics"]["agreement_classification"]


def test_compare_cross_geometry_gloss_trap():
    """Verify comparing 45°/0° vs d/8° SCI detects specular component bias."""
    # Body diffuse reflectance
    body_r = [0.08 + 0.50 / (1.0 + np.exp(-(w - 530) / 40.0)) for w in WAVELENGTHS]
    # SCI includes ~4% specular gloss reflection
    sci_r = [r + 0.04 for r in body_r]

    res = compare_spectral_measurements(
        ref_spectrum=body_r,
        target_spectrum=sci_r,
        ref_meta={"instrument": "X-Rite RM400", "geometry": "45°/0°", "mode": "SPEX"},
        target_meta={"instrument": "CHNSpec DS-36D", "geometry": "d/8°", "mode": "SCI"}
    )
    assert res["success"] is True
    assert res["diagnostics"]["same_geometry"] is False
    # Target (SCI) should have positive bias due to specular gloss
    assert res["statistics"]["mean_spectral_bias"] > 0.03
    assert any("SCI" in note or "ayna" in note for note in res["diagnostics"]["notes"])
    assert res["colorimetric_difference"]["delta_L"] > 0


def test_api_instruments_compare_endpoint():
    """Verify FastApi /api/instruments/compare endpoint."""
    body_r = [0.10] * 31
    target_r = [0.12] * 31

    resp = client.post("/api/instruments/compare", json={
        "ref_reflectance": body_r,
        "target_reflectance": target_r,
        "ref_geometry": "45°/0°",
        "target_geometry": "d/8°",
        "ref_name": "RM400 Reference",
        "target_name": "DS-36D Target",
        "ref_mode": "SPEX",
        "target_mode": "SCI"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "statistics" in data
    assert "colorimetric_difference" in data
    assert "diagnostics" in data
    assert data["diagnostics"]["same_geometry"] is False


def test_measurements_table_schema_columns():
    """Verify measurements table has geometry, measurement_mode, and specular_included columns."""
    init_db()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(measurements)")
    cols = {row["name"] for row in cur.fetchall()}
    conn.close()

    assert "geometry" in cols
    assert "measurement_mode" in cols
    assert "specular_included" in cols
