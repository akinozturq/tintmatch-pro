"""
Multi-Start SLSQP Optimization Benchmark Harness (Pillar 3)
===========================================================
Empirical evaluation of multi-start initialization in non-convex CIEDE2000 space.
Compares:
1. Single-Start SLSQP (NNLS initialization).
2. Multi-Start SLSQP (NNLS + Uniform + Perturbed initial conditions).

Measures accuracy gains, objective loss reduction, and runtime overhead.
"""

import time
import numpy as np

from ..formulation import match_color_ccm


def run_multistart_benchmark(
    target_reflectance: list[float] | np.ndarray,
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    available_pastes: list[dict],
    max_pastes: int = 4,
    max_total_load: float = 12.0,
    num_starts: int = 4
) -> dict:
    """
    Executes single-start vs multi-start SLSQP comparison on a given target.
    """
    # 1. Single-start
    t0 = time.perf_counter()
    res_single = match_color_ccm(
        target_reflectance=target_reflectance,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available_pastes,
        max_pastes=max_pastes,
        max_total_load=max_total_load,
        enable_multistart=False
    )
    t_single_ms = (time.perf_counter() - t0) * 1000.0

    # 2. Multi-start
    t1 = time.perf_counter()
    res_multi = match_color_ccm(
        target_reflectance=target_reflectance,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available_pastes,
        max_pastes=max_pastes,
        max_total_load=max_total_load,
        enable_multistart=True,
        num_starts=num_starts
    )
    t_multi_ms = (time.perf_counter() - t1) * 1000.0

    rec_a_single = res_single["recipes"]["recipe_a"]
    rec_a_multi = res_multi["recipes"]["recipe_a"]

    loss_single = rec_a_single["diagnostics"]["final_loss"]
    loss_multi = rec_a_multi["diagnostics"]["final_loss"]

    chosen_start = rec_a_multi["diagnostics"]["multistart"]["chosen_start_index"]
    chose_alternative = chosen_start > 0

    return {
        "single_start": {
            "delta_e00": rec_a_single["delta_e00"],
            "final_loss": loss_single,
            "runtime_ms": round(t_single_ms, 2)
        },
        "multi_start": {
            "delta_e00": rec_a_multi["delta_e00"],
            "final_loss": loss_multi,
            "runtime_ms": round(t_multi_ms, 2),
            "chosen_start_index": chosen_start,
            "chose_alternative_start": chose_alternative
        },
        "comparison": {
            "loss_improvement": round(loss_single - loss_multi, 5),
            "delta_e_improvement": round(rec_a_single["delta_e00"] - rec_a_multi["delta_e00"], 4),
            "multi_start_is_optimal_or_better": loss_multi <= loss_single + 1e-4,
            "runtime_ratio": round(t_multi_ms / max(t_single_ms, 0.1), 2)
        }
    }
