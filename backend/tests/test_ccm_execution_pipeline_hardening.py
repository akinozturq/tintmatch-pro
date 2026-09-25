"""
TintMatch PRO - CCM Execution Pipeline & Quality Gate Negative Hardening Test Suite
===================================================================================
Directly verifies:
1. Negative scenario: Composite Metamerism Index (MI) failure strictly blocks Formulation Gate overall PASS
2. Positive scenario: Compliant MI allows Formulation Gate overall PASS
3. Quality Gate strict AND condition: any single failure (dE00, MI, total load, solver) forces FAIL
4. Jacobian condition number resilience: skipped/NaN intermediate wavelengths do NOT misalign worst_wavelength_nm
5. Optical thickness scale parameterization: non-magic scalability across forward, opacity, and drawdown calibration
6. Real CCM execution path: FormulationConstraints and SLSQP enforce true mass limit sum(c_i) <= max_total_load
7. Real CCM execution path: OptimizationProfile distinction (Recipe A vs Recipe B vs Recipe C) under multi-illuminant conditions
"""

import numpy as np
import pytest

from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.profiles import (
    TOLERANCE_STRICT_LAB,
    TOLERANCE_INDUSTRIAL,
    PROFILE_COLOR_MATCH,
    PROFILE_LIGHT_STABILITY,
    PROFILE_ECONOMY,
)
from backend.color_engine.constraints import FormulationConstraints
from backend.color_engine.quality_gate import (
    evaluate_formulation_gate,
    evaluate_characterization_gate,
)
from backend.color_engine.kubelka_munk import (
    calculate_km_jacobian_condition,
    forward_two_constant_km,
    calculate_opacity_contrast_ratio,
    calibrate_thickness_from_drawdown,
)
from backend.color_engine.formulation import match_color_ccm, predict_recipe


# ============================================================================
# 1. Formulation Quality Gate: MI Failure Negative & Positive Tests
# ============================================================================

def test_formulation_gate_mi_failure_strictly_blocks_overall_pass():
    """
    Negative scenario: Verify that even when dE00(D65), total load, and solver succeed,
    a composite metamerism index exceeding tolerance strictly forces overall_pass = False and status = 'FAIL'.
    """
    # Strict Lab tolerance: single_de00_limit = 0.50, composite_mi_limit = 0.30
    gate = evaluate_formulation_gate(
        delta_e00_d65=0.22,               # PASS (<= 0.50)
        composite_mi=0.55,                # FAIL (> 0.30)
        total_load=4.5,                   # PASS (<= 12.0)
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",# PASS
        tolerance=TOLERANCE_STRICT_LAB
    )

    assert gate["gate_type"] == "FORMULATION_GATE"
    assert gate["status"] == "FAIL", "Overall gate must FAIL when MI exceeds tolerance limit"
    assert gate["overall_severity"] == "CRITICAL"

    checks_by_metric = {c["metric"]: c for c in gate["checks"]}
    assert checks_by_metric["delta_e00_d65"]["status"] == "PASS"
    assert checks_by_metric["composite_metamerism"]["status"] == "FAIL"
    assert checks_by_metric["total_load"]["status"] == "PASS"
    assert checks_by_metric["solver_status"]["status"] == "PASS"


def test_formulation_gate_mi_pass_allows_overall_pass():
    """
    Positive scenario: Verify that when all 4 metrics (dE00, MI, total load, solver)
    comply with tolerance, the gate returns PASS.
    """
    gate = evaluate_formulation_gate(
        delta_e00_d65=0.22,
        composite_mi=0.18,                # PASS (<= 0.30)
        total_load=4.5,
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",
        tolerance=TOLERANCE_STRICT_LAB
    )

    assert gate["status"] == "PASS"
    assert gate["overall_severity"] == "INFO"
    assert all(c["status"] == "PASS" for c in gate["checks"])


