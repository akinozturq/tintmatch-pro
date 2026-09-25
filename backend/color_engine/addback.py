"""
TintMatch PRO - Production Add-Back (Batch Correction Engine)
=============================================================
Computes physically realizable plant additions to correct off-shade paint batches.
Industrial Physical Constraint:
- Paint cannot be removed from an industrial mixing tank.
- Additions are strictly non-negative:
    Delta m_i >= 0  (pigment paste addition in kg)
    Delta m_base >= 0 (un-tinted base addition for dilution / lightening)
New concentrations:
    c_i_new = (m_i_current + Delta m_i) / (M_tank + Delta m_base + sum(Delta m_j)) * 100%
"""

from typing import List, Dict, Any, Optional
import numpy as np
from scipy.optimize import minimize

from .constants import WAVELENGTHS, N_WAVELENGTHS
from .saunderson import saunderson_correction, inverse_saunderson
from .kubelka_munk import ks_to_reflectance
from .colorimetry import (
    reflectance_to_lab,
    reflectance_to_hex,
    ciede2000,
    calculate_composite_metamerism,
    compute_metamerism_index,
)
from .quality_gate import evaluate_formulation_gate
from .profiles import DEFAULT_TOLERANCE_PROFILE, ToleranceProfile, ENGINE_VERSION


