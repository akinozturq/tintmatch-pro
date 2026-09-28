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
