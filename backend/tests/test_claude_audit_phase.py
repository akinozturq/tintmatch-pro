"""
Automated Test Suite: Claude.ai Scientific & Architectural Audit Hardening
=========================================================================
Verifies:
1. Canonical Composite Metamerism Index (DIN 6172 / ASTM E805)
2. Strict Physicality Validator (Dark noise floor & sensor saturation)
3. LOOCV 95th Percentile (p95) Evaluation in Kubelka-Munk & Quality Gate
4. ConstraintEngine 2.0 (Mass bounds, group bounds, min-dispensing pruning, slack)
5. Finite-Difference What-If Sensitivity Matrix (±0.10% concrete steps)
6. Calculation ID & Engine Version 2.2.0 Provenance
7. Production Add-Back Engine (Physical tank mass non-negativity: Delta m >= 0)
8. Instrument Calibration Expiry Health (8-hour shift tracking)
"""

import time
import json
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database.db import get_db_connection, init_db
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.colorimetry import (
    calculate_composite_metamerism,
    compute_metamerism_index,
    reflectance_to_lab,
)
from backend.color_engine.spectrum_normalizer import (
    validate_spectrum_physicality,
    normalize_spectrum,
)
from backend.color_engine.kubelka_munk import (
    characterize_letdown_series,
    reflectance_to_ks,
)
from backend.color_engine.profiles import (
    ENGINE_VERSION,
    ToleranceProfile,
    TOLERANCE_STRICT_LAB,
    TOLERANCE_INDUSTRIAL,
    TOLERANCE_COMMERCIAL,
    DEFAULT_TOLERANCE_PROFILE,
)
from backend.color_engine.quality_gate import (
    evaluate_characterization_gate,
    evaluate_formulation_gate,
)
from backend.color_engine.constraints import (
    FormulationConstraints,
    ConstraintEngine,
)
from backend.color_engine.formulation import (
    predict_recipe,
    match_color_ccm,
    calculate_pigment_sensitivity_matrix,
)
from backend.color_engine.addback import calculate_production_addback
from backend.devices.chnspec_driver import CHNSpecDriver
from backend.devices.rm400_driver import RM400Driver


@pytest.fixture(scope="module", autouse=True)
def setup_database():
    """Ensure database schema is up-to-date with migrations."""
    init_db()


@pytest.fixture
def client():
    return TestClient(app)


# =========================================================================
# 1. Composite Metamerism Index (DIN 6172 / ASTM E805)
# =========================================================================

def test_composite_metamerism_index():
    # Test max method (DIN 6172 standard)
    mi_max = calculate_composite_metamerism(de_d65=0.20, de_a=0.80, de_f11=0.55, method="max")
    # |0.80 - 0.20| = 0.60; |0.55 - 0.20| = 0.35 -> max is 0.60
    assert abs(mi_max - 0.60) < 1e-4

    # Test rms method (ASTM E805 standard)
    mi_rms = calculate_composite_metamerism(de_d65=0.20, de_a=0.80, de_f11=0.55, method="rms")
    expected_rms = np.sqrt(0.5 * (0.60**2 + 0.35**2))
    assert abs(mi_rms - expected_rms) < 1e-3

    # Test integrated compute_metamerism_index
    # Synthetic flat white vs slightly sloped spectrum
    r_ref = [0.80] * N_WAVELENGTHS
    r_target = [0.80 + 0.001 * (i - 15) for i in range(N_WAVELENGTHS)]
    mi_data = compute_metamerism_index(r_ref, r_target)

    assert "MI_composite" in mi_data
    assert "MI_composite_rms" in mi_data
    assert mi_data["MI_composite"] >= 0.0
    assert mi_data["MI_composite_rms"] >= 0.0
    assert mi_data["MI_composite"] >= mi_data["MI_composite_rms"] - 1e-4


# =========================================================================
# 2. Strict Physicality Validator
# =========================================================================

def test_spectrum_physicality_validator():
    # 1. Valid physical spectrum
    valid_r = [0.05 + 0.70 / (1.0 + np.exp(-(w - 550) / 40.0)) for w in WAVELENGTHS]
    v_res = validate_spectrum_physicality(valid_r)
    assert v_res["is_physically_plausible"] is True
    assert v_res["has_severe_dark_noise"] is False
    assert v_res["has_severe_saturation"] is False
    assert len(v_res["warnings"]) == 0

    # 2. Severe dark reference drift (e.g. -0.08)
    dark_drift_r = list(valid_r)
    dark_drift_r[0] = -0.08
    d_res = validate_spectrum_physicality(dark_drift_r)
    assert d_res["is_physically_plausible"] is False
    assert d_res["has_severe_dark_noise"] is True
    assert any("SEVERE_DARK_NOISE_FLOOR" in w for w in d_res["warnings"])

    # 3. Severe sensor saturation (e.g. 1.35)
    saturated_r = list(valid_r)
    saturated_r[15] = 1.35
    s_res = validate_spectrum_physicality(saturated_r)
    assert s_res["is_physically_plausible"] is False
    assert s_res["has_severe_saturation"] is True
    assert any("SEVERE_SENSOR_SATURATION" in w for w in s_res["warnings"])

    # 4. Mild physical non-idealities within tolerance (-0.02, 1.05)
    mild_r = list(valid_r)
    mild_r[0] = -0.02
    mild_r[-1] = 1.05
    m_res = validate_spectrum_physicality(mild_r)
    assert m_res["is_physically_plausible"] is True
    assert len(m_res["warnings"]) == 2  # Warnings issued but acceptable for normalization