def calculate_production_addback(
    tank_mass_kg: float,
    current_pastes: List[Dict[str, Any]],
    target_reflectance: List[float],
    available_pastes: List[Dict[str, Any]],
    base_k: np.ndarray | List[float],
    base_s: np.ndarray | List[float],
    current_reflectance: Optional[List[float]] = None,
    max_addition_pct: float = 25.0,
    allow_base_addition: bool = True,
    k1: float = 0.04,
    k2: float = 0.60,
    tolerance: ToleranceProfile = DEFAULT_TOLERANCE_PROFILE
) -> Dict[str, Any]:
    """
    Solves optimal batch correction additions (Delta m_i >= 0, Delta m_base >= 0)
    to bring an off-shade batch within target CIEDE2000 tolerance.

    Args:
        tank_mass_kg: Current mass of paint in tank (kg, e.g. 500.0)
        current_pastes: List of dicts with current recipe:
            - 'id': paste ID
            - 'name': str
            - 'concentration': float (wt%)
        target_reflectance: 31-point target spectral curve [400..700 nm @ 10 nm]
        available_pastes: Candidate colorants with 'unit_k' and 'unit_s'
        base_k, base_s: Base absorption and scattering spectra
        current_reflectance: Optional measured reflectance of off-shade batch
        max_addition_pct: Maximum allowed addition as % of tank mass (default 25%)
        allow_base_addition: Whether un-tinted base can be added for dilution
        k1, k2: Saunderson constants
        tolerance: Acceptance tolerance profile

    Returns:
        Dictionary with required additions in kg, new concentrations, predicted spectrum,
        final Delta E00, and feasibility verdict.
    """
    if tank_mass_kg <= 0.0:
        raise ValueError("tank_mass_kg must be greater than zero.")

    b_k = np.asarray(base_k, dtype=float)
    b_s = np.asarray(base_s, dtype=float)
    target_r = np.asarray(target_reflectance, dtype=float)
    target_lab_d65 = reflectance_to_lab(target_r, illuminant="D65", observer="10")
    target_lab_a = reflectance_to_lab(target_r, illuminant="A", observer="10")
    target_lab_f11 = reflectance_to_lab(target_r, illuminant="F11", observer="10")

    # Map candidate pastes by id
    paste_map = {p["id"]: p for p in available_pastes}

    # Identify candidate pigments for addition:
    # 1. Pastes already in current recipe
    # 2. Plus any available pastes in library (up to top 6 total to prevent huge dimensional space)
    candidate_ids = []
    current_masses: Dict[Any, float] = {}

    for cp in current_pastes:
        pid = cp.get("id")
        c = float(cp.get("concentration", 0.0))
        m_curr = tank_mass_kg * (c / 100.0)
        current_masses[pid] = m_curr
        if pid not in candidate_ids:
            candidate_ids.append(pid)

    # Add other available pastes not in recipe yet
    for p in available_pastes:
        pid = p["id"]
        if pid not in candidate_ids and len(candidate_ids) < 6:
            candidate_ids.append(pid)
            current_masses[pid] = 0.0

    n_p = len(candidate_ids)
    # Assemble unit_k and unit_s matrices
    k_mat = np.zeros((N_WAVELENGTHS, n_p), dtype=float)
    s_mat = np.zeros((N_WAVELENGTHS, n_p), dtype=float)
    curr_m_vec = np.zeros(n_p, dtype=float)

    for i, pid in enumerate(candidate_ids):
        curr_m_vec[i] = current_masses.get(pid, 0.0)
        p_obj = paste_map.get(pid, {})
        uk = np.asarray(p_obj.get("unit_k", np.zeros(N_WAVELENGTHS)), dtype=float)
        us = np.asarray(p_obj.get("unit_s", np.zeros(N_WAVELENGTHS)), dtype=float)
        k_mat[:, i] = uk
        s_mat[:, i] = us

    # Initial batch color simulation if current_reflectance is omitted
    curr_total_c = (curr_m_vec / tank_mass_kg) * 100.0
    k_curr = b_k + np.sum(k_mat * curr_total_c[np.newaxis, :], axis=1)
    s_curr = b_s + np.sum(s_mat * curr_total_c[np.newaxis, :], axis=1)
    r_int_curr = ks_to_reflectance(k_curr / np.maximum(s_curr, 1e-6))
    r_meas_curr = inverse_saunderson(r_int_curr, k1=k1, k2=k2)

    actual_initial_r = np.asarray(current_reflectance, dtype=float) if current_reflectance is not None else r_meas_curr
    lab_initial = reflectance_to_lab(actual_initial_r, illuminant="D65", observer="10")
    initial_diff = ciede2000(target_lab_d65, lab_initial)
    initial_de00 = round(float(initial_diff["delta_e00"]), 3)

    # Variables to optimize:
    # x[:n_p] = delta m_i in kg (>= 0)
    # x[n_p]  = delta m_base in kg (>= 0 if allow_base_addition else == 0)
    dim = n_p + 1
    max_add_kg = tank_mass_kg * (max_addition_pct / 100.0)

    bounds = [(0.0, max_add_kg) for _ in range(n_p)]
    if allow_base_addition:
        bounds.append((0.0, max_add_kg))
    else:
        bounds.append((0.0, 0.0))

    def objective(x: np.ndarray) -> float:
        delta_p_kg = np.maximum(x[:n_p], 0.0)
        delta_base_kg = max(0.0, float(x[n_p])) if allow_base_addition else 0.0

        m_total_new = tank_mass_kg + delta_base_kg + np.sum(delta_p_kg)
        new_concs = ((curr_m_vec + delta_p_kg) / m_total_new) * 100.0

        # Optical prediction
        tot_k = b_k + np.sum(k_mat * new_concs[np.newaxis, :], axis=1)
        tot_s = b_s + np.sum(s_mat * new_concs[np.newaxis, :], axis=1)
        ks_mix = tot_k / np.maximum(tot_s, 1e-6)
        r_int = ks_to_reflectance(ks_mix)
        r_pred = inverse_saunderson(r_int, k1=k1, k2=k2)

        pred_lab = reflectance_to_lab(r_pred, illuminant="D65", observer="10")
        de00 = ciede2000(target_lab_d65, pred_lab)["delta_e00"]

        # Regularizer penalizing unnecessary addition mass
        total_addition_ratio = (delta_base_kg + np.sum(delta_p_kg)) / tank_mass_kg
        return float(de00 + 0.01 * total_addition_ratio)

    # Mass limit constraint: sum(delta_m) <= max_add_kg
    constraints = [
        {"type": "ineq", "fun": lambda x: max_add_kg - np.sum(np.maximum(x, 0.0))}
    ]

    # Initial guess: try no addition, plus minor trial guesses
    best_res = None
    best_loss = 999.0

    trial_x0s = [
        np.zeros(dim, dtype=float),
        np.full(dim, 0.1, dtype=float),
    ]

    for x0 in trial_x0s:
        res = minimize(
            objective,
            x0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 200, "eps": 1e-3, "ftol": 1e-6}
        )
        if res.fun < best_loss:
            best_loss = res.fun
            best_res = res

    opt_x = np.maximum(best_res.x, 0.0)
    opt_delta_p = opt_x[:n_p]
    opt_delta_base = float(opt_x[n_p]) if allow_base_addition else 0.0

    # Prune tiny additions (< 0.005 kg e.g. 5 grams in 500 kg batch)
    for i in range(n_p):
        if opt_delta_p[i] < 0.005:
            opt_delta_p[i] = 0.0

    if opt_delta_base < 0.01:
        opt_delta_base = 0.0

    m_final_tank = tank_mass_kg + opt_delta_base + float(np.sum(opt_delta_p))
    final_concs = ((curr_m_vec + opt_delta_p) / m_final_tank) * 100.0

    # Final optical prediction
    tot_k = b_k + np.sum(k_mat * final_concs[np.newaxis, :], axis=1)
    tot_s = b_s + np.sum(s_mat * final_concs[np.newaxis, :], axis=1)
    ks_mix = tot_k / np.maximum(tot_s, 1e-6)
    r_int_final = ks_to_reflectance(ks_mix)
    r_meas_final = inverse_saunderson(r_int_final, k1=k1, k2=k2)

    pred_lab_d65 = reflectance_to_lab(r_meas_final, illuminant="D65", observer="10")
    pred_lab_a = reflectance_to_lab(r_meas_final, illuminant="A", observer="10")
    pred_lab_f11 = reflectance_to_lab(r_meas_final, illuminant="F11", observer="10")

    diff_d65 = ciede2000(target_lab_d65, pred_lab_d65)
    final_de00 = round(float(diff_d65["delta_e00"]), 3)

    diff_a = ciede2000(target_lab_a, pred_lab_a)["delta_e00"]
    diff_f11 = ciede2000(target_lab_f11, pred_lab_f11)["delta_e00"]
    comp_mi = round(float(calculate_composite_metamerism(final_de00, diff_a, diff_f11, method="max")), 3)

    # Compile addition instructions
    additions = []
    total_added_pigment_kg = 0.0
    for i, pid in enumerate(candidate_ids):
        p_obj = paste_map.get(pid, {})
        add_kg = round(float(opt_delta_p[i]), 3)
        curr_kg = round(float(curr_m_vec[i]), 3)
        final_kg = round(curr_kg + add_kg, 3)
        curr_pct = round(float((curr_m_vec[i] / tank_mass_kg) * 100.0), 3)
        final_pct = round(float(final_concs[i]), 3)

        if add_kg > 0.0 or curr_kg > 0.0:
            additions.append({
                "paste_id": pid,
                "name": p_obj.get("name", f"Pigment #{pid}"),
                "code": p_obj.get("code", ""),
                "color_hex": p_obj.get("color_hex", "#777777"),
                "current_kg": curr_kg,
                "addition_kg": add_kg,
                "final_kg": final_kg,
                "current_pct": curr_pct,
                "final_pct": final_pct,
            })
            total_added_pigment_kg += add_kg

    # Sort additions by added kg descending
    additions.sort(key=lambda x: x["addition_kg"], reverse=True)

    is_correctable = final_de00 <= tolerance.single_de00_limit

    # Formulation Quality Gate
    dir_res = {
        "delta_L": round(float(pred_lab_d65[0] - target_lab_d65[0]), 2),
        "delta_a": round(float(pred_lab_d65[1] - target_lab_d65[1]), 2),
        "delta_b": round(float(pred_lab_d65[2] - target_lab_d65[2]), 2),
    }

    fg_gate = evaluate_formulation_gate(
        delta_e00_d65=final_de00,
        composite_mi=comp_mi,
        total_load=float(np.sum(final_concs)),
        max_total_load=tolerance.opacity_limit,  # dummy high bound
        solver_status="OPTIMAL_CONVERGED" if best_res.success else "FEASIBLE_LOCAL_MIN",
        directional_residuals=dir_res,
        tolerance=tolerance
    )

    notes = []
    if final_de00 < initial_de00:
        notes.append(f"CIEDE2000 reduced from {initial_de00:.2f} to {final_de00:.2f} ({((initial_de00 - final_de00)/initial_de00)*100:.1f}% improvement).")
    if opt_delta_base > 0:
        notes.append(f"Base addition of {opt_delta_base:.2f} kg required for shade dilution/lightening.")
    if is_correctable:
        notes.append(f"Batch successfully corrected within tolerance limit (ΔE00 <= {tolerance.single_de00_limit}).")
    else:
        notes.append(f"Batch improvement limited by physical mass non-negativity barrier (Δm >= 0). Residual ΔE00 = {final_de00:.2f}.")

    return {
        "is_correctable": is_correctable,
        "initial_delta_e00": initial_de00,
        "final_delta_e00": final_de00,
        "composite_metamerism_index": comp_mi,
        "tank_mass_initial_kg": round(float(tank_mass_kg), 2),
        "tank_mass_final_kg": round(float(m_final_tank), 2),
        "base_addition_kg": round(float(opt_delta_base), 3),
        "base_addition_pct": round(float((opt_delta_base / tank_mass_kg) * 100.0), 3),
        "total_pigment_addition_kg": round(float(total_added_pigment_kg), 3),
        "additions": additions,
        "predicted_reflectance": [round(float(v), 5) for v in r_meas_final],
        "predicted_lab": [round(float(v), 2) for v in pred_lab_d65],
        "target_lab": [round(float(v), 2) for v in target_lab_d65],
        "predicted_hex": reflectance_to_hex(r_meas_final),
        "quality_gate": fg_gate,
        "notes": notes,
        "engine_version": ENGINE_VERSION
    }