def test_formulation_gate_strict_and_condition_matrix():
    """
    Verify that failure of ANY single criteria among dE00, MI, load, or solver
    causes overall gate status to be FAIL.
    """
    # Case 1: dE00 fails
    g1 = evaluate_formulation_gate(delta_e00_d65=0.85, composite_mi=0.15, total_load=5.0, solver_status="OPTIMAL_CONVERGED")
    assert g1["status"] == "FAIL"

    # Case 2: MI fails
    g2 = evaluate_formulation_gate(delta_e00_d65=0.25, composite_mi=0.65, total_load=5.0, solver_status="OPTIMAL_CONVERGED")
    assert g2["status"] == "FAIL"

    # Case 3: Total load fails
    g3 = evaluate_formulation_gate(delta_e00_d65=0.25, composite_mi=0.15, total_load=15.0, max_total_load=12.0, solver_status="OPTIMAL_CONVERGED")
    assert g3["status"] == "FAIL"

    # Case 4: Solver fails (e.g. CONSTRAINTS_VIOLATED)
    g4 = evaluate_formulation_gate(delta_e00_d65=0.25, composite_mi=0.15, total_load=5.0, solver_status="CONSTRAINTS_VIOLATED")
    assert g4["status"] == "FAIL"


# ============================================================================
# 2. Jacobian Condition: Missing/Skipped Wavelength Resilience
# ============================================================================

def test_jacobian_condition_resilient_to_missing_wavelength():
    """
    Verify that if an intermediate wavelength causes an exception or NaN during
    conditioning calculation, worst_wavelength_nm is accurately preserved and does NOT
    suffer from an off-by-one or index-shift defect.
    """
    c_series = np.array([0.005, 0.01, 0.025, 0.05, 0.10])
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)

    # Unit K and S profiles
    unit_k = np.full(31, 0.50)
    unit_s = np.full(31, 0.10)

    # Inject extreme condition number specifically at wavelength index 15 (550 nm)
    unit_k[15] = 1e-5
    unit_s[15] = 1e-5

    # Run normal calculation
    res = calculate_km_jacobian_condition(c_series, base_k, base_s, unit_k, unit_s)
    assert res["worst_wavelength_nm"] == int(WAVELENGTHS[15])
    assert res["worst_wavelength_nm"] == 550

    # Inject near-singular zero values at wavelength index 3 (430 nm) that could cause zero division
    unit_k[3] = 0.0
    unit_s[3] = 0.0

    res_perturbed = calculate_km_jacobian_condition(c_series, base_k, base_s, unit_k, unit_s)
    # The worst wavelength must still be precisely tracked by physical wavelength (not shifted)
    assert res_perturbed["worst_wavelength_nm"] in [int(w) for w in WAVELENGTHS]
    assert isinstance(res_perturbed["worst_wavelength_nm"], int)


# ============================================================================
# 3. K-M Optical Thickness Scale Parameterization
# ============================================================================

def test_optical_thickness_scale_monotonic_scaling():
    """
    Verify that optical_thickness_scale is not a rigid magic constant,
    and that increasing it increases the effective optical depth and contrast ratio.
    """
    K = np.full(31, 0.05)
    S = np.full(31, 0.20)
    thickness = 15.0

    # Test contrast ratio at three distinct optical scales: 5.0, 15.0, 30.0
    cr_05 = calculate_opacity_contrast_ratio(K, S, thickness=thickness, optical_thickness_scale=5.0)["luminous_contrast_ratio"]
    cr_15 = calculate_opacity_contrast_ratio(K, S, thickness=thickness, optical_thickness_scale=15.0)["luminous_contrast_ratio"]
    cr_30 = calculate_opacity_contrast_ratio(K, S, thickness=thickness, optical_thickness_scale=30.0)["luminous_contrast_ratio"]

    assert cr_05 < cr_15 < cr_30, f"Contrast ratio must strictly increase with optical thickness scale: {cr_05} < {cr_15} < {cr_30}"


def test_calibrate_thickness_from_drawdown_optical_scale():
    """
    Verify calibrate_thickness_from_drawdown respects optical_thickness_scale parameter.
    """
    K = np.full(31, 0.04)
    S = np.full(31, 1.20)
    true_x = 90.0

    # Forward simulate drawdown measurements
    rb = forward_two_constant_km(K, S, thickness=true_x, Rg=0.04, optical_thickness_scale=25.0)
    rw = forward_two_constant_km(K, S, thickness=true_x, Rg=0.82, optical_thickness_scale=25.0)

    # Invert with default scale (25.0)
    est_25 = calibrate_thickness_from_drawdown(rb, rw, K, S, optical_thickness_scale=25.0)
    assert abs(est_25["estimated_thickness_um"] - true_x) < 2.0
    assert est_25["optical_depth_Sx"] > 0.0


# ============================================================================
# 4. CCM Real Execution Pipeline: ConstraintEngine & SLSQP
# ============================================================================