# =========================================================================
# 3. LOOCV 95th Percentile Evaluation & Quality Gate
# =========================================================================

def test_loocv_p95_evaluation():
    # Base white spectrum
    base_r = [0.84] * N_WAVELENGTHS

    # 4 Letdown concentrations
    letdowns = [
        {"concentration": 0.5, "reflectance": [0.70 + 0.05 * np.sin(i / 5.0) for i in range(N_WAVELENGTHS)]},
        {"concentration": 1.0, "reflectance": [0.55 + 0.05 * np.sin(i / 5.0) for i in range(N_WAVELENGTHS)]},
        {"concentration": 2.5, "reflectance": [0.35 + 0.05 * np.sin(i / 5.0) for i in range(N_WAVELENGTHS)]},
        {"concentration": 5.0, "reflectance": [0.20 + 0.05 * np.sin(i / 5.0) for i in range(N_WAVELENGTHS)]},
    ]

    res = characterize_letdown_series(base_reflectance=base_r, letdowns=letdowns)
    assert "loocv_result" in res
    loocv = res["loocv_result"]
    assert loocv["status"] == "LOOCV_EVALUATED"
    assert "p95_delta_e00" in loocv
    assert loocv["p95_delta_e00"] is not None
    assert loocv["p95_delta_e00"] >= loocv["mean_delta_e00"]

    # Quality Gate with strict laboratory profile
    gate = evaluate_characterization_gate(
        mean_de00=res["mean_delta_e00"],
        max_de00=res["max_delta_e00"],
        r_squared=res["r_squared"],
        spectral_rmse=res.get("spectral_rmse", 0.01),
        contrast_ratio=98.5,
        letdown_count=4,
        loocv_result=loocv,
        tolerance=TOLERANCE_STRICT_LAB
    )

    check_metrics = {c["metric"]: c for c in gate["checks"]}
    assert "loocv_p95_delta_e00" in check_metrics
    assert check_metrics["loocv_p95_delta_e00"]["limit"] == TOLERANCE_STRICT_LAB.loocv_p95_de00_limit


# =========================================================================
# 4. ConstraintEngine 2.0 (Mass, Groups, Min-Dispense Pruning, Slack)
# =========================================================================

def test_constraint_engine_slsqp():
    constraints_config = FormulationConstraints(
        max_total_load=8.0,
        min_total_load=1.0,
        individual_bounds={"P1": (0.0, 5.0), "P2": (0.1, 4.0)},
        group_bounds={"organic_yellows": 2.5},
        pigment_groups={"organic_yellows": ["P2", "P3"]},
        min_dispense_threshold=0.02
    )

    engine = ConstraintEngine(constraints_config)
    pigments = ["P1", "P2", "P3", "P4"]

    # 1. Bounds
    bounds = engine.build_scipy_bounds(pigments, default_upper_bound=8.0)
    assert bounds[0] == (0.0, 5.0)   # P1
    assert bounds[1] == (0.1, 4.0)   # P2
    assert bounds[2] == (0.0, 8.0)   # P3
    assert bounds[3] == (0.0, 8.0)   # P4

    # 2. Inequalities
    scipy_cons = engine.build_scipy_constraints(pigments)
    assert len(scipy_cons) >= 3      # Upper total, lower total, group

    # 3. Post-processing sub-threshold pruning
    raw_concs = np.array([1.5, 0.015, 2.0, 0.005])  # P2 and P4 are below 0.02%
    cleaned, warnings = engine.post_process_solution(raw_concs, pigments)
    assert cleaned[1] == 0.0         # Pruned
    assert cleaned[3] == 0.0         # Pruned
    assert len(warnings) == 2

    # 4. Slack evaluation
    concs_feasible = np.array([2.0, 1.0, 1.0, 0.5])
    slack_f = engine.evaluate_constraint_slack(concs_feasible, pigments)
    assert slack_f["is_feasible"] is True
    assert abs(slack_f["total_load"] - 4.5) < 1e-4
    assert abs(slack_f["total_slack"] - 3.5) < 1e-4

    # Group violation test: P2 + P3 = 3.0 > 2.5
    concs_infeasible = np.array([1.0, 1.5, 1.5, 0.5])
    slack_inf = engine.evaluate_constraint_slack(concs_infeasible, pigments)
    assert slack_inf["is_feasible"] is False
    assert slack_inf["group_slacks"]["organic_yellows"]["violated"] is True


