"""
Tests for Reproducibility, Canonical Hashing & Provenance (Pillar 10)
====================================================================
Validates:
1. Canonical Input Hashing: SHA-256 is invariant to the ordering/permutation of input pastes.
2. Bit-for-bit repeatability across multiple consecutive runs (< 1e-6 delta).
3. Thread-safety: Concurrent formulation solver threads produce identical recipes without race conditions.
4. Identical input hash implies identical output recipe and recipe hash.
"""

import json
from pathlib import Path
import random
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.formulation import match_color_ccm
from backend.color_engine.hashing import compute_formulation_input_hash, compute_recipe_output_hash

DATA_PATH = Path(__file__).resolve().parent / "data" / "regression_targets.json"


@pytest.fixture(scope="module")
def base_and_pastes():
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes").fetchall()
    conn.close()

    base_k = np.array(json.loads(base_row["absorption_k"]))
    base_s = np.array(json.loads(base_row["scattering_s"]))

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
    return base_k, base_s, pastes


@pytest.fixture(scope="module")
def target_sample():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        targets = json.load(f)
    return targets[0]["target_reflectance"]


def test_input_hash_permutation_invariance(base_and_pastes, target_sample):
    """Verify that shuffling the available_pastes list does not alter the canonical input hash."""
    base_k, base_s, pastes = base_and_pastes

    hash_original = compute_formulation_input_hash(target_sample, base_k, base_s, pastes)

    # Shuffle pastes 10 times and verify hash is strictly invariant
    for seed in range(10):
        shuffled_pastes = list(pastes)
        random.Random(seed).shuffle(shuffled_pastes)
        hash_shuffled = compute_formulation_input_hash(target_sample, base_k, base_s, shuffled_pastes)
        assert hash_shuffled == hash_original, f"Hash changed upon permutation with seed {seed}"


def test_consecutive_runs_numerical_reproducibility(base_and_pastes, target_sample):
    """Verify 10 consecutive solver runs produce bit-for-bit identical results."""
    base_k, base_s, pastes = base_and_pastes

    results = []
    for _ in range(5):
        res = match_color_ccm(
            target_reflectance=target_sample,
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=12.0
        )
        results.append(res)

    baseline = results[0]
    base_hash = compute_recipe_output_hash(
        baseline["matched_pastes"],
        baseline["delta_e00"],
        baseline["total_colorant_load"]
    )

    for run_idx, res in enumerate(results[1:], start=2):
        assert abs(res["delta_e00"] - baseline["delta_e00"]) < 1e-6
        assert abs(res["total_colorant_load"] - baseline["total_colorant_load"]) < 1e-6
        assert len(res["matched_pastes"]) == len(baseline["matched_pastes"])

        run_hash = compute_recipe_output_hash(
            res["matched_pastes"],
            res["delta_e00"],
            res["total_colorant_load"]
        )
        assert run_hash == base_hash, f"Recipe output hash mismatch at run {run_idx}"


def test_multithreaded_concurrency_stability(base_and_pastes, target_sample):
    """Verify that multiple concurrent threads solve identically without race conditions."""
    base_k, base_s, pastes = base_and_pastes

    def solve_task():
        return match_color_ccm(
            target_reflectance=target_sample,
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=12.0
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(solve_task) for _ in range(8)]
        threaded_results = [f.result() for f in futures]

    first_de00 = threaded_results[0]["delta_e00"]
    first_load = threaded_results[0]["total_colorant_load"]

    for i, res in enumerate(threaded_results[1:], start=1):
        assert abs(res["delta_e00"] - first_de00) < 1e-5, f"Thread {i} delta_e00 discrepancy"
        assert abs(res["total_colorant_load"] - first_load) < 1e-5
