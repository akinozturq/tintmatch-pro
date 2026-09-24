"""
Formulation and Computer Color Matching (CCM) Engine
===================================================
Provides live recipe simulation (spectral curve, swatch, delta E00, Metamerism Index)
and automated optimization to match target colors.
"""

import numpy as np
from scipy.optimize import minimize, nnls
from .constants import WAVELENGTHS, N_WAVELENGTHS
from .saunderson import saunderson_correction, inverse_saunderson
from .kubelka_munk import reflectance_to_ks, ks_to_reflectance, forward_two_constant_km
from .colorimetry import reflectance_to_xyz, xyz_to_lab, reflectance_to_lab, reflectance_to_hex, ciede2000, compute_metamerism_index


def predict_recipe(
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    pastes: list[dict],
    k1: float = 0.04,
    k2: float = 0.60,
    target_reflectance: list[float] | None = None,
    thickness: float = 100.0
) -> dict:
    """
    Simulates the spectral reflectance and colorimetric coordinates of a paint recipe.

    Args:
        base_k: Base absorption spectrum (31 points)
        base_s: Base scattering spectrum (31 points)
        pastes: List of dicts, each with:
            - 'id': str/int
            - 'name': str
            - 'concentration': float (percentage, e.g. 1.25%)
            - 'unit_k': list of 31 floats
            - 'unit_s': list of 31 floats
        k1: Saunderson Fresnel reflection coefficient
        k2: Saunderson internal reflection coefficient
        target_reflectance: Optional 31-point target spectrum for delta E00 and MI
        thickness: Film thickness (microns)

    Returns:
        Predicted spectral curve, XYZ, L*a*b*, Hex swatch, ΔE00, Metamerism Index.
    """
    b_k = np.asarray(base_k, dtype=float)
    b_s = np.asarray(base_s, dtype=float)

    total_k = b_k.copy()
    total_s = b_s.copy()
    total_conc = 0.0

    recipe_breakdown = []

    for paste in pastes:
        conc = float(paste.get("concentration", 0.0))
        if conc <= 0.0:
            continue

        p_k = np.asarray(paste.get("unit_k", np.zeros(N_WAVELENGTHS)), dtype=float)
        p_s = np.asarray(paste.get("unit_s", np.zeros(N_WAVELENGTHS)), dtype=float)

        total_k += conc * p_k
        total_s += conc * p_s
        total_conc += conc

        recipe_breakdown.append({
            "id": paste.get("id"),
            "name": paste.get("name", "Pigment"),
            "concentration": conc
        })

    # Mixture K/S
    mix_ks = total_k / np.maximum(total_s, 1e-6)
    r_internal = ks_to_reflectance(mix_ks)
    r_measured = inverse_saunderson(r_internal, k1=k1, k2=k2)

    # Color coordinates
    lab_d65 = reflectance_to_lab(r_measured, illuminant="D65", observer="10")
    lab_a = reflectance_to_lab(r_measured, illuminant="A", observer="10")
    lab_f11 = reflectance_to_lab(r_measured, illuminant="F11", observer="10")
    hex_color = reflectance_to_hex(r_measured)

    # Contrast ratio / Opacity check
    r_black = forward_two_constant_km(total_k, total_s, thickness=thickness, Rg=0.04, k1=k1, k2=k2)
    r_white = forward_two_constant_km(total_k, total_s, thickness=thickness, Rg=0.82, k1=k1, k2=k2)
    _, Y_b, _ = reflectance_to_xyz(r_black, illuminant="D65", observer="10")
    _, Y_w, _ = reflectance_to_xyz(r_white, illuminant="D65", observer="10")
    contrast_ratio = float(np.clip((Y_b / max(Y_w, 1e-6)) * 100.0, 0.0, 100.0))

    response = {
        "reflectance": [round(float(v), 4) for v in r_measured],
        "reflectance_internal": [round(float(v), 4) for v in r_internal],
        "ks": [round(float(v), 5) for v in mix_ks],
        "lab": {
            "L": round(lab_d65[0], 2),
            "a": round(lab_d65[1], 2),
            "b": round(lab_d65[2], 2)
        },
        "hex": hex_color,
        "total_colorant_load": round(total_conc, 3),
        "contrast_ratio": round(contrast_ratio, 2),
        "is_opaque": contrast_ratio >= 98.0,
        "wavelengths": WAVELENGTHS.tolist(),
        "recipe_breakdown": recipe_breakdown
    }

    # If target is provided, compare
    if target_reflectance is not None and len(target_reflectance) == N_WAVELENGTHS:
        target_r = np.asarray(target_reflectance, dtype=float)
        target_lab = reflectance_to_lab(target_r, illuminant="D65", observer="10")
        diff = ciede2000(target_lab, lab_d65)
        mi = compute_metamerism_index(r_measured, target_r, observer="10")

        response["comparison"] = {
            "target_lab": {
                "L": round(target_lab[0], 2),
                "a": round(target_lab[1], 2),
                "b": round(target_lab[2], 2)
            },
            "target_hex": reflectance_to_hex(target_r),
            "delta_e00": diff["delta_e00"],
            "delta_L": diff["delta_L"],
            "delta_a": diff["delta_a"],
            "delta_b": diff["delta_b"],
            "delta_C": diff["delta_C"],
            "delta_H": diff["delta_H"],
            "passed": diff["passed"],
            "metamerism": mi
        }

    return response