# =========================================================================
# 5. Finite-Difference What-If Sensitivity Matrix (±0.10% steps)
# =========================================================================

def test_formulation_sensitivity_matrix_discrete_steps():
    base_k = [0.01] * N_WAVELENGTHS
    base_s = [1.00] * N_WAVELENGTHS

    pastes = [
        {
            "id": 1,
            "name": "Phthalo Blue",
            "concentration": 1.5,
            "unit_k": [0.8 - 0.02 * i for i in range(N_WAVELENGTHS)],
            "unit_s": [0.05] * N_WAVELENGTHS
        },
        {
            "id": 2,
            "name": "Titanium Yellow",
            "concentration": 0.8,
            "unit_k": [0.05 + 0.02 * i for i in range(N_WAVELENGTHS)],
            "unit_s": [0.10] * N_WAVELENGTHS
        }
    ]

    target_r = [0.35 + 0.01 * np.sin(i) for i in range(N_WAVELENGTHS)]

    matrix = calculate_pigment_sensitivity_matrix(
        base_k=base_k,
        base_s=base_s,
        matched_pastes=pastes,
        target_reflectance=target_r,
        delta=0.05
    )

    assert len(matrix) == 2
    for row in matrix:
        assert "d_de00_dc" in row
        assert "step_plus_010" in row
        assert "step_minus_010" in row

        plus = row["step_plus_010"]
        assert abs(plus["concentration"] - (row["concentration"] + 0.10)) < 1e-4
        assert "delta_e00" in plus
        assert "delta_L" in plus
        assert "delta_b" in plus

        minus = row["step_minus_010"]
        assert abs(minus["concentration"] - (row["concentration"] - 0.10)) < 1e-4
        assert "delta_e00" in minus


# =========================================================================
# 6. Calculation ID & Engine Version 2.2.0 Provenance
# =========================================================================

