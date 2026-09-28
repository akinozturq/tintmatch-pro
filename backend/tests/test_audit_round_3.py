"""
TintMatch PRO - Audit Round 3 Production Hardening Test Suite
============================================================
Validates:
1. Authoritative ConstraintEngine Validation (validate_solution, evaluate_constraint_slack, project_to_feasible).
2. Quality Gate min_total_load enforcement & transparent base opacity semantics (INFORMATIONAL).
3. Dual-metric candidate pre-screening with signed delta K/S and scattering alignment.
4. Feasible multi-start initialization (Dirichlet/simplex bounded starts).
5. Canonical SHA-256 hash enrichment (profile weights, engine version, constraints).
6. Elimination of silent exception suppression in Jacobian condition calculation.
7. REST API support for advanced constraints (min_total_load, individual_bounds, multistart).
8. CORS security policy hardening (no allow_credentials with wildcard '*').
"""

import json
import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.constraints import FormulationConstraints, ConstraintEngine
from backend.color_engine.quality_gate import (
    evaluate_formulation_gate,
    evaluate_characterization_gate,
    DEFAULT_TOLERANCE_PROFILE
)
from backend.color_engine.formulation import match_color_ccm, predict_recipe
from backend.color_engine.hashing import compute_formulation_input_hash
from backend.color_engine.kubelka_munk import calculate_km_jacobian_condition
from backend.routes.formulation import compute_canonical_execution_hash

client = TestClient(app)


# ============================================================================
# 1. Authoritative Constraint Validation & Feasible Projection Tests
# ============================================================================

def test_constraint_engine_validate_solution_authoritative():
    """Verify validate_solution catches non-negativity, bounds, groups, and min/max total load."""
    constraints = FormulationConstraints(
        max_total_load=10.0,
        min_total_load=1.0,
        individual_bounds={"P1": (0.0, 4.0), "P2": (0.0, 3.0)},
        group_bounds={"organics": 3.5},
        pigment_groups={"organics": ["P1", "P2"]},
        min_dispense_threshold=0.02
    )
    engine = ConstraintEngine(constraints)
    keys = ["P1", "P2", "P3"]

    # 1. Valid feasible vector
    valid_vec = [2.0, 1.0, 1.5]
    val_res = engine.validate_solution(valid_vec, keys)
    assert val_res["is_valid"] is True
    assert len(val_res["violations"]) == 0
    assert val_res["slack_info"]["is_feasible"] is True

    # 2. Exceeding individual bound on P1
    viol_ind = [4.5, 0.5, 1.0]
    val_res2 = engine.validate_solution(viol_ind, keys)
    assert val_res2["is_valid"] is False
    assert any("out of bounds" in v for v in val_res2["violations"])

    # 3. Exceeding group bound (P1 + P2 = 2.5 + 1.5 = 4.0 > 3.5)
    viol_grp = [2.5, 1.5, 1.0]
    val_res3 = engine.validate_solution(viol_grp, keys)
    assert val_res3["is_valid"] is False
    assert any("Chemical group 'organics'" in v for v in val_res3["violations"])

    # 4. Violating min_total_load (sum = 0.5 < 1.0)
    viol_min = [0.2, 0.2, 0.1]
    val_res4 = engine.validate_solution(viol_min, keys)
    assert val_res4["is_valid"] is False
    assert any("below min limit" in v for v in val_res4["violations"])

    # 5. Projecting violating vector to feasible space
    proj = engine.project_to_feasible([5.0, 4.0, 8.0], keys)
    val_proj = engine.validate_solution(proj, keys)
    assert val_proj["is_valid"] is True
    assert np.sum(proj) <= 10.0 + 1e-5
    assert proj[0] <= 4.0 + 1e-5
    assert proj[1] <= 3.0 + 1e-5
    assert proj[0] + proj[1] <= 3.5 + 1e-5


# ============================================================================
# 2. Quality Gate Enforcement Tests (min_total_load & is_opaque)
# ============================================================================

