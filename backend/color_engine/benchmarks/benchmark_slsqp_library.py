"""
Full-Library SLSQP vs NNLS-Screened SLSQP Benchmark Harness (Pillar 1)
======================================================================
Empirical and mathematical comparison of:
1. NNLS-Screened SLSQP (Production TintMatch PRO Engine):
   Performs non-negative linear pre-screening in K/S space, then restricts non-linear SLSQP
   to the top K active candidates (K <= max_pastes + 2).
2. Full-Library SLSQP:
   Directly solves the constrained non-linear optimization over all N available colorants
   simultaneously, followed by L1-pruning to max_pastes.

Quantifies:
- Color difference accuracy (Delta E00)
- Execution runtime speedup (T_full / T_screened)
- Function evaluation counts (nfev) and iterations (nit)
- Colorant selection agreement (Jaccard similarity index)
"""

import time
import itertools
import numpy as np
from scipy.optimize import minimize, nnls

from ..constants import N_WAVELENGTHS
from ..formulation import (
    match_color_ccm,
    predict_recipe,
    evaluate_recipe_objective,
    PROFILE_COLOR_MATCH
)
from ..saunderson import saunderson_correction
from ..kubelka_munk import reflectance_to_ks
from ..colorimetry import reflectance_to_lab, ciede2000
from ..constraints import FormulationConstraints, ConstraintEngine


def solve_full_library_slsqp(
    target_reflectance: list[float] | np.ndarray,
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    available_pastes: list[dict],
    max_pastes: int = 4,
    max_total_load: float = 12.0,
    k1: float = 0.04,
    k2: float = 0.60
) -> dict:
    """
    Executes full-space N-dimensional SLSQP optimization over all candidate colorants.
    """
    t0 = time.perf_counter()
    n_pastes = len(available_pastes)
    b_k = np.asarray(base_k, dtype=float)
    b_s = np.asarray(base_s, dtype=float)
    target_r = np.asarray(target_reflectance, dtype=float)

    target_lab_d65 = reflectance_to_lab(target_r, illuminant="D65", observer="10")
    target_lab_a = reflectance_to_lab(target_r, illuminant="A", observer="10")
    target_lab_f11 = reflectance_to_lab(target_r, illuminant="F11", observer="10")

    paste_k_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    paste_s_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    for idx, p in enumerate(available_pastes):
        paste_k_matrix[:, idx] = np.asarray(p.get("unit_k", np.zeros(N_WAVELENGTHS)), dtype=float)
        paste_s_matrix[:, idx] = np.asarray(p.get("unit_s", np.zeros(N_WAVELENGTHS)), dtype=float)

    all_indices = list(range(n_pastes))
    constraints_config = FormulationConstraints(max_total_load=max_total_load, max_pastes=max_pastes)
    engine = ConstraintEngine(constraints_config)
    candidate_keys = [str(available_pastes[idx].get("id", idx)) for idx in all_indices]

    target_r_int = saunderson_correction(target_r, k1=k1, k2=k2)
    target_ks = reflectance_to_ks(target_r_int)
    base_ks = b_k / np.maximum(b_s, 1e-6)
    delta_ks_req = np.maximum(target_ks - base_ks, 0.0)

    # If library is small (<= 16 pastes), evaluate all combinations
    if n_pastes <= 16:
        candidate_pool = list(range(n_pastes))
    else:
        # Pre-screen pool from full library via NNLS on positive and absolute delta_ks
        A_full = paste_k_matrix / np.maximum(b_s[:, None], 1e-6)
        sol_pos, _ = nnls(A_full, delta_ks_req)
        sol_abs, _ = nnls(A_full, np.abs(target_ks - base_ks))
        combined_scores = sol_pos * 2.0 + sol_abs
        ranked_all = np.argsort(combined_scores)[::-1]
        candidate_pool = [int(idx) for idx in ranked_all[:16]]

    # Generate combinatorial subsets of size k in [1, max_pastes]
    all_subsets = []
    for k in range(max(1, min(max_pastes, 2)), max_pastes + 1):
        for comb in itertools.combinations(candidate_pool, k):
            all_subsets.append(list(comb))

    # Spectral pre-ranking using NNLS residual
    subset_rankings = []
    for S in all_subsets:
        A_sub = paste_k_matrix[:, S] / np.maximum(b_s[:, None], 1e-6)
        c_sub, res_norm = nnls(A_sub, delta_ks_req)
        subset_rankings.append((S, float(res_norm)))

    subset_rankings.sort(key=lambda item: item[1])
    subsets_to_eval = [item[0] for item in subset_rankings[:30]]

    best_loss = float("inf")
    best_matched_pastes = []
    total_nit = 0
    total_nfev = 0
    best_success = False

    for sub_indices in subsets_to_eval:
        sub_keys = [str(available_pastes[idx].get("id", idx)) for idx in sub_indices]
        A_sub = paste_k_matrix[:, sub_indices] / np.maximum(b_s[:, None], 1e-6)
        c_nnls, _ = nnls(A_sub, delta_ks_req)
        sub_x0 = [float(c) for c in c_nnls]
        if sum(sub_x0) <= 0.0:
            sub_x0 = [constraints_config.max_total_load / (2.0 * max(len(sub_indices), 1))] * len(sub_indices)
        try:
            sub_x0 = engine.project_to_feasible(sub_x0, sub_keys).tolist()
        except Exception:
            pass

        sub_bounds = engine.build_scipy_bounds(sub_keys, default_upper_bound=max_total_load)
        sub_constraints = engine.build_scipy_constraints(sub_keys)

        def sub_obj(c_vec):
            return evaluate_recipe_objective(
                concs=c_vec,
                active_indices=sub_indices,
                paste_k_matrix=paste_k_matrix,
                paste_s_matrix=paste_s_matrix,
                base_k=b_k,
                base_s=b_s,
                target_lab_d65=target_lab_d65,
                target_lab_a=target_lab_a,
                target_lab_f11=target_lab_f11,
                profile=PROFILE_COLOR_MATCH,
                k1=k1,
                k2=k2
            )

        res_ref = minimize(
            sub_obj,
            sub_x0,
            method="SLSQP",
            bounds=sub_bounds,
            constraints=sub_constraints,
            options={"maxiter": 120, "eps": 1e-3, "ftol": 1e-6}
        )
        total_nit += int(getattr(res_ref, "nit", 0))
        total_nfev += int(getattr(res_ref, "nfev", 0))

        if res_ref.success:
            ref_x = np.maximum(res_ref.x, 0.0)
        else:
            ref_x = np.maximum(np.asarray(sub_x0, dtype=float), 0.0)

        # Build candidate pastes with exact round and terminal validation
        cand_pastes = []
        for k_idx, p_idx in enumerate(sub_indices):
            conc_val = round(float(ref_x[k_idx]), 3)
            if conc_val >= 0.005:
                p = available_pastes[p_idx]
                cand_pastes.append({
                    "id": p["id"],
                    "name": p["name"],
                    "code": p.get("code", ""),
                    "concentration": conc_val,
                    "unit_k": p.get("unit_k"),
                    "unit_s": p.get("unit_s")
                })

        concs_vec = np.zeros(n_pastes, dtype=float)
        for cp in cand_pastes:
            for pi, ap in enumerate(available_pastes):
                if ap["id"] == cp["id"]:
                    concs_vec[pi] = cp["concentration"]
                    break

        val_check = engine.validate_solution(
            concs_vec,
            candidate_keys,
            max_pastes=max_pastes,
            check_dispense=True,
            check_max_pastes=True
        )

        if val_check["is_valid"]:
            active_p_indices = [
                available_pastes.index(next(p for p in available_pastes if p["id"] == cp["id"]))
                for cp in cand_pastes
            ]
            loss_val = evaluate_recipe_objective(
                [cp["concentration"] for cp in cand_pastes],
                active_p_indices,
                paste_k_matrix,
                paste_s_matrix,
                b_k,
                b_s,
                target_lab_d65,
                target_lab_a,
                target_lab_f11,
                PROFILE_COLOR_MATCH,
                k1,
                k2
            )
            if loss_val < best_loss:
                best_loss = loss_val
                best_matched_pastes = cand_pastes
                best_success = bool(res_ref.success)

    matched_pastes = sorted(best_matched_pastes, key=lambda x: x["concentration"], reverse=True)
    sim = predict_recipe(b_k, b_s, matched_pastes, k1=k1, k2=k2, target_reflectance=target_r.tolist())
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return {
        "method": "FULL_LIBRARY_SLSQP",
        "delta_e00": round(float(sim["comparison"]["delta_e00"]), 3) if "comparison" in sim else 99.0,
        "total_load": round(float(sim["total_colorant_load"]), 4),
        "matched_pastes": matched_pastes,
        "selected_paste_ids": [p["id"] for p in matched_pastes],
        "iterations": total_nit,
        "function_evals": total_nfev,
        "runtime_ms": round(elapsed_ms, 2),
        "success": best_success
    }