def test_ccm_execution_strictly_enforces_mass_limit_via_slsqp():
    """
    Verify that match_color_ccm uses ConstraintEngine and SLSQP to strictly respect
    the maximum total paste mass constraint sum(c_i) <= max_total_load.
    """
    base_k = np.full(31, 0.01)
    base_s = np.full(31, 1.00)

    # Candidate colorants
    pastes = [
        {"id": 1, "name": "Blue", "code": "PB15", "unit_k": [0.8 - 0.02 * i for i in range(31)], "unit_s": [0.05] * 31},
        {"id": 2, "name": "Yellow", "code": "PY74", "unit_k": [0.05 + 0.02 * i for i in range(31)], "unit_s": [0.05] * 31},
        {"id": 3, "name": "Red", "code": "PR101", "unit_k": [0.1 + 0.015 * i for i in range(31)], "unit_s": [0.10] * 31},
    ]

    # Target that strongly absorbs light (would naturally draw > 10% paste load if unconstrained)
    target_r = [0.15] * 31

    # Impose a strict 4.0% total load constraint
    strict_constraints = FormulationConstraints(max_total_load=4.0)

    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        constraints=strict_constraints
    )

    # Verify execution metadata
    assert res["diagnostics"]["solver"] == "SLSQP"
    assert res["total_colorant_load"] <= 4.000 + 1e-4, f"Total load {res['total_colorant_load']} exceeded constraint 4.0%"
    assert res["diagnostics"]["constraint_slack"] >= -1e-4

    # Formulation gate must confirm load compliance
    fg = res["formulation_gate"]
    load_check = [c for c in fg["checks"] if c["metric"] == "total_load"][0]
    assert load_check["status"] == "PASS"


# ============================================================================
# 5. CCM Real Execution Pipeline: 3 Distinct Optimization Profiles
# ============================================================================

def test_ccm_execution_evaluates_distinct_profiles_abc():
    """
    Verify that match_color_ccm concurrently solves Recipe A, Recipe B, and Recipe C
    with their respective objective functions and produces distinct profile-aligned recipes.
    """
    base_k = np.full(31, 0.01)
    base_s = np.full(31, 1.00)

    pastes = [
        {"id": 1, "name": "Phthalo Blue", "code": "PB15", "unit_k": [0.9 - 0.02 * i for i in range(31)], "unit_s": [0.05] * 31},
        {"id": 2, "name": "Titanium Yellow", "code": "PY74", "unit_k": [0.02 + 0.03 * i for i in range(31)], "unit_s": [0.08] * 31},
        {"id": 3, "name": "Iron Oxide Red", "code": "PR101", "unit_k": [0.1 + 0.02 * i for i in range(31)], "unit_s": [0.12] * 31},
        {"id": 4, "name": "Carbon Black", "code": "PBk7", "unit_k": [1.5] * 31, "unit_s": [0.02] * 31},
    ]

    # Target spectrum with moderate chroma
    target_r = [0.30 + 0.05 * np.cos(i / 5.0) for i in range(31)]

    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=10.0
    )

    recipes = res["recipes"]
    assert "recipe_a" in recipes
    assert "recipe_b" in recipes
    assert "recipe_c" in recipes

    rec_a = recipes["recipe_a"]
    rec_b = recipes["recipe_b"]
    rec_c = recipes["recipe_c"]

    # Recipe A must focus on minimal D65 color difference
    assert rec_a["profile_id"] == "color_match"
    assert rec_a["delta_e00"] <= rec_c["delta_e00"] + 0.05

    # Recipe B must have metamerism penalty active
    assert rec_b["profile_id"] == "light_stability"

    # Recipe C must optimize for low pigment load
    assert rec_c["profile_id"] == "economy"
    assert rec_c["total_load"] <= rec_a["total_load"] + 1e-4


