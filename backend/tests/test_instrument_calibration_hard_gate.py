"""
Spectrophotometer Calibration Hard-Gate Tests (Pillar 12)
=========================================================
Validates the industrial calibration hard-gate enforcement:
1. Valid calibration allows physical/mock measurements with HTTP 200.
2. Expired calibration (> 8 hours elapsed) strictly blocks measurement with HTTP 428 Precondition Required.
3. Emergency override force_measure=True bypasses gate with HTTP 200 and records 'EXPIRED_FORCED'.
4. Uncalibrated hardware state strictly blocks measurement with HTTP 428.
5. System clock tampering / backwards drift transitions state to 'CALIBRATION_INVALID' and blocks with HTTP 428.
"""

import time
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.devices.chnspec_driver import chnspec_driver
from backend.devices.rm400_driver import rm400_driver
from backend.database.db import init_db, get_db_connection

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    # Reset drivers to clean mock state
    chnspec_driver._is_mock = True
    chnspec_driver._last_calibrated_at = time.time()
    rm400_driver._is_mock = True
    rm400_driver._last_calibrated_at = time.time()
    yield
    chnspec_driver._is_mock = True
    chnspec_driver._last_calibrated_at = time.time()
    rm400_driver._is_mock = True
    rm400_driver._last_calibrated_at = time.time()


def test_valid_calibration_allows_measurement():
    """Verify that a calibrated instrument takes measurements normally with HTTP 200."""
    # CHNSpec
    resp_chn = client.post("/api/instruments/chnspec/measure", json={"mode": "SCI", "sample_name": "Calibrated Tile"})
    assert resp_chn.status_code == 200
    assert resp_chn.json()["calibration_health"]["status"] == "VALID"

    # RM400
    resp_rm = client.post("/api/instruments/rm400/measure", json={"sample_name": "Calibrated Tile RM"})
    assert resp_rm.status_code == 200
    assert resp_rm.json()["calibration_health"]["status"] == "VALID"


def test_expired_calibration_blocks_with_http_428():
    """Verify that calibration older than 8 hours blocks measurement with HTTP 428 Precondition Required."""
    # Simulate 8.5 hours elapsed on RM400
    rm400_driver._last_calibrated_at = time.time() - (8.5 * 3600.0)

    resp = client.post("/api/instruments/rm400/measure", json={"sample_name": "Expired Test"})
    assert resp.status_code == 428
    detail = resp.json()["detail"]
    assert detail["error_code"] == "INSTRUMENT_CALIBRATION_EXPIRED"
    assert "RM400" in detail["instrument"]
    assert detail["calibration_health"]["status"] == "EXPIRED"

    # Simulate 9 hours elapsed on CHNSpec
    chnspec_driver._last_calibrated_at = time.time() - (9.0 * 3600.0)

    resp_chn = client.post("/api/instruments/chnspec/measure", json={"mode": "SCI", "sample_name": "Expired Test CHN"})
    assert resp_chn.status_code == 428
    detail_chn = resp_chn.json()["detail"]
    assert detail_chn["error_code"] == "INSTRUMENT_CALIBRATION_EXPIRED"
    assert "CHNSpec" in detail_chn["instrument"]
    assert detail_chn["calibration_health"]["status"] == "EXPIRED"


def test_force_measure_override_bypasses_hard_gate():
    """Verify that force_measure=True allows emergency measurement and records EXPIRED_FORCED in audit."""
    rm400_driver._last_calibrated_at = time.time() - (9.5 * 3600.0)

    # Calling with force_measure=True
    resp = client.post("/api/instruments/rm400/measure", json={
        "sample_name": "Emergency Force Sample",
        "save_to_archive": True,
        "force_measure": True
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    meas_id = data["measurement_id"]

    # Verify audit entry in database
    conn = get_db_connection()
    row = conn.execute("SELECT calibration_status FROM measurements WHERE id = ?", (meas_id,)).fetchone()
    conn.close()

    assert row is not None
    assert row["calibration_status"] == "EXPIRED_FORCED"


def test_uncalibrated_hardware_blocks_with_http_428():
    """Verify that uncalibrated physical instrument blocks measurement with HTTP 428."""
    # Temporarily toggle mock off and clear calibration timestamp
    rm400_driver._is_mock = False
    rm400_driver._last_calibrated_at = None

    try:
        resp = client.post("/api/instruments/rm400/measure", json={"sample_name": "Uncalibrated Hardware"})
        assert resp.status_code == 428
        assert resp.json()["detail"]["error_code"] == "INSTRUMENT_CALIBRATION_EXPIRED"
    finally:
        rm400_driver._is_mock = True


def test_clock_tampering_drift_detection():
    """Verify that system clock set into future triggers CALIBRATION_INVALID and blocks with HTTP 428."""
    # Last calibrated timestamp in future (clock moved backwards)
    chnspec_driver._last_calibrated_at = time.time() + 3600.0

    health = chnspec_driver.get_calibration_health()
    assert health["status"] == "CALIBRATION_INVALID"
    assert "clock drift" in health["message"].lower()

    resp = client.post("/api/instruments/chnspec/measure", json={"mode": "SCI", "sample_name": "Tampered Sample"})
    assert resp.status_code == 428
    assert resp.json()["detail"]["calibration_health"]["status"] == "CALIBRATION_INVALID"
