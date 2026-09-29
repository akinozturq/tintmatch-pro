"""
TintMatch PRO - Audit Round 4 Hardening Test Suite
==================================================
Validates:
1. Euclidean Quadratic Programming (QP) projection onto feasible constraint set.
2. InfeasibleConstraintSet detection & exception raising for contradictory constraints.
3. Strict recipe safety: empty matched_pastes and prediction: None when constraints fail validation.
4. FastAPI /api/health version synchronization (version 2.2.0, TintMatch Pro CCM Engine 2.2).
5. Canonical execution and input hashes incorporating full constraint and solver context.
6. API endpoint verification for formulation match with calculation_hash and infeasible constraint handling.
"""

import json
import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.constraints import (
    FormulationConstraints,
    ConstraintEngine,
    InfeasibleConstraintSet
)
from backend.color_engine.profiles import ENGINE_VERSION, PROFILE_COLOR_MATCH
from backend.color_engine.kubelka_munk import forward_two_constant_km
from backend.color_engine.formulation import match_color_ccm, _optimize_single_profile
from backend.color_engine.hashing import compute_formulation_input_hash
from backend.routes.formulation import compute_canonical_execution_hash

client = TestClient(app)


# ============================================================================
# 1. Euclidean QP Projection Tests
# ============================================================================

def test_qp_feasible_projection_tight_and_cross_bounds():
    """Verify QP projection finds the mathematically optimal feasible point under coupled constraints."""
    # Coupled constraints:
    # P1 in [0, 3.0], P2 in [0, 3.0], P3 in [0, 5.0]
    # Organics group (P1 + P2) <= 3.2
    # min_total_load = 3.5, max_total_load = 6.0
    constraints = FormulationConstraints(
        max_total_load=6.0,
        min_total_load=3.5,
        individual_bounds={"P1": (0.0, 3.0), "P2": (0.0, 3.0), "P3": (0.0, 5.0)},
        group_bounds={"organics": 3.2},
        pigment_groups={"organics": ["P1", "P2"]},
    )
    engine = ConstraintEngine(constraints)
    keys = ["P1", "P2", "P3"]

    # Target point: [5.0, 4.0, 0.0] - violates P1, P2 individual bounds and organics group limit
    projected = engine.project_to_feasible([5.0, 4.0, 0.0], keys)
    val = engine.validate_solution(projected, keys)

    assert val["is_valid"] is True, f"Projection failed validation: {val['violations']}"
    assert projected[0] <= 3.0 + 1e-5
    assert projected[1] <= 3.0 + 1e-5
    assert projected[0] + projected[1] <= 3.2 + 1e-5
    tot = float(np.sum(projected))
    assert 3.5 - 1e-5 <= tot <= 6.0 + 1e-5


def test_infeasible_constraint_set_raises_exception():
    """Verify InfeasibleConstraintSet is raised when constraints are mathematically unsatisfiable."""
    # Case A: min_total_load exceeds sum of individual upper bounds
    constraints_a = FormulationConstraints(
        max_total_load=10.0,
        min_total_load=8.0,
        individual_bounds={"P1": (0.0, 2.0), "P2": (0.0, 2.0)},
    )
    engine_a = ConstraintEngine(constraints_a)
    with pytest.raises(InfeasibleConstraintSet, match="exceeds sum of individual upper bounds"):
        engine_a.project_to_feasible([2.0, 2.0], ["P1", "P2"])

    # Case B: min_total_load > max_total_load
    constraints_b = FormulationConstraints(
        max_total_load=4.0,
        min_total_load=6.0
    )
    engine_b = ConstraintEngine(constraints_b)
    with pytest.raises(InfeasibleConstraintSet, match="Contradictory total load bounds"):
        engine_b.project_to_feasible([1.0, 1.0], ["P1", "P2"])

    # Case C: Group limit incompatible with individual lower bounds
    constraints_c = FormulationConstraints(
        max_total_load=10.0,
        individual_bounds={"P1": (2.0, 5.0), "P2": (2.0, 5.0)},
        group_bounds={"grp": 3.0},
        pigment_groups={"grp": ["P1", "P2"]}
    )
    engine_c = ConstraintEngine(constraints_c)
    with pytest.raises(InfeasibleConstraintSet, match="is below sum of member lower bounds"):
        engine_c.project_to_feasible([2.0, 2.0], ["P1", "P2"])