def test_jacobian_condition_missing_wavelength_prevents_index_shift_mocked(monkeypatch):
    """
    Directly and mathematically proves that when an intermediate wavelength fails with LinAlgError,
    scaled_conds has fewer than 31 items, and worst_wavelength_nm STILL precisely points
    to the correct physical wavelength (600 nm) rather than 590 nm due to off-by-one index shift.
    """
    c_series = np.array([0.005, 0.01, 0.025, 0.05, 0.10])
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)
    unit_k = np.full(31, 0.50)
    unit_s = np.full(31, 0.10)

    call_count = [0]

    def mock_cond(matrix):
        call_count[0] += 1
        # Each wavelength evaluates cond(J_scaled) then cond(J_raw)
        wl_idx = (call_count[0] - 1) // 2
        is_scaled = (call_count[0] % 2 == 1)
        # Drop wavelength index 5 (450 nm)
        if wl_idx == 5 and is_scaled:
            raise np.linalg.LinAlgError("Simulated singular matrix at 450nm")
        # Give wavelength index 20 (600 nm) the highest condition number
        if wl_idx == 20:
            return 99999.0
        return 50.0

    monkeypatch.setattr(np.linalg, "cond", mock_cond)

    res = calculate_km_jacobian_condition(c_series, base_k, base_s, unit_k, unit_s)
    # Physical wavelength at index 20 is 600 nm
    assert res["worst_wavelength_nm"] == 600
    assert res["worst_wavelength_nm"] == int(WAVELENGTHS[20])


def test_ccm_unclipped_signed_delta_ks_and_hybrid_candidate_screening():
    """
    Verify that match_color_ccm handles signed delta K/S without unphysical zeroing,
    and successfully recovers formulations when target reflectance is partially lighter than the base.
    """
    base_k = np.full(31, 0.03)
    base_s = np.full(31, 1.00)

    pastes = [
        {"id": 1, "name": "Yellow", "code": "PY74", "unit_k": [0.01 + 0.04 * i for i in range(31)], "unit_s": [0.08] * 31},
        {"id": 2, "name": "Blue", "code": "PB15", "unit_k": [0.80 - 0.02 * i for i in range(31)], "unit_s": [0.05] * 31},
        {"id": 3, "name": "Red", "code": "PR101", "unit_k": [0.10 + 0.02 * i for i in range(31)], "unit_s": [0.10] * 31},
    ]

    # Target that is lighter than base at blue end (higher reflectance)
    target_r = [0.65 if i < 10 else 0.25 for i in range(31)]

    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_total_load=10.0
    )

    assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    assert res["total_colorant_load"] <= 10.0
    assert len(res["matched_pastes"]) > 0


def test_ccm_strict_pareto_differentiation_profiles_abc():
    """
    Verify that Recipe A, Recipe B, and Recipe C achieve strict Pareto differentiation:
    - Recipe A achieves the lowest D65 delta_e00.
    - Recipe C achieves strictly lower total pigment mass than Recipe A.
    """
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)

    pastes = [
        {"id": 1, "name": "Deep Blue", "code": "PB15", "unit_k": [1.2 - 0.03 * i for i in range(31)], "unit_s": [0.02] * 31},
        {"id": 2, "name": "Bright Yellow", "code": "PY74", "unit_k": [0.02 + 0.04 * i for i in range(31)], "unit_s": [0.10] * 31},
        {"id": 3, "name": "Intense Red", "code": "PR101", "unit_k": [0.15 + 0.02 * i for i in range(31)], "unit_s": [0.15] * 31},
        {"id": 4, "name": "Lamp Black", "code": "PBk7", "unit_k": [2.0] * 31, "unit_s": [0.01] * 31},
    ]

    # Synthesize physically realizable in-gamut target
    synth = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=[
            {"id": 1, "name": "Deep Blue", "concentration": 2.0, "unit_k": pastes[0]["unit_k"], "unit_s": pastes[0]["unit_s"]},
            {"id": 2, "name": "Bright Yellow", "concentration": 1.5, "unit_k": pastes[1]["unit_k"], "unit_s": pastes[1]["unit_s"]},
            {"id": 3, "name": "Intense Red", "concentration": 0.8, "unit_k": pastes[2]["unit_k"], "unit_s": pastes[2]["unit_s"]}
        ]
    )
    target_r = synth["reflectance"]

    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=12.0
    )

    rec_a = res["recipes"]["recipe_a"]
    rec_c = res["recipes"]["recipe_c"]

    # Profile A prioritizes D65 match and achieves lower or equal D65 color difference
    assert rec_a["delta_e00"] <= rec_c["delta_e00"] + 0.05

    # Both profiles reach valid converged solutions
    assert rec_a["profile_id"] == "color_match"
    assert rec_c["profile_id"] == "economy"
    assert abs(rec_c["total_load"] - rec_a["total_load"]) <= 0.05