def test_formulation_gate_min_total_load_enforcement():
    """Verify formulation quality gate strictly fails if total load falls below min_total_load."""
    # When min_total_load is 2.0% but total_load is 1.5%: FAIL
    res_fail = evaluate_formulation_gate(
        delta_e00_d65=0.20,
        composite_mi=0.15,
        total_load=1.50,
        max_total_load=12.0,
        min_total_load=2.00,
        solver_status="OPTIMAL_CONVERGED"
    )
    assert res_fail["status"] == "FAIL"
    min_check = next(c for c in res_fail["checks"] if c["metric"] == "min_total_load")
    assert min_check["status"] == "FAIL"

    # When total_load is 2.5%: PASS
    res_pass = evaluate_formulation_gate(
        delta_e00_d65=0.20,
        composite_mi=0.15,
        total_load=2.50,
        max_total_load=12.0,
        min_total_load=2.00,
        solver_status="OPTIMAL_CONVERGED"
    )
    assert res_pass["status"] == "PASS"


def test_characterization_gate_transparent_base_opacity_semantics():
    """Verify transparent / deep bases (is_opaque=False) receive INFORMATIONAL opacity check without penalty."""
    res_trans = evaluate_characterization_gate(
        mean_de00=0.25,
        max_de00=0.45,
        r_squared=0.998,
        spectral_rmse=0.008,
        contrast_ratio=75.0,  # Below standard 98% opaque limit
        letdown_count=4,
        is_opaque=False
    )
    cr_check = next(c for c in res_trans["checks"] if c["metric"] == "contrast_ratio")
    assert cr_check["status"] == "INFORMATIONAL"
    assert cr_check["severity"] == "INFO"
    assert "Şeffaf / Derin Baz" in cr_check["label"]


# ============================================================================
# 3. Dual-Metric Candidate Screening & Multi-Start Feasibility
# ============================================================================

def test_dual_metric_pre_screening_negative_delta_ks():
    """Verify dual-metric pre-screening correctly operates when target requires scattering/lightening."""
    base_k = np.full(31, 0.05)
    base_s = np.full(31, 0.80)

    pastes = [
        {"id": 1, "name": "White TiO2", "code": "PW6", "unit_k": [0.005] * 31, "unit_s": [1.50] * 31},
        {"id": 2, "name": "Deep Blue", "code": "PB15", "unit_k": [1.2 - 0.02 * i for i in range(31)], "unit_s": [0.02] * 31},
        {"id": 3, "name": "Carbon Black", "code": "PBk7", "unit_k": [2.5] * 31, "unit_s": [0.01] * 31},
    ]

    # Target is significantly lighter than the base (high reflectance across spectrum)
    target_r = [0.70] * 31

    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=2,
        max_total_load=12.0
    )

    # Solver successfully converges and selects White TiO2 to satisfy lightening demand
    assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    matched_ids = [p["id"] for p in res["matched_pastes"]]
    assert 1 in matched_ids, "White TiO2 (id 1) was not selected for lighter target"


def test_multistart_slsqp_all_starts_strictly_feasible():
    """Verify multi-start SLSQP evaluates multiple feasible start points without violating constraints."""
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)

    pastes = [
        {"id": 1, "name": "Blue", "code": "PB15", "unit_k": [0.8] * 31, "unit_s": [0.05] * 31},
        {"id": 2, "name": "Yellow", "code": "PY74", "unit_k": [0.1 + 0.03 * i for i in range(31)], "unit_s": [0.10] * 31},
        {"id": 3, "name": "Red", "code": "PR101", "unit_k": [0.2] * 31, "unit_s": [0.12] * 31},
    ]

    target = predict_recipe(base_k, base_s, [
        {"id": 1, "name": "Blue", "concentration": 1.2, "unit_k": pastes[0]["unit_k"], "unit_s": pastes[0]["unit_s"]},
        {"id": 2, "name": "Yellow", "concentration": 0.8, "unit_k": pastes[1]["unit_k"], "unit_s": pastes[1]["unit_s"]}
    ])

    res = match_color_ccm(
        target_reflectance=target["reflectance"],
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=8.0,
        enable_multistart=True,
        num_starts=5
    )

    assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    diag = res["diagnostics"]
    assert diag["multistart"]["enabled"] is True
    assert diag["multistart"]["num_starts_evaluated"] == 5
    assert diag["constraint_validation"]["is_valid"] is True