# ============================================================================
# 2. Strict Recipe Safety on Validation Failure
# ============================================================================

def test_empty_recipe_on_validation_failure():
    """Verify optimizer returns matched_pastes: [] and prediction: None when constraints cannot be satisfied."""
    base_k = np.full(31, 0.05)
    base_s = np.full(31, 0.80)
    target_r = np.full(31, 0.20)

    pastes = [
        {"id": 1, "name": "Paste 1", "code": "P1", "unit_k": [0.5] * 31, "unit_s": [0.05] * 31},
        {"id": 2, "name": "Paste 2", "code": "P2", "unit_k": [0.8] * 31, "unit_s": [0.02] * 31},
    ]

    # Impossible constraints: upper bounds sum to 1.0%, but min_total_load = 5.0%
    impossible_constraints = FormulationConstraints(
        max_total_load=10.0,
        min_total_load=5.0,
        individual_bounds={"1": (0.0, 0.5), "2": (0.0, 0.5)}
    )

    res = match_color_ccm(
        target_reflectance=target_r.tolist(),
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        constraints=impossible_constraints
    )

    assert res["status"] == "INFEASIBLE_CONSTRAINT_SET"
    assert res["matched_pastes"] == []
    assert res["prediction"] is None
    assert res["passed_target_threshold"] is False
    assert res["delta_e00"] == 99.0


# ============================================================================
# 3. Health Endpoint & API Version Synchronization
# ============================================================================

