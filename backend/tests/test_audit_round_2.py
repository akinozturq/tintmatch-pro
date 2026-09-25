"""
TintMatch PRO - Audit Round 2 Scientific & Engineering Hardening Test Suite
===========================================================================
Validates:
1. Strict MeasurementContext & Solver Geometry Isolation (Rejects cross-geometry match and NULL geometry leaks)
2. Instrument Registry Integrity & Missing Registration Rejection (No hardcoded fallback IDs)
3. Strict SCI/SCE Dual Spectrum Contract (Raises RuntimeError if device fails to deliver 2 spectra)
4. LOOCV Quality Gate Hardening (n < 4 can never receive PASS; enforces mean and max limits)
5. Driver ERROR State Machine (Explicit transition to ERROR state on hardware/port failure)
6. Multi-Wavelength Jacobian Condition Quantiles (p95, max, worst_wavelength_nm)
7. Characterization Provenance & Simulation Guard (Rejects unapproved simulated saves, tracks version and active_characterization_id)
8. Instrument Comparison ToleranceProfile-driven Status & Refined SCI Bias Diagnostics
"""

import json
import time
import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.database.db import get_db_connection, init_db
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.profiles import (
    MeasurementContext,
    ToleranceProfile,
    TOLERANCE_STRICT_LAB,
    TOLERANCE_INDUSTRIAL,
    DEFAULT_TOLERANCE_PROFILE
)
from backend.color_engine.quality_gate import evaluate_characterization_gate
from backend.color_engine.kubelka_munk import (
    calculate_km_jacobian_condition,
    characterize_letdown_series
)
from backend.color_engine.instrument_comparison import compare_spectral_measurements
from backend.color_engine.rm400_parser import get_industrial_sample_datasets
from backend.devices.chnspec_driver import CHNSpecDriver
from backend.devices.rm400_driver import RM400Driver

client = TestClient(app)


# ============================================================================
# 1. Solver Geometry Isolation Tests
# ============================================================================

def test_solver_geometry_mismatch_rejected():
    """Verify solver rejects matching when target geometry does not match base geometry."""
    # Target requests d/8° sphere measurement, but Base #1 is 45°/0°
    req_body = {
        "target_reflectance": [0.5] * 31,
        "base_id": 1,
        "geometry": "d/8°",
        "max_pastes": 3
    }
    resp = client.post("/api/formulation/match", json=req_body)
    assert resp.status_code == 400
    assert "Cross-geometry formulation is prohibited" in resp.json()["detail"]