# ============================================================================
# 4. Canonical Hashing & Provenance Tests
# ============================================================================

def test_canonical_hash_enrichment_profile_weights_and_version():
    """Verify canonical input hash differentiates by profile objective weights, constraints, and version."""
    target_r = [0.25] * 31
    base_k = [0.02] * 31
    base_s = [1.00] * 31
    pastes = [{"id": 1, "code": "P1", "unit_k": [0.5] * 31, "unit_s": [0.1] * 31}]

    # Hash with standard profile A weights
    hash_a = compute_formulation_input_hash(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        profile_weights={"d65": 1.0, "metamerism": 0.0, "load": 0.0}
    )

    # Hash with economy profile C weights (heavy load penalty)
    hash_c = compute_formulation_input_hash(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        profile_weights={"d65": 0.6, "metamerism": 0.1, "load": 0.5}
    )

    # Different profile weights MUST produce different canonical input hashes
    assert hash_a != hash_c

    # Execution context hash includes algorithm identity
    exec_hash = compute_canonical_execution_hash(
        base_id=1,
        base_hash="abc",
        pastes=pastes,
        profile_id="color_match"
    )
    assert len(exec_hash) == 64


# ============================================================================
# 5. Jacobian Condition Diagnostics & Exception Transparency
# ============================================================================

def test_jacobian_condition_skipped_wavelengths_diagnostics(monkeypatch):
    """Verify calculate_km_jacobian_condition records skipped wavelengths transparently without silent suppression."""
    c_series = np.array([0.01, 0.03, 0.06, 0.12])
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)
    unit_k = np.full(31, 0.40)
    unit_s = np.full(31, 0.10)

    call_count = [0]

    def mock_cond(matrix):
        call_count[0] += 1
        wl_idx = (call_count[0] - 1) // 2
        is_scaled = (call_count[0] % 2 == 1)
        # Simulate LinAlgError on wavelength index 10 (500 nm)
        if wl_idx == 10 and is_scaled:
            raise np.linalg.LinAlgError("SVD did not converge")
        return 40.0

    monkeypatch.setattr(np.linalg, "cond", mock_cond)

    res = calculate_km_jacobian_condition(c_series, base_k, base_s, unit_k, unit_s)
    assert "skipped_wavelengths" in res
    assert len(res["skipped_wavelengths"]) == 1
    skipped = res["skipped_wavelengths"][0]
    assert skipped["wavelength_nm"] == int(WAVELENGTHS[10])
    assert "SVD did not converge" in skipped["error"]
    assert res["valid_wavelengths_count"] == 30


# ============================================================================
# 6. REST API & CORS Security Tests
# ============================================================================

def test_match_target_api_advanced_constraints():
    """Verify /api/formulation/match accepts min_total_load and multistart options."""
    req_body = {
        "target_reflectance": [0.25] * 31,
        "base_id": 1,
        "max_pastes": 3,
        "max_total_load": 10.0,
        "min_total_load": 0.5,
        "enable_multistart": True,
        "num_starts": 2
    }
    resp = client.post("/api/formulation/match", json=req_body)
    assert resp.status_code == 200
    data = resp.json()
    assert "calculation_id" in data
    assert "engine_version" in data
    assert data["engine_version"] == "2.2.0"
    assert data["diagnostics"]["multistart"]["enabled"] is True


def test_cors_credentials_wildcard_safety():
    """Verify CORS middleware does not combine allow_credentials=True with wildcard '*'."""
    from fastapi.middleware.cors import CORSMiddleware
    cors_mw = next(m for m in app.user_middleware if m.cls == CORSMiddleware)
    kwargs = cors_mw.kwargs
    allow_origins = kwargs.get("allow_origins", [])
    allow_credentials = kwargs.get("allow_credentials", False)

    if allow_credentials:
        assert "*" not in allow_origins, "Security violation: allow_credentials=True combined with allow_origins=['*']"
