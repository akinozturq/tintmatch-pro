"""
NNLS Candidate-Screening Ablation Study Harness (Pillar 2)
==========================================================
Systematic ablation of candidate colorant screening heuristics and pool size K:
1. Screening Heuristic:
   - NNLS in K/S ratio space: min ||A c - Delta(K/S)||_2^2 (Production TintMatch PRO)
   - Spectral Correlation (Dot Product): score_i = A_i^T Delta(K/S)
   - Greedy Forward Selection
2. Candidate Pool Size K:
   - K in [2, 3, 4, 5, 6, 8, All]

Evaluates the accuracy vs. computational cost Pareto frontier.
"""

import time
import numpy as np
from scipy.optimize import nnls

from ..constants import N_WAVELENGTHS
from ..formulation import (
    _optimize_single_profile,
    PROFILE_COLOR_MATCH,
    reflectance_to_ks,
    saunderson_correction,
    reflectance_to_lab
)
from ..constraints import FormulationConstraints


def screen_candidates(
    delta_ks: np.ndarray,
    A: np.ndarray,
    n_pastes: int,
    method: str = "nnls",
    pool_size: int = 5
) -> list[int]:
    """
    Selects top candidate colorant indices using the chosen heuristic.
    """
    if method == "nnls":
        sol, _ = nnls(A, delta_ks)
        sorted_indices = [idx for idx in np.argsort(sol)[::-1] if sol[idx] > 0.001]
        if len(sorted_indices) < pool_size:
            corr_scores = [float(np.dot(A[:, i], delta_ks)) for i in range(n_pastes)]
            fallback = list(np.argsort(corr_scores)[::-1])
            for idx in fallback:
                if idx not in sorted_indices:
                    sorted_indices.append(idx)
        return sorted_indices[:min(pool_size, n_pastes)]

    elif method == "correlation":
        corr_scores = [float(np.dot(A[:, i], delta_ks)) for i in range(n_pastes)]
        sorted_indices = list(np.argsort(corr_scores)[::-1])
        return sorted_indices[:min(pool_size, n_pastes)]

    elif method == "greedy":
        # Stepwise forward residual reduction
        selected = []
        res = delta_ks.copy()
        for _ in range(min(pool_size, n_pastes)):
            best_idx = None
            best_score = -1.0
            for i in range(n_pastes):
                if i not in selected:
                    score = float(np.dot(A[:, i], res))
                    if score > best_score:
                        best_score = score
                        best_idx = i
            if best_idx is not None and best_score > 0:
                selected.append(best_idx)
                # Approximate projection update
                scale = float(np.dot(A[:, best_idx], res) / max(np.dot(A[:, best_idx], A[:, best_idx]), 1e-6))
                res = np.maximum(res - scale * A[:, best_idx], 0.0)
            else:
                break
        return selected

    else:
        raise ValueError(f"Unknown screening method: {method}")


def evaluate_screening_configuration(
    target_reflectance: list[float] | np.ndarray,
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    available_pastes: list[dict],
    method: str = "nnls",
    pool_size: int = 5,
    max_pastes: int = 3,
    max_total_load: float = 10.0
) -> dict:
    """
    Evaluates a single screening method and pool size combination through SLSQP.
    """
    t0 = time.perf_counter()
    n_pastes = len(available_pastes)
    b_k = np.asarray(base_k, dtype=float)
    b_s = np.asarray(base_s, dtype=float)
    target_r = np.asarray(target_reflectance, dtype=float)

    target_r_int = saunderson_correction(target_r)
    target_ks = reflectance_to_ks(target_r_int)
    base_ks = b_k / np.maximum(b_s, 1e-6)
    delta_ks = np.maximum(target_ks - base_ks, 0.0)

    A = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    paste_k_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    paste_s_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)

    for idx, p in enumerate(available_pastes):
        uk = np.asarray(p.get("unit_k", np.zeros(N_WAVELENGTHS)), dtype=float)
        us = np.asarray(p.get("unit_s", np.zeros(N_WAVELENGTHS)), dtype=float)
        paste_k_matrix[:, idx] = uk
        paste_s_matrix[:, idx] = us
        A[:, idx] = uk / np.maximum(b_s, 1e-6)

    sol_init, _ = nnls(A, delta_ks)
    candidates = screen_candidates(delta_ks, A, n_pastes, method=method, pool_size=pool_size)

    target_lab_d65 = reflectance_to_lab(target_r, illuminant="D65", observer="10")
    target_lab_a = reflectance_to_lab(target_r, illuminant="A", observer="10")
    target_lab_f11 = reflectance_to_lab(target_r, illuminant="F11", observer="10")

    res = _optimize_single_profile(
        profile=PROFILE_COLOR_MATCH,
        target_r=target_r,
        target_lab_d65=target_lab_d65,
        target_lab_a=target_lab_a,
        target_lab_f11=target_lab_f11,
        base_k=b_k,
        base_s=b_s,
        candidate_indices=candidates,
        available_pastes=available_pastes,
        paste_k_matrix=paste_k_matrix,
        paste_s_matrix=paste_s_matrix,
        initial_sol=sol_init,
        max_pastes=max_pastes,
        max_total_load=max_total_load,
        k1=0.04,
        k2=0.60
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return {
        "method": method,
        "pool_size": pool_size,
        "candidate_indices": candidates,
        "delta_e00": res["delta_e00"],
        "total_load": res["total_load"],
        "matched_pastes_count": len(res["matched_pastes"]),
        "runtime_ms": round(elapsed_ms, 2)
    }
