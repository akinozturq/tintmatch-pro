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
import numpy as np
from scipy.optimize import minimize

from ..constants import N_WAVELENGTHS
from ..formulation import (
    match_color_ccm,
    predict_recipe,
    evaluate_recipe_objective,
    PROFILE_COLOR_MATCH
)
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
    constraints_config = FormulationConstraints(max_total_load=max_total_load)
    engine = ConstraintEngine(constraints_config)
    candidate_keys = [str(available_pastes[idx].get("id", idx)) for idx in all_indices]

    # Cold uniform start
    x0 = [max_total_load / (2.0 * max(n_pastes, 1))] * n_pastes
    bounds = engine.build_scipy_bounds(candidate_keys, default_upper_bound=max_total_load)
    constraints = engine.build_scipy_constraints(candidate_keys)

    def full_objective(concs):
        return evaluate_recipe_objective(
            concs=concs,
            active_indices=all_indices,
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

    res = minimize(
        full_objective,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 300, "eps": 1e-3, "ftol": 1e-6}
    )

    opt_raw = np.maximum(res.x, 0.0)
    cleaned_opt, _ = engine.post_process_solution(opt_raw, candidate_keys)

    # Prune to top max_pastes
    paste_concs = {i: float(cleaned_opt[i]) for i in range(n_pastes) if cleaned_opt[i] >= 0.005}
    if len(paste_concs) > max_pastes:
        sorted_top = sorted(paste_concs.items(), key=lambda kv: kv[1], reverse=True)[:max_pastes]
        paste_concs = dict(sorted_top)

    # Polish pruned pastes to restore optimal concentrations
    sub_indices = list(paste_concs.keys())
    if sub_indices:
        sub_keys = [str(available_pastes[idx].get("id", idx)) for idx in sub_indices]
        sub_x0 = [paste_concs[idx] for idx in sub_indices]
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
            options={"maxiter": 100, "eps": 1e-3, "ftol": 1e-6}
        )
        if res_ref.success:
            for k, p_i in enumerate(sub_indices):
                paste_concs[p_i] = max(0.0, float(res_ref.x[k]))

    matched_pastes = []
    for p_idx, conc in paste_concs.items():
        p = available_pastes[p_idx]
        matched_pastes.append({
            "id": p["id"],
            "name": p["name"],
            "code": p.get("code", ""),
            "concentration": round(float(conc), 4),
            "unit_k": p.get("unit_k"),
            "unit_s": p.get("unit_s")
        })

    matched_pastes.sort(key=lambda x: x["concentration"], reverse=True)
    sim = predict_recipe(b_k, b_s, matched_pastes, k1=k1, k2=k2, target_reflectance=target_r.tolist())
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return {
        "method": "FULL_LIBRARY_SLSQP",
        "delta_e00": round(float(sim["comparison"]["delta_e00"]), 3) if "comparison" in sim else 99.0,
        "total_load": round(float(sim["total_colorant_load"]), 4),
        "matched_pastes": matched_pastes,
        "selected_paste_ids": [p["id"] for p in matched_pastes],
        "iterations": int(res.nit),
        "function_evals": int(res.nfev),
        "runtime_ms": round(elapsed_ms, 2),
        "success": bool(res.success)
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