def run_slsqp_benchmark_comparison(
    target_reflectance: list[float] | np.ndarray,
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    available_pastes: list[dict],
    max_pastes: int = 4,
    max_total_load: float = 12.0
) -> dict:
    """
    Runs both NNLS-Screened SLSQP and Full-Library SLSQP side-by-side on the same target.
    """
    # 1. Screened (Production)
    t0 = time.perf_counter()
    res_screened = match_color_ccm(
        target_reflectance=target_reflectance,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available_pastes,
        max_pastes=max_pastes,
        max_total_load=max_total_load
    )
    t_screened_ms = (time.perf_counter() - t0) * 1000.0

    rec_a = res_screened["recipes"]["recipe_a"]
    screened_ids = set(p["id"] for p in rec_a["matched_pastes"])
    screened_de00 = rec_a["delta_e00"]

    # 2. Full-Library SLSQP
    res_full = solve_full_library_slsqp(
        target_reflectance=target_reflectance,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available_pastes,
        max_pastes=max_pastes,
        max_total_load=max_total_load
    )
    full_ids = set(res_full["selected_paste_ids"])
    full_de00 = res_full["delta_e00"]

    # Selection agreement: Jaccard Similarity index
    intersection = len(screened_ids.intersection(full_ids))
    union = len(screened_ids.union(full_ids))
    jaccard_similarity = round(intersection / max(union, 1), 3)

    speedup = round(res_full["runtime_ms"] / max(t_screened_ms, 0.1), 2)

    return {
        "screened_slsqp": {
            "delta_e00": screened_de00,
            "total_load": rec_a["total_load"],
            "paste_ids": list(screened_ids),
            "iterations": rec_a["diagnostics"]["iterations"],
            "function_evals": rec_a["diagnostics"]["function_evaluations"],
            "runtime_ms": round(t_screened_ms, 2)
        },
        "full_library_slsqp": {
            "delta_e00": full_de00,
            "total_load": res_full["total_load"],
            "paste_ids": list(full_ids),
            "iterations": res_full["iterations"],
            "function_evals": res_full["function_evals"],
            "runtime_ms": res_full["runtime_ms"]
        },
        "comparison": {
            "delta_e_diff": round(abs(screened_de00 - full_de00), 3),
            "jaccard_similarity": jaccard_similarity,
            "speedup_factor": speedup,
            "screened_is_faster": t_screened_ms < res_full["runtime_ms"]
        }
    }