def test_calculation_id_and_provenance(client):
    base_k = [0.01] * N_WAVELENGTHS
    base_s = [1.00] * N_WAVELENGTHS

    pastes = [
        {
            "id": 1,
            "name": "Pigment Blue",
            "code": "PB15",
            "unit_k": [0.70 - 0.015 * i for i in range(N_WAVELENGTHS)],
            "unit_s": [0.05] * N_WAVELENGTHS
        },
        {
            "id": 2,
            "name": "Pigment Yellow",
            "code": "PY74",
            "unit_k": [0.05 + 0.02 * i for i in range(N_WAVELENGTHS)],
            "unit_s": [0.05] * N_WAVELENGTHS
        }
    ]

    target_r = [0.40] * N_WAVELENGTHS

    ccm_res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes
    )

    assert "calculation_id" in ccm_res
    assert ccm_res["calculation_id"].startswith("calc_")
    assert len(ccm_res["calculation_id"]) == 17  # "calc_" + 12 hex chars
    assert ccm_res["engine_version"] == "2.2.0"

    # Verify recipes inside also inherit calculation_id
    assert ccm_res["recipes"]["recipe_a"]["calculation_id"] == ccm_res["calculation_id"]
    assert ccm_res["recipes"]["recipe_a"]["engine_version"] == "2.2.0"

    # Test saving recipe via API preserves calculation_id and engine_version
    save_payload = {
        "name": "Provenance Audit Recipe",
        "base_id": 1,
        "pastes": ccm_res["matched_pastes"],
        "predicted_reflectance": ccm_res["prediction"]["reflectance"],
        "lab": ccm_res["prediction"]["lab"],
        "hex_color": ccm_res["prediction"]["hex"],
        "delta_e00": ccm_res["delta_e00"],
        "contrast_ratio": 98.2,
        "calculation_id": ccm_res["calculation_id"],
        "engine_version": ccm_res["engine_version"],
        "profile_id": "color_match"
    }

    res_save = client.post("/api/formulation/recipes", json=save_payload)
    assert res_save.status_code == 200
    recipe_id = res_save.json()["id"]

    # Verify database persistence of calculation_id and engine_version
    conn = get_db_connection()
    row = conn.execute("SELECT calculation_id, engine_version FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    assert row["calculation_id"] == ccm_res["calculation_id"]
    assert row["engine_version"] == "2.2.0"

    hist_row = conn.execute("SELECT calculation_id FROM recipe_history WHERE recipe_id = ?", (recipe_id,)).fetchone()
    assert hist_row["calculation_id"] == ccm_res["calculation_id"]
    conn.close()


# =========================================================================
# 7. Production Add-Back Engine (Tank Mass Non-Negativity: Delta m >= 0)
# =========================================================================

def test_production_addback_engine(client):
    base_k = [0.01] * N_WAVELENGTHS
    base_s = [1.00] * N_WAVELENGTHS

    available_pastes = [
        {
            "id": 1,
            "name": "Organic Yellow",
            "code": "PY74",
            "color_hex": "#ffd700",
            "unit_k": [0.05 + 0.025 * i for i in range(N_WAVELENGTHS)],
            "unit_s": [0.05] * N_WAVELENGTHS
        },
        {
            "id": 2,
            "name": "Phthalo Blue",
            "code": "PB15:3",
            "color_hex": "#0000ff",
            "unit_k": [0.80 - 0.020 * i for i in range(N_WAVELENGTHS)],
            "unit_s": [0.05] * N_WAVELENGTHS
        }
    ]

    # Current batch: 500 kg tank with 1.0% Yellow and 0.5% Blue (too yellowish)
    current_pastes = [
        {"id": 1, "name": "Organic Yellow", "concentration": 1.0},
        {"id": 2, "name": "Phthalo Blue", "concentration": 0.5}
    ]

    # Target requires more blue
    sim_target = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=[
            {"id": 1, "concentration": 1.0, "unit_k": available_pastes[0]["unit_k"], "unit_s": available_pastes[0]["unit_s"]},
            {"id": 2, "concentration": 0.9, "unit_k": available_pastes[1]["unit_k"], "unit_s": available_pastes[1]["unit_s"]}
        ]
    )
    target_r = sim_target["reflectance"]

    addback_res = calculate_production_addback(
        tank_mass_kg=500.0,
        current_pastes=current_pastes,
        target_reflectance=target_r,
        available_pastes=available_pastes,
        base_k=base_k,
        base_s=base_s,
        allow_base_addition=True
    )

    # 1. Delta E improves
    assert addback_res["final_delta_e00"] < addback_res["initial_delta_e00"]

    # 2. Strict non-negativity: no pigment removal
    assert addback_res["base_addition_kg"] >= 0.0
    for add in addback_res["additions"]:
        assert add["addition_kg"] >= 0.0
        assert add["final_kg"] >= add["current_kg"]

    # 3. Tank mass conservation
    expected_final_mass = 500.0 + addback_res["base_addition_kg"] + addback_res["total_pigment_addition_kg"]
    assert abs(addback_res["tank_mass_final_kg"] - expected_final_mass) < 0.05

    # 4. API endpoint verification
    api_payload = {
        "tank_mass_kg": 500.0,
        "current_pastes": current_pastes,
        "target_reflectance": target_r,
        "base_id": 1,
        "allow_base_addition": True
    }
    api_resp = client.post("/api/formulation/add-back", json=api_payload)
    assert api_resp.status_code == 200
    data = api_resp.json()
    assert "additions" in data
    assert "is_correctable" in data


# =========================================================================
# 8. Instrument Calibration Expiry Health (8-hour shift tracking)
# =========================================================================

def test_instrument_calibration_expiry():
    # 1. CHNSpec driver calibration tracking
    chnspec = CHNSpecDriver()
    chnspec._is_mock = True

    # Initial state (mock ready or fresh)
    health_initial = chnspec.get_calibration_health()
    assert health_initial["status"] in ["VALID", "UNCALIBRATED"]

    # Trigger calibration
    chnspec.white_calibrate()
    health_calibrated = chnspec.get_calibration_health()
    assert health_calibrated["status"] == "VALID"
    assert health_calibrated["remaining_hours"] > 7.9

    # Simulate near expiry (7.5 hours elapsed -> 0.5 hours remaining)
    chnspec._last_calibrated_at = time.time() - (7.5 * 3600.0)
    health_soon = chnspec.get_calibration_health()
    assert health_soon["status"] == "EXPIRING_SOON"

    # Simulate expired (8.5 hours elapsed)
    chnspec._last_calibrated_at = time.time() - (8.5 * 3600.0)
    health_expired = chnspec.get_calibration_health()
    assert health_expired["status"] == "EXPIRED"

    # 2. RM400 driver calibration tracking
    rm400 = RM400Driver()
    rm400._is_mock = True

    rm400.calibrate("White")
    rm_health = rm400.get_calibration_health()
    assert rm_health["status"] == "VALID"

    rm400._last_calibrated_at = time.time() - (9.0 * 3600.0)
    assert rm400.get_calibration_health()["status"] == "EXPIRED"