def match_color_ccm(
    target_reflectance: list[float],
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    available_pastes: list[dict],
    max_pastes: int = 4,
    max_total_load: float = 12.0,
    k1: float = 0.04,
    k2: float = 0.60
) -> dict:
    """
    Automated Computer Color Matching (CCM) solver.
    Uses Non-Negative Least Squares (NNLS) and constrained minimization
    to find the optimal combination of 2 to 4 colorant pastes to match target spectrum.
    """
    target_r = np.asarray(target_reflectance, dtype=float)
    target_r_int = saunderson_correction(target_r, k1=k1, k2=k2)
    target_ks = reflectance_to_ks(target_r_int)
    target_lab = reflectance_to_lab(target_r, illuminant="D65", observer="10")

    b_k = np.asarray(base_k, dtype=float)
    b_s = np.asarray(base_s, dtype=float)
    base_ks = b_k / np.maximum(b_s, 1e-6)

    # delta K/S that pastes must deliver
    delta_ks = np.maximum(target_ks - base_ks, 0.0)

    n_pastes = len(available_pastes)
    if n_pastes == 0:
        raise ValueError("No available pastes provided for matching.")

    # Build matrix of unit K/S for available pastes
    # A has shape (31, n_pastes)
    A = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    paste_k_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    paste_s_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)

    for idx, p in enumerate(available_pastes):
        uk = np.asarray(p.get("unit_k", np.zeros(N_WAVELENGTHS)), dtype=float)
        us = np.asarray(p.get("unit_s", np.zeros(N_WAVELENGTHS)), dtype=float)
        paste_k_matrix[:, idx] = uk
        paste_s_matrix[:, idx] = us

        # Unit K/S approximation relative to base
        eff_ks = uk / np.maximum(b_s, 1e-6)
        A[:, idx] = eff_ks

    # Step 1: Initial quick solution via NNLS
    initial_sol, _ = nnls(A, delta_ks)

    # Step 2: Keep top max_pastes pigments to maintain clean non-metameric recipes
    top_indices = np.argsort(initial_sol)[::-1][:max_pastes]
    active_indices = [idx for idx in top_indices if initial_sol[idx] > 0.001]
    if len(active_indices) == 0:
        active_indices = top_indices[:2].tolist()

    # Step 3: Non-linear refinement minimizing CIEDE2000 directly
    def objective(sub_concs):
        # Build total K and S
        k_tot = b_k.copy()
        s_tot = b_s.copy()
        for i, p_idx in enumerate(active_indices):
            c = sub_concs[i]
            k_tot += c * paste_k_matrix[:, p_idx]
            s_tot += c * paste_s_matrix[:, p_idx]

        ks_tot = k_tot / np.maximum(s_tot, 1e-6)
        r_i = ks_to_reflectance(ks_tot)
        r_m = inverse_saunderson(r_i, k1=k1, k2=k2)
        lab_m = reflectance_to_lab(r_m, illuminant="D65", observer="10")
        diff = ciede2000(target_lab, lab_m)
        return diff["delta_e00"]

    x0 = [float(initial_sol[idx]) for idx in active_indices]
    bounds = [(0.0, max_total_load) for _ in active_indices]

    res = minimize(
        objective,
        x0,
        method="L-BFGS-B",
        bounds=bounds,
        options={"maxiter": 200, "eps": 1e-3, "ftol": 1e-5}
    )

    opt_concs = np.zeros(n_pastes, dtype=float)
    for i, p_idx in enumerate(active_indices):
        opt_concs[p_idx] = float(np.clip(res.x[i], 0.0, max_total_load))

    # Compile formulation pastes
    matched_pastes = []
    for idx, p in enumerate(available_pastes):
        c = opt_concs[idx]
        if c > 0.005:  # filter negligible traces
            matched_pastes.append({
                "id": p["id"],
                "name": p["name"],
                "code": p.get("code", ""),
                "hex": p.get("hex", "#777777"),
                "concentration": round(float(c), 3),
                "unit_k": p.get("unit_k"),
                "unit_s": p.get("unit_s")
            })

    # Simulate final result
    sim = predict_recipe(
        base_k=b_k,
        base_s=b_s,
        pastes=matched_pastes,
        k1=k1,
        k2=k2,
        target_reflectance=target_reflectance
    )

    return {
        "matched_pastes": matched_pastes,
        "prediction": sim,
        "delta_e00": sim["comparison"]["delta_e00"] if "comparison" in sim else None,
        "passed_target_threshold": sim["comparison"]["delta_e00"] < 0.5 if "comparison" in sim else False,
        "status": "Optimal Match Found"
    }