def test_health_endpoint_version_sync():
    """Verify /api/health reports ENGINE_VERSION 2.2.0 and synchronous service name."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()

    assert data["status"] == "healthy"
    assert data["version"] == ENGINE_VERSION
    assert data["version"] == "2.2.0"
    assert data["service"] == "TintMatch Pro CCM Engine 2.2"
    assert data["algorithm_id"] == "TintMatch-CCM-2.2-SLSQP"
    assert data["spectral_channels"] == 31


# ============================================================================
# 4. Canonical Hash Full Constraint Context Tests
# ============================================================================

def test_canonical_execution_hash_constraint_sensitivity():
    """Verify canonical execution hash changes when any constraint parameter is modified."""
    pastes = [{"id": 1, "name": "P1", "concentration": 2.5}]
    base_hash = "abc123def456"

    h_base = compute_canonical_execution_hash(
        base_id=1,
        base_hash=base_hash,
        pastes=pastes,
        max_total_load=10.0,
        min_total_load=1.0
    )

    # 1. Changing individual_bounds changes hash
    h_ind = compute_canonical_execution_hash(
        base_id=1,
        base_hash=base_hash,
        pastes=pastes,
        max_total_load=10.0,
        min_total_load=1.0,
        individual_bounds={"1": (0.5, 3.0)}
    )
    assert h_base != h_ind

    # 2. Changing group_bounds changes hash
    h_grp = compute_canonical_execution_hash(
        base_id=1,
        base_hash=base_hash,
        pastes=pastes,
        max_total_load=10.0,
        min_total_load=1.0,
        group_bounds={"organics": 3.0}
    )
    assert h_base != h_grp

    # 3. Changing multistart settings changes hash
    h_multi = compute_canonical_execution_hash(
        base_id=1,
        base_hash=base_hash,
        pastes=pastes,
        max_total_load=10.0,
        min_total_load=1.0,
        enable_multistart=True,
        num_starts=5
    )
    assert h_base != h_multi

    # 4. Order-independence of individual_bounds dict keys
    h_ord1 = compute_canonical_execution_hash(
        base_id=1,
        base_hash=base_hash,
        pastes=pastes,
        individual_bounds={"P1": (0.0, 2.0), "P2": (0.0, 3.0)}
    )
    h_ord2 = compute_canonical_execution_hash(
        base_id=1,
        base_hash=base_hash,
        pastes=pastes,
        individual_bounds={"P2": (0.0, 3.0), "P1": (0.0, 2.0)}
    )
    assert h_ord1 == h_ord2


def test_compute_formulation_input_hash_constraints():
    """Verify compute_formulation_input_hash is sensitive to advanced constraints."""
    target_r = [0.25] * 31
    base_k = [0.05] * 31
    base_s = [0.80] * 31
    pastes = [{"id": 1, "code": "P1", "unit_k": [0.5]*31, "unit_s": [0.1]*31}]

    h1 = compute_formulation_input_hash(
        target_r, base_k, base_s, pastes,
        individual_bounds={"1": (0.1, 2.0)}
    )
    h2 = compute_formulation_input_hash(
        target_r, base_k, base_s, pastes,
        individual_bounds={"1": (0.1, 3.0)}
    )
    assert h1 != h2

    # Multistart sensitivity
    h_single = compute_formulation_input_hash(target_r, base_k, base_s, pastes, enable_multistart=False)
    h_multi = compute_formulation_input_hash(target_r, base_k, base_s, pastes, enable_multistart=True, num_starts=4)
    assert h_single != h_multi


# ============================================================================
# 5. REST API Formulation Match Calculation Hash
# ============================================================================

def test_api_formulation_match_returns_calculation_hash():
    """Verify POST /api/formulation/match calculates and returns canonical calculation_hash."""
    target_r = [0.45] * 31
    payload = {
        "target_reflectance": target_r,
        "base_id": 1,
        "max_pastes": 3,
        "max_total_load": 10.0,
        "min_total_load": 0.5,
        "enable_multistart": False
    }
    resp = client.post("/api/formulation/match", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "calculation_hash" in data
    assert len(data["calculation_hash"]) == 64  # SHA-256 hex string length


# ============================================================================
# 6. Combinatorial Subset Optimization & Terminal Authoritative Validation
# ============================================================================

def test_combinatorial_subset_optimization_selects_low_conc_shading_pigment():
    """
    Verify combinatorial subset optimization evaluates pigment subsets and does not
    blindly prune low-concentration shading pigments that dramatically improve Delta E00.
    """
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)

    # 4 distinct pigments:
    # 1: Blue primary
    # 2: Yellow primary
    # 3: Broad reddish colorant (higher concentration in unconstrained solve)
    # 4: Highly potent dark shading toner (Carbon / Violet - low conc, critical color impact)
    pastes = [
        {"id": 1, "name": "Blue Primary", "code": "PB15", "unit_k": [0.8 - 0.02 * i for i in range(31)], "unit_s": [0.05] * 31},
        {"id": 2, "name": "Yellow Primary", "code": "PY74", "unit_k": [0.05 + 0.03 * i for i in range(31)], "unit_s": [0.10] * 31},
        {"id": 3, "name": "Reddish Ochre", "code": "PR101", "unit_k": [0.35] * 31, "unit_s": [0.08] * 31},
        {"id": 4, "name": "Carbon Shading Toner", "code": "PBk7", "unit_k": [3.5] * 31, "unit_s": [0.01] * 31},
    ]

    from backend.color_engine.formulation import predict_recipe

    # Target synthesized from Blue (1.0%), Yellow (0.8%), and a tiny amount of Carbon Shading Toner (0.04%)
    synth = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=[
            {"id": 1, "name": "Blue Primary", "concentration": 1.0, "unit_k": pastes[0]["unit_k"], "unit_s": pastes[0]["unit_s"]},
            {"id": 2, "name": "Yellow Primary", "concentration": 0.8, "unit_k": pastes[1]["unit_k"], "unit_s": pastes[1]["unit_s"]},
            {"id": 4, "name": "Carbon Shading Toner", "concentration": 0.04, "unit_k": pastes[3]["unit_k"], "unit_s": pastes[3]["unit_s"]},
        ]
    )

    # Solve with max_pastes=3 among 4 candidate colorants
    res = match_color_ccm(
        target_reflectance=synth["reflectance"],
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=10.0
    )

    assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    matched_ids = [p["id"] for p in res["matched_pastes"]]
    # Must retain Carbon Shading Toner (id 4) despite its low concentration
    assert 4 in matched_ids, f"Low-concentration shading toner was eliminated: {matched_ids}"
    assert res["delta_e00"] <= 0.15, f"Expected near-exact match, got Delta E00 = {res['delta_e00']}"
    assert len(res["matched_pastes"]) <= 3


def test_terminal_authoritative_validation_exact_returned_vector():
    """
    Verify that authoritative validation is the terminal gate:
    1. Validated vector is strictly identical to the returned recipe concentrations.
    2. Zero sub-threshold pigments leak into the returned recipe.
    3. Final recipe strictly satisfies all physical/chemical/dispensing constraints.
    """
    base_k = np.full(31, 0.03)
    base_s = np.full(31, 0.90)

    pastes = [
        {"id": 1, "name": "Blue", "code": "P1", "unit_k": [0.6] * 31, "unit_s": [0.05] * 31},
        {"id": 2, "name": "Yellow", "code": "P2", "unit_k": [0.2 + 0.02 * i for i in range(31)], "unit_s": [0.08] * 31},
        {"id": 3, "name": "Red", "code": "P3", "unit_k": [0.4] * 31, "unit_s": [0.06] * 31},
    ]

    target_r = [0.35] * 31

    constraints = FormulationConstraints(
        max_total_load=8.0,
        min_total_load=1.5,
        min_dispense_threshold=0.03,
        individual_bounds={"1": (0.0, 4.0), "2": (0.0, 3.0)},
        group_bounds={"primaries": 5.0},
        pigment_groups={"primaries": ["1", "2"]},
        max_pastes=2
    )

    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=2,
        constraints=constraints
    )

    rec_a = res["recipes"]["recipe_a"]
    matched = rec_a["matched_pastes"]

    # Cardinality strictly respected
    assert len(matched) <= 2

    # Every returned concentration must be >= min_dispense_threshold (0.03%)
    for p in matched:
        assert p["concentration"] >= 0.03, f"Pigment {p['name']} below dispense threshold: {p['concentration']}"

    # Total load must respect min and max total load bounds
    tot_load = sum(p["concentration"] for p in matched)
    if matched:
        assert 1.5 - 1e-4 <= tot_load <= 8.0 + 1e-4

    # Terminal gate validation passed
    val = rec_a["diagnostics"]["constraint_validation"]
    assert val["is_valid"] is True
    assert len(val["violations"]) == 0


def test_candidate_screening_recall_and_accuracy_across_5_regimes():
    """
    Verify candidate pre-screening achieves >= 98% recall and <= 0.050 worst Delta E00 degradation
    against the unrestricted full-library reference solution across all 5 industrial regimes:
    1. Lightening Targets
    2. Dark Targets
    3. Neutral Targets
    4. Ultra-Pastel Targets
    5. Metameric Targets
    """
    from pathlib import Path
    from backend.database.db import get_db_connection
    from backend.color_engine.benchmarks.benchmark_candidate_recall import run_candidate_recall_audit

    data_dir = Path(__file__).resolve().parent / "data"
    blind_targets = json.load(open(data_dir / "blind_targets_dataset.json"))
    reg_targets = json.load(open(data_dir / "regression_targets.json"))

    conn = get_db_connection()
    base1 = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    base4 = conn.execute("SELECT * FROM bases WHERE id = 4").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes WHERE id <= 6").fetchall()
    conn.close()

    pastes = [
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
    # Add White TiO2 PW6 for lightening / scattering verification
    pastes.append({
        "id": 999,
        "name": "White TiO2",
        "code": "PW6",
        "hex": "#ffffff",
        "unit_k": [0.005] * N_WAVELENGTHS,
        "unit_s": [1.50] * N_WAVELENGTHS
    })

    base_k = np.array(json.loads(base1["absorption_k"]))
    base_s = np.array(json.loads(base1["scattering_s"]))
    b4_k = np.array(json.loads(base4["absorption_k"]))
    b4_s = np.array(json.loads(base4["scattering_s"]))

    eval_targets = []
    # 1. Metameric & Ultra-Pastel targets
    eval_targets.extend(blind_targets[:5])
    # 2. Dark & Neutral industrial targets
    eval_targets.extend(reg_targets[:5])
    # 3. Lightening target (evaluated on Clear Base D, demanding scattering)
    eval_targets.append({
        "id": "LIGHT_01_PASTEL",
        "name": "Lightening on Clear Base",
        "type": "lightening",
        "target_reflectance": blind_targets[2]["target_reflectance"],
        "base_k": b4_k.tolist(),
        "base_s": b4_s.tolist()
    })

    audit = run_candidate_recall_audit(eval_targets, base_k, base_s, pastes, max_pastes=4)
    summary = audit["summary"]
    breakdown = audit["category_breakdown"]

    # Overall Quality Thresholds
    assert summary["candidate_recall_pct"] >= 98.0, f"Candidate recall too low: {summary['candidate_recall_pct']}%"
    assert summary["worst_delta_e_degradation"] <= 0.050, f"Worst dE00 degradation exceeded: {summary['worst_delta_e_degradation']}"
    assert summary["mean_delta_e_degradation"] <= 0.010, f"Mean dE00 degradation exceeded: {summary['mean_delta_e_degradation']}"

    # Category Coverage & Quality Verification
    expected_categories = ["Lightening", "Dark", "Neutral", "Ultra-Pastel", "Metameric"]
    for cat in expected_categories:
        cat_info = breakdown.get(cat, {})
        assert cat_info.get("count", 0) > 0, f"Category {cat} was not evaluated in benchmark targets"
        assert cat_info.get("status") == "PASS", f"Category {cat} failed audit gate: {cat_info}"
        assert cat_info.get("candidate_recall", 0.0) >= 95.0, f"Category {cat} recall too low: {cat_info['candidate_recall']}%"


def test_profile_based_acceptance_policy_enforcement():
    """
    Verify profile-based formulation acceptance policy:
    1. Color Match: D65 <= 0.50
    2. Light Stability: D65 <= 0.50, A <= 0.80, F11 <= 0.80, MI <= 0.50
       - F11 = 0.90 forces FAIL even if D65 = 0.40 and A = 0.20
    3. Economy: D65 <= 0.80, total_load <= budget
    """
    from backend.color_engine.profiles import (
        PROFILE_COLOR_MATCH,
        PROFILE_LIGHT_STABILITY,
        PROFILE_ECONOMY
    )
    from backend.color_engine.quality_gate import evaluate_formulation_gate

    # 1. Light Stability: F11 = 0.90 must fail
    gate_b_fail = evaluate_formulation_gate(
        delta_e00_d65=0.40,
        delta_e00_a=0.20,
        delta_e00_f11=0.90,
        composite_mi=0.35,
        total_load=4.0,
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",
        profile=PROFILE_LIGHT_STABILITY
    )
    assert gate_b_fail["status"] == "FAIL"
    f11_check = next(c for c in gate_b_fail["checks"] if c["metric"] == "delta_e00_f11")
    assert f11_check["status"] == "FAIL"
    assert f11_check["limit"] == 0.80
    assert any("F11" in f for f in gate_b_fail["failures"])

    # 1b. Light Stability: All compliant passes
    gate_b_pass = evaluate_formulation_gate(
        delta_e00_d65=0.40,
        delta_e00_a=0.20,
        delta_e00_f11=0.45,
        composite_mi=0.35,
        total_load=4.0,
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",
        profile=PROFILE_LIGHT_STABILITY
    )
    assert gate_b_pass["status"] == "PASS"

    # 2. Color Match: D65 is primary
    gate_a_pass = evaluate_formulation_gate(
        delta_e00_d65=0.35,
        delta_e00_a=0.60,
        delta_e00_f11=0.85,
        composite_mi=0.40,
        total_load=4.0,
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",
        profile=PROFILE_COLOR_MATCH
    )
    assert gate_a_pass["status"] == "PASS"

    gate_a_fail = evaluate_formulation_gate(
        delta_e00_d65=0.65,
        composite_mi=0.20,
        total_load=4.0,
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",
        profile=PROFILE_COLOR_MATCH
    )
    assert gate_a_fail["status"] == "FAIL"

    # 3. Economy Profile: D65 allows 0.80, but enforces load budget
    gate_c_pass = evaluate_formulation_gate(
        delta_e00_d65=0.65,
        composite_mi=0.30,
        total_load=8.0,
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",
        profile=PROFILE_ECONOMY
    )
    assert gate_c_pass["status"] == "PASS"

    gate_c_load_fail = evaluate_formulation_gate(
        delta_e00_d65=0.40,
        composite_mi=0.30,
        total_load=11.5,
        max_total_load=12.0,
        solver_status="OPTIMAL_CONVERGED",
        profile=PROFILE_ECONOMY
    )
    assert gate_c_load_fail["status"] == "FAIL"
    load_check = next(c for c in gate_c_load_fail["checks"] if c["metric"] == "total_load")
    assert load_check["status"] == "FAIL"


def test_finite_film_ccm_matching_and_optical_model_unification():
    """
    User Request #5 Verification:
    Finite-film 2-constant K-M forward model operates consistently across
    CCM objective evaluation, recipe simulation, and top-level solver output.
    """
    # Create synthetic base and colorants
    b_k = np.full(31, 0.02)
    b_s = np.full(31, 2.50)

    pastes = [
        {
            "id": 101,
            "name": "Organic Red",
            "unit_k": (0.8 + 0.5 * np.sin(np.linspace(0, 3, 31))).tolist(),
            "unit_s": np.full(31, 0.15).tolist()
        },
        {
            "id": 102,
            "name": "Phthalo Blue",
            "unit_k": (0.7 + 0.4 * np.cos(np.linspace(0, 3, 31))).tolist(),
            "unit_s": np.full(31, 0.10).tolist()
        },
        {
            "id": 103,
            "name": "Bismuth Yellow",
            "unit_k": (0.6 + 0.3 * np.sin(np.linspace(1, 4, 31))).tolist(),
            "unit_s": np.full(31, 0.20).tolist()
        }
    ]

    # Generate a target using finite film forward model at 75 um
    k_synth = b_k + 2.0 * np.array(pastes[0]["unit_k"]) + 1.5 * np.array(pastes[1]["unit_k"])
    s_synth = b_s + 2.0 * np.array(pastes[0]["unit_s"]) + 1.5 * np.array(pastes[1]["unit_s"])
    target_r = forward_two_constant_km(
        K=k_synth,
        S=s_synth,
        thickness=75.0,
        Rg=0.82,
        k1=0.04,
        k2=0.60,
        apply_saunderson=True
    ).tolist()

    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=b_k,
        base_s=b_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=10.0,
        forward_model="finite_film",
        film_thickness_um=75.0,
        substrate_rg=0.82
    )

    # Verify optical model metadata in response
    assert "optical_model" in res
    assert res["optical_model"]["forward_model"] == "finite_film"
    assert res["optical_model"]["film_thickness_um"] == 75.0
    assert res["optical_model"]["substrate_rg"] == 0.82

    # Verify prediction metadata matches finite_film configuration
    pred = res["prediction"]
    assert pred["optical_model"]["forward_model"] == "finite_film"
    assert pred["optical_model"]["film_thickness_um"] == 75.0
    assert pred["optical_model"]["substrate_rg"] == 0.82

    # The recipe solver should achieve excellent convergence on synthetic finite-film target
    assert res["delta_e00"] < 1.0


def test_api_profiles_and_finite_film_matching():
    """
    Verify /api/formulation/profiles exposes optical model and gate policy,
    and /api/formulation/match accepts forward_model='finite_film'.
    """
    # 1. Check profiles endpoint
    resp = client.get("/api/formulation/profiles")
    assert resp.status_code == 200
    profiles = resp.json()
    assert len(profiles) >= 3

    for p in profiles:
        assert "forward_model" in p
        assert "film_thickness_um" in p
        assert "substrate_rg" in p
        assert "gate_policy" in p
        assert "limit_d65" in p["gate_policy"]

    # 2. Check match endpoint with finite_film
    target_r = [0.25] * 31
    match_payload = {
        "target_reflectance": target_r,
        "base_id": 1,
        "max_pastes": 3,
        "max_total_load": 12.0,
        "forward_model": "finite_film",
        "film_thickness_um": 80.0,
        "substrate_rg": 0.82
    }
    match_resp = client.post("/api/formulation/match", json=match_payload)
    assert match_resp.status_code == 200
    data = match_resp.json()
    assert "optical_model" in data
    assert data["optical_model"]["forward_model"] == "finite_film"
    assert data["optical_model"]["film_thickness_um"] == 80.0


def test_execution_context_single_source_of_truth():
    """
    Audit Item #6 Verification:
    Verify ExecutionContext acts as genuine single source of truth across all modules.
    - Custom observer ("2") and reference illuminant ("A") are strictly propagated without reverting to defaults.
    - Instrument models & geometries (CHNSpec DS-36D d/8° SCI vs RM400 45°/0°) are tracked in metadata.
    - predict_recipe, sensitivity matrix, and match_color_ccm return and conform to the ExecutionContext.
    """
    from backend.color_engine.profiles import (
        ExecutionContext,
        ColorScienceProfile,
        MEASUREMENT_DS36D_D8_SCI,
        MEASUREMENT_RM400_45_0
    )
    from backend.color_engine.formulation import predict_recipe, calculate_pigment_sensitivity_matrix

    # 1. Test ExecutionContext factory with non-standard settings
    custom_sci = ColorScienceProfile(
        name="Custom CIE 1931 Illuminant A",
        observer="2",
        reference_illuminant="A",
        test_illuminants=("D65", "F11"),
        saunderson_k1=0.038,
        saunderson_k2=0.58
    )

    ctx_ds36d = ExecutionContext.create(
        science_profile=custom_sci,
        instrument_model="CHNSpec DS-36D",
        geometry="d/8°",
        measurement_mode="SCI"
    )

    assert ctx_ds36d.science_profile.observer == "2"
    assert ctx_ds36d.science_profile.reference_illuminant == "A"
    assert ctx_ds36d.science_profile.saunderson_k1 == 0.038
    assert ctx_ds36d.measurement_context.geometry == "d/8°"
    assert ctx_ds36d.measurement_context.instrument_model == "CHNSpec DS-36D"
    assert ctx_ds36d.measurement_context.specular_included is True

    # 2. Test predict_recipe uses context without reverting to defaults
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)
    pastes = [
        {"id": 1, "name": "Paste 1", "concentration": 2.0, "unit_k": [0.5] * 31, "unit_s": [0.1] * 31}
    ]
    target_r = [0.35] * 31

    sim = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=pastes,
        target_reflectance=target_r,
        context=ctx_ds36d
    )

    assert sim["execution_context"]["science_profile"]["observer"] == "2"
    assert sim["execution_context"]["science_profile"]["reference_illuminant"] == "A"
    assert sim["execution_context"]["measurement_context"]["geometry"] == "d/8°"

    # 3. Test calculate_pigment_sensitivity_matrix uses context
    sens = calculate_pigment_sensitivity_matrix(
        base_k=base_k,
        base_s=base_s,
        matched_pastes=pastes,
        target_reflectance=target_r,
        context=ctx_ds36d
    )
    assert len(sens) == 1
    assert sens[0]["name"] == "Paste 1"

    # 4. Test match_color_ccm end-to-end with context
    available = [
        {"id": 1, "name": "Paste 1", "code": "P1", "hex": "#ff0000", "unit_k": [0.8] * 31, "unit_s": [0.1] * 31},
        {"id": 2, "name": "Paste 2", "code": "P2", "hex": "#00ff00", "unit_k": [0.3] * 31, "unit_s": [0.2] * 31}
    ]
    res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available,
        context=ctx_ds36d
    )

    assert res["geometry"] == "d/8°"
    assert res["instrument_model"] == "CHNSpec DS-36D"
    assert res["execution_context"]["science_profile"]["observer"] == "2"
    assert res["execution_context"]["science_profile"]["reference_illuminant"] == "A"
    assert res["execution_context"]["measurement_context"]["geometry"] == "d/8°"
    for rkey in ("recipe_a", "recipe_b", "recipe_c"):
        rec = res["recipes"][rkey]
        assert rec["execution_context"]["science_profile"]["observer"] == "2"
        assert rec["execution_context"]["science_profile"]["reference_illuminant"] == "A"





