"""
Tests for CHNSpec DS-36D Benchtop Spectrophotometer Native Driver and API Routes
=============================================================================
Verifies:
- Serial COM port discovery and STMicroelectronics identification
- Mock driver simulation lifecycle (connect, calibrate, measure, disconnect)
- 43-channel raw to 31-channel canonical normalization
- FastApi endpoints (/api/instruments/ports, /chnspec/status, /connect, /measure, /calibrate, /disconnect)
- Database measurement archiving for CHNSpec
"""

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.devices.chnspec_driver import CHNSpecDriver, chnspec_driver, CHNSPEC_RAW_WAVELENGTHS
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.database.db import get_db_connection

client = TestClient(app)


def test_chnspec_ports_enumeration():
    """Verify listing serial ports returns expected schema."""
    ports = CHNSpecDriver.list_ports()
    assert isinstance(ports, list)
    assert len(ports) > 0
    for p in ports:
        assert "port" in p
        assert "description" in p
        assert "is_recommended" in p


def test_chnspec_mock_mode_lifecycle():
    """Verify CHNSpec driver operates cleanly in simulated mode."""
    driver = CHNSpecDriver(dll_dir="C:/non_existent_path_to_force_mock")
    assert driver.is_mock is True

    # Connect
    assert driver.connect("COM99") is True
    assert driver.is_connected() is True

    # Calibrate
    w_cal = driver.white_calibrate()
    assert w_cal["success"] is True
    assert w_cal["type"] == "White"

    b_cal = driver.black_calibrate()
    assert b_cal["success"] is True
    assert b_cal["type"] == "Black"

    # Measure SCI
    res_sci = driver.measure(mode="SCI")
    assert res_sci["success"] is True
    assert res_sci["mode"] == "SCI"
    assert res_sci["instrument"] == "CHNSpec DS-36D (d/8°)"
    assert len(res_sci["raw_reflectance"]) == 43
    assert len(res_sci["raw_wavelengths"]) == 43
    assert len(res_sci["reflectance"]) == N_WAVELENGTHS
    assert len(res_sci["wavelengths"]) == N_WAVELENGTHS
    assert all(0.0 <= v <= 1.0 for v in res_sci["reflectance"])
    assert res_sci["lab"]["L"] > 0
    assert res_sci["hex"].startswith("#")

    # Measure SCE
    res_sce = driver.measure(mode="SCE")
    assert res_sce["success"] is True
    assert res_sce["mode"] == "SCE"

    # Status
    status = driver.get_status()
    assert status["instrument"] == "CHNSpec DS-36D"
    assert status["connected"] is True
    assert status["is_mock"] is True

    # Disconnect
    assert driver.disconnect() is True
    assert driver.is_connected() is False


def test_api_instruments_ports():
    """Verify /api/instruments/ports endpoint."""
    resp = client.get("/api/instruments/ports")
    assert resp.status_code == 200
    data = resp.json()
    assert "ports" in data
    assert "active_chnspec_port" in data
    assert "is_chnspec_connected" in data


def test_api_instruments_list_contains_chnspec():
    """Verify instruments list includes CHNSpec DS-36D."""
    resp = client.get("/api/instruments")
    assert resp.status_code == 200
    insts = resp.json()
    chnspec = next((i for i in insts if "DS-36D" in i["model"]), None)
    assert chnspec is not None
    assert "d/8" in chnspec["geometry"]


def test_api_chnspec_endpoints():
    """Verify CHNSpec API workflow: status -> connect -> calibrate -> measure -> disconnect."""
    # 1. Status
    status_resp = client.get("/api/instruments/chnspec/status")
    assert status_resp.status_code == 200
    assert "instrument" in status_resp.json()

    # 2. Connect
    conn_resp = client.post("/api/instruments/chnspec/connect", json={"port": "COM4"})
    assert conn_resp.status_code == 200
    assert conn_resp.json()["connected"] is True

    # 3. Calibrate White (Mock or hardware safe)
    # If in mock mode, run calibrate; if live hardware, test API handling
    if chnspec_driver.is_mock:
        cal_resp = client.post("/api/instruments/chnspec/calibrate", json={"type": "White"})
        assert cal_resp.status_code == 200
        assert cal_resp.json()["success"] is True

    # 4. Measure with archive
    meas_resp = client.post("/api/instruments/chnspec/measure", json={
        "mode": "SCI",
        "sample_name": "Pytest CHNSpec Verification Sample",
        "save_to_archive": True
    })
    assert meas_resp.status_code == 200
    meas = meas_resp.json()
    assert meas["success"] is True
    assert len(meas["reflectance"]) == 31
    assert "measurement_id" in meas

    # Verify measurement was saved in database
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM measurements WHERE id = ?", (meas["measurement_id"],)).fetchone()
    conn.close()
    assert row is not None
    assert row["sample_name"] == "Pytest CHNSpec Verification Sample"

    # 5. Disconnect
    disc_resp = client.post("/api/instruments/chnspec/disconnect")
    assert disc_resp.status_code == 200
    assert disc_resp.json()["success"] is True