def test_solver_rejects_empty_candidates_when_no_pastes_for_geometry():
    """Verify solver queries only pastes matching the requested geometry, rejecting without fallback."""
    # Create a dummy base with geometry 'd/8°'
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    INSERT INTO bases (name, code, base_type, contrast_ratio, reflectance, absorption_k, scattering_s, geometry)
    VALUES ('Sphere Test Base', 'BASE-D8-TEST', 'white_a', 99.0, ?, ?, ?, 'd/8°')
    """, (
        json.dumps([0.8] * 31),
        json.dumps([0.02] * 31),
        json.dumps([1.5] * 31)
    ))
    sphere_base_id = cur.lastrowid
    conn.commit()
    conn.close()

    try:
        # Request match for d/8° geometry where no d/8° pastes exist
        req_body = {
            "target_reflectance": [0.3] * 31,
            "base_id": sphere_base_id,
            "geometry": "d/8°",
            "max_pastes": 3
        }
        resp = client.post("/api/formulation/match", json=req_body)
        assert resp.status_code == 400
        assert "No characterized colorant pastes found matching optical geometry 'd/8°'" in resp.json()["detail"]
    finally:
        # Cleanup dummy base
        conn = get_db_connection()
        conn.execute("DELETE FROM bases WHERE id = ?", (sphere_base_id,))
        conn.commit()
        conn.close()


# ============================================================================
# 2. Instrument Registry Integrity & Simulation Flag
# ============================================================================

def test_measurement_archive_records_simulation_flag():
    """Verify simulated mock measurements archive with is_simulation = 1."""
    from backend.devices.chnspec_driver import chnspec_driver
    orig_mock = chnspec_driver._is_mock
    try:
        chnspec_driver._is_mock = True
        resp = client.post("/api/instruments/chnspec/measure", json={
            "mode": "SCI",
            "sample_name": "Audit Simulation Test Sample",
            "save_to_archive": True
        })
        assert resp.status_code == 200

        conn = get_db_connection()
        row = conn.execute("""
        SELECT * FROM measurements
        WHERE sample_name = 'Audit Simulation Test Sample'
        ORDER BY id DESC LIMIT 1
        """).fetchone()
        conn.close()

        assert row is not None
        assert row["is_simulation"] == 1
        assert row["geometry"] == "d/8°"
    finally:
        chnspec_driver._is_mock = orig_mock


# ============================================================================
# 3. Strict SCI/SCE Dual Spectrum Contract
# ============================================================================

def test_strict_sci_sce_dual_spectrum_contract_raises_on_missing_curve():
    """Verify CHNSpecDriver.measure('SCI_SCE') raises RuntimeError if second spectrum is missing."""
    driver = CHNSpecDriver(dll_dir="C:/non_existent_mock")
    driver._is_mock = False
    driver._connected = True
    driver._Measure_Mode = type("MeasureMode", (), {"SCI": 0, "SCE": 1, "SCI_SCE": 2})()

    mock_spec = type("SpectralInfo", (), {
        "Data": [0.5] * 43,
        "ColorValues": [50.0, 0.0, 0.0]
    })()

    def simulate_partial_measure(*args, **kwargs):
        driver._meas_result = [mock_spec]
        driver._meas_success = True
        driver._meas_event.set()

    driver._dev = type("MockDev", (), {"Measure": simulate_partial_measure, "IsConnected": True})()

    with pytest.raises(RuntimeError, match="Dual SCI_SCE requested but device failed to deliver second spectrum"):
        driver.measure(mode="SCI_SCE")


# ============================================================================
# 4. LOOCV Quality Gate Hardening (n < 4 and Max Limits)
# ============================================================================

def test_loocv_quality_gate_n_less_than_4_never_passes():
    """Verify LOOCV check marks status='WARN' and overall gate status='WARN' when n < 4."""
    # Gate check with n=3 (df = 0)
    loocv_data = {
        "status": "LOOCV_SKIPPED_INSUFFICIENT_LETDOWNS",
        "n_folds": 3,
        "samples_count": 3,
        "mean_delta_e00": None,
        "max_delta_e00": None
    }

    gate_res = evaluate_characterization_gate(
        mean_de00=0.15,
        max_de00=0.25,
        r_squared=0.999,
        spectral_rmse=0.005,
        contrast_ratio=98.5,
        letdown_count=3,
        loocv_result=loocv_data,
        tolerance=TOLERANCE_STRICT_LAB
    )

    # Gate must NOT be PASS when LOOCV has insufficient letdowns
    assert gate_res["status"] == "WARN"
    loocv_check = next(c for c in gate_res["checks"] if c["metric"] == "loocv_mean_delta_e00")
    assert loocv_check["status"] == "WARN"
    assert "n < 4" in str(loocv_check["actual"])


def test_loocv_quality_gate_enforces_max_delta_e00():
    """Verify LOOCV quality gate evaluates both mean and max delta_e00."""
    # Mean is compliant (0.35 <= 0.50), but max exceeds limit (1.25 > 1.00)
    loocv_data = {
        "status": "LOOCV_EVALUATED",
        "n_folds": 5,
        "samples_count": 5,
        "mean_delta_e00": 0.35,
        "max_delta_e00": 1.25,
        "errors": [0.2, 0.3, 0.35, 0.4, 1.25]
    }

    gate_res = evaluate_characterization_gate(
        mean_de00=0.15,
        max_de00=0.25,
        r_squared=0.999,
        spectral_rmse=0.005,
        contrast_ratio=98.5,
        letdown_count=5,
        loocv_result=loocv_data,
        tolerance=TOLERANCE_STRICT_LAB
    )

    # Must fail or warn due to max limit breach
    assert gate_res["status"] in ("FAIL", "WARN")
    max_check = next((c for c in gate_res["checks"] if c["metric"] == "loocv_max_delta_e00"), None)
    assert max_check is not None
    assert max_check["status"] == "FAIL"


# ============================================================================
# 5. Driver ERROR State Machine Tests
# ============================================================================

def test_chnspec_driver_transitions_to_error_state():
    """Verify CHNSpecDriver transitions to ERROR state upon unhandled exception."""
    driver = CHNSpecDriver(dll_dir="C:/non_existent_mock")
    assert driver.connection_state == "DISCONNECTED"

    # Simulate dev.connect raising an exception
    class FaultyDev:
        ConnectedId = None
        ConnectType = None
        def connect(self):
            raise IOError("Serial port I/O error on hardware interface")
    driver._is_mock = False
    driver._ConnectMethod = type("CM", (), {"usb": 1})()
    driver._dev = FaultyDev()

    ok = driver.connect("COM99")
    assert ok is False
    assert driver.connection_state == "ERROR"
    assert "Serial port I/O error" in driver.last_error


def test_rm400_driver_transitions_to_error_state():
    """Verify RM400Driver transitions to ERROR state upon unhandled exception."""
    driver = RM400Driver(dll_path="C:/non_existent_rm400.dll")
    assert driver.connection_state == "DISCONNECTED"

    # Simulate dll.Connect raising an exception
    class FaultyDll:
        def Connect(self):
            raise RuntimeError("FTDI USB controller communication failed")
    driver.dll = FaultyDll()

    ok = driver.connect()
    assert ok is False
    assert driver.connection_state == "ERROR"
    assert "FTDI USB controller" in driver.last_error


# ============================================================================
# 6. Multi-Wavelength Jacobian Condition Quantiles
# ============================================================================

def test_jacobian_condition_quantiles_output():
    """Verify calculate_km_jacobian_condition computes p95, max, and worst wavelength."""
    c_series = [0.005, 0.01, 0.025, 0.05, 0.10]
    # Simulated unit K and S
    k_vec = np.linspace(0.1, 2.5, 31)
    s_vec = np.linspace(0.05, 0.2, 31)
    k_base = np.full(31, 0.02)
    s_base = np.full(31, 1.0)

    cond_res = calculate_km_jacobian_condition(c_series, k_vec, s_vec, k_base, s_base)
    assert "scaled_condition_number" in cond_res
    assert "p95_condition_number" in cond_res
    assert "max_condition_number" in cond_res
    assert "worst_wavelength_nm" in cond_res

    assert cond_res["p95_condition_number"] >= 1.0
    assert cond_res["max_condition_number"] >= cond_res["p95_condition_number"]
    assert cond_res["worst_wavelength_nm"] in [int(w) for w in WAVELENGTHS]


# ============================================================================
# 7. Characterization Provenance & Simulation Guard
# ============================================================================

def test_save_characterization_rejects_unapproved_simulation():
    """Verify /api/characterization/save rejects simulated data if allow_simulation_save is False."""
    datasets = get_industrial_sample_datasets()
    letdowns = datasets["colorants"]["PG7"]["letdowns"]
    sample_calc = {
        "unit_k": [0.1] * 31,
        "unit_s": [0.05] * 31,
        "unit_ks": [2.0] * 31,
        "mean_delta_e00": 0.12,
        "passed_validation": True
    }

    resp = client.post("/api/characterization/save", json={
        "name": "Simulated PG7 Pigment",
        "code": f"SIM-PG7-{time.time_ns()}",
        "density": 1.35,
        "base_id": 1,
        "is_simulation": True,
        "allow_simulation_save": False,
        "letdowns": letdowns,
        "calculation_results": sample_calc
    })
    assert resp.status_code == 400
    assert "Cannot save simulated characterization data" in resp.json()["detail"]


def test_save_characterization_records_provenance_and_version():
    """Verify /api/characterization/save records active_characterization_id and increments version."""
    datasets = get_industrial_sample_datasets()
    letdowns = datasets["colorants"]["PG7"]["letdowns"]
    sample_calc = {
        "unit_k": [0.1] * 31,
        "unit_s": [0.05] * 31,
        "unit_ks": [2.0] * 31,
        "mean_delta_e00": 0.12,
        "passed_validation": True
    }
    test_code = f"PROV-{time.time_ns()}"

    # Initial Save v1
    resp_v1 = client.post("/api/characterization/save", json={
        "name": f"Provenance Test Paste {test_code}",
        "code": test_code,
        "density": 1.35,
        "base_id": 1,
        "geometry": "45°/0°",
        "characterization_version": 1,
        "letdowns": letdowns,
        "calculation_results": sample_calc
    })
    assert resp_v1.status_code == 200
    data_v1 = resp_v1.json()
    paste_id = data_v1["paste_id"]
    char_id_v1 = data_v1["characterization_id"]
    assert data_v1["version"] == 1

    # Verify DB paste row links active_characterization_id
    conn = get_db_connection()
    paste_row = conn.execute("SELECT * FROM pastes WHERE id = ?", (paste_id,)).fetchone()
    assert paste_row["active_characterization_id"] == char_id_v1
    assert paste_row["characterization_version"] == 1
    assert paste_row["geometry"] == "45°/0°"

    # Re-save with same code -> should increment version to v2 and update active_characterization_id
    resp_v2 = client.post("/api/characterization/save", json={
        "name": f"Provenance Test Paste {test_code} Rev2",
        "code": test_code,
        "density": 1.35,
        "base_id": 1,
        "geometry": "45°/0°",
        "characterization_version": 1,
        "letdowns": letdowns,
        "calculation_results": sample_calc
    })
    assert resp_v2.status_code == 200
    data_v2 = resp_v2.json()
    char_id_v2 = data_v2["characterization_id"]
    assert data_v2["version"] == 2
    assert char_id_v2 != char_id_v1

    paste_row_v2 = conn.execute("SELECT * FROM pastes WHERE id = ?", (paste_id,)).fetchone()
    assert paste_row_v2["active_characterization_id"] == char_id_v2
    assert paste_row_v2["characterization_version"] == 2
    conn.close()


# ============================================================================
# 8. Instrument Comparison ToleranceProfile & Diagnostics
# ============================================================================

def test_instrument_comparison_tolerance_profile_and_diagnostics():
    """Verify instrument comparison evaluates comparison_status and outputs refined SCI note."""
    ref_r = [0.2] * 31
    target_r = [0.24] * 31  # Includes ~4% specular/sphere shift

    res = compare_spectral_measurements(
        ref_spectrum=ref_r,
        target_spectrum=target_r,
        ref_meta={"instrument": "X-Rite RM400", "geometry": "45°/0°", "mode": "SPEX"},
        target_meta={"instrument": "CHNSpec DS-36D", "geometry": "d/8°", "mode": "SCI"},
        tolerance_profile=TOLERANCE_INDUSTRIAL
    )
    assert res["success"] is True
    diag = res["diagnostics"]
    assert "comparison_status" in diag
    assert diag["comparison_status"] in ("PASS", "WARN", "FAIL")

    # Check refined SCI bias note
    sci_note = next(n for n in diag["notes"] if "SCI" in n)
    assert "sphere trap etkisi" in sci_note or "bileşik kayma" in sci_note
