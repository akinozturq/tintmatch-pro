"""
Formulation and Computer Color Matching (CCM) Engine 2.0
========================================================
Industrial-grade multi-illuminant CCM solver and live recipe simulation engine:
- Direct physical forward Kubelka-Munk and Saunderson optics (no unphysical delta K/S zeroing)
- Constrained non-linear optimization via SLSQP enforcing true mass inequality sum(c_i) <= max_total_load
- 3 Distinct Optimization Profiles:
    1. Recipe A — Color Match (High D65 fidelity)
    2. Recipe B — Light Stability (DIN 6172 / ASTM E805 multi-illuminant metamerism penalty)
    3. Recipe C — Economy / Low Load (Total pigment loading penalty)
- Solver diagnostics (OPTIMAL_CONVERGED, FEASIBLE_LOCAL_MIN, MAX_ITERATIONS, CONSTRAINTS_VIOLATED)
- Analytical Pigment Sensitivity Matrix (What-If partial derivatives: d(dE00)/dc, dL/dc, da/dc, db/dc, dC/dc, dH/dc)
"""

import numpy as np
from scipy.optimize import minimize, nnls
from .constants import WAVELENGTHS, N_WAVELENGTHS
from .saunderson import saunderson_correction, inverse_saunderson
from .kubelka_munk import reflectance_to_ks, ks_to_reflectance, forward_two_constant_km
from .colorimetry import (
    reflectance_to_xyz,
    xyz_to_lab,
    reflectance_to_lab,
    reflectance_to_hex,
    ciede2000,
    compute_metamerism_index,
)
from .profiles import (
    OptimizationProfile,
    PROFILE_COLOR_MATCH,
    PROFILE_LIGHT_STABILITY,
    PROFILE_ECONOMY,
    STANDARD_OPTIMIZATION_PROFILES,
)


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
            "code": paste.get("code", ""),
            "hex": paste.get("hex", "#777777"),
            "concentration": round(conc, 3)
        })

    # Mixture K/S
    mix_ks = total_k / np.maximum(total_s, 1e-6)
    r_internal = ks_to_reflectance(mix_ks)
    r_measured = inverse_saunderson(r_internal, k1=k1, k2=k2)

    # Color coordinates under standard D65/10°
    lab_d65 = reflectance_to_lab(r_measured, illuminant="D65", observer="10")
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


def calculate_pigment_sensitivity_matrix(
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    matched_pastes: list[dict],
    target_reflectance: list[float] | None = None,
    k1: float = 0.04,
    k2: float = 0.60,
    delta: float = 0.05
) -> list[dict]:
    """
    Computes analytical 'What-If' sensitivity partial derivatives for each pigment in a recipe:
    - d(ΔE00)/dc: Sensitivity of total color difference to concentration change (% / %)
    - dL*/dc: Lightness impact
    - da*/dc: Red/Green shift impact
    - db*/dc: Yellow/Blue shift impact
    - dC*/dc: Chroma / saturation impact
    - dH*/dc: Metric hue difference impact
    """
    if not matched_pastes:
        return []

    # Baseline prediction
    base_sim = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=matched_pastes,
        k1=k1,
        k2=k2,
        target_reflectance=target_reflectance
    )
    r_base = np.asarray(base_sim["reflectance"], dtype=float)
    lab_base = reflectance_to_lab(r_base, illuminant="D65", observer="10")
    c_base = np.sqrt(lab_base[1] ** 2 + lab_base[2] ** 2)

    base_de00 = 0.0
    if target_reflectance is not None and "comparison" in base_sim:
        base_de00 = base_sim["comparison"]["delta_e00"]

    matrix = []

    for idx, paste in enumerate(matched_pastes):
        c_orig = paste.get("concentration", 0.0)

        # Build perturbed recipe with c_j + delta
        perturbed_pastes = []
        for p in matched_pastes:
            p_copy = dict(p)
            if p.get("id") == paste.get("id"):
                p_copy["concentration"] = c_orig + delta
            perturbed_pastes.append(p_copy)

        sim_pert = predict_recipe(
            base_k=base_k,
            base_s=base_s,
            pastes=perturbed_pastes,
            k1=k1,
            k2=k2,
            target_reflectance=target_reflectance
        )
        r_pert = np.asarray(sim_pert["reflectance"], dtype=float)
        lab_pert = reflectance_to_lab(r_pert, illuminant="D65", observer="10")
        c_pert = np.sqrt(lab_pert[1] ** 2 + lab_pert[2] ** 2)

        # Derivatives with respect to concentration delta
        dL = (lab_pert[0] - lab_base[0]) / delta
        da = (lab_pert[1] - lab_base[1]) / delta
        db = (lab_pert[2] - lab_base[2]) / delta
        dC = (c_pert - c_base) / delta

        # Metric hue difference: dH = sqrt(max(0, (da^2 + db^2) - dC^2)) * sign
        delta_ab_sq = ((lab_pert[1] - lab_base[1]) ** 2) + ((lab_pert[2] - lab_base[2]) ** 2)
        dH_val = np.sqrt(max(0.0, delta_ab_sq - ((c_pert - c_base) ** 2))) / delta

        d_de00 = 0.0
        if target_reflectance is not None and "comparison" in sim_pert:
            d_de00 = (sim_pert["comparison"]["delta_e00"] - base_de00) / delta

        # Interpretation text
        notes = []
        if dL < -3.0:
            notes.append("Darkens shade")
        elif dL > 3.0:
            notes.append("Lightens shade")

        if da > 3.0:
            notes.append("Shifts Red (+a*)")
        elif da < -3.0:
            notes.append("Shifts Green (-a*)")

        if db > 3.0:
            notes.append("Shifts Yellow (+b*)")
        elif db < -3.0:
            notes.append("Shifts Blue (-b*)")

        if dC > 3.0:
            notes.append("Increases saturation")
        elif dC < -3.0:
            notes.append("Desaturates / mutes")

        interp = "; ".join(notes) if notes else "Balanced hue tinting"

        matrix.append({
            "paste_id": paste.get("id"),
            "name": paste.get("name", "Colorant"),
            "code": paste.get("code", ""),
            "concentration": c_orig,
            "d_de00_dc": round(float(d_de00), 3),
            "d_L_dc": round(float(dL), 3),
            "d_a_dc": round(float(da), 3),
            "d_b_dc": round(float(db), 3),
            "d_C_dc": round(float(dC), 3),
            "d_H_dc": round(float(dH_val), 3),
            "interpretation": interp
        })

    return matrix


def _optimize_single_profile(
    profile: OptimizationProfile,
    target_r: np.ndarray,
    target_lab_d65: tuple[float, float, float],
    target_lab_a: tuple[float, float, float],
    target_lab_f11: tuple[float, float, float],
    base_k: np.ndarray,
    base_s: np.ndarray,
    candidate_indices: list[int],
    available_pastes: list[dict],
    paste_k_matrix: np.ndarray,
    paste_s_matrix: np.ndarray,
    initial_sol: np.ndarray,
    max_pastes: int,
    max_total_load: float,
    k1: float,
    k2: float
) -> dict:
    """
    Executes a single constrained SLSQP optimization run for a given OptimizationProfile.
    Enforces true linear inequality constraint: sum(c_i) <= max_total_load.
    """
    n_active = len(candidate_indices)
    if n_active == 0:
        return {
            "profile_id": profile.id,
            "profile_name": profile.name,
            "description": profile.description,
            "matched_pastes": [],
            "status": "NO_ACTIVE_PIGMENTS",
            "delta_e00": 99.0,
            "composite_mi": 99.0,
            "total_load": 0.0
        }

    # Initial guess vector
    x0 = [float(initial_sol[idx]) for idx in candidate_indices]
    # Bound each paste between 0 and max_total_load
    bounds = [(0.0, max_total_load) for _ in candidate_indices]
    # True linear inequality constraint: max_total_load - sum(c_i) >= 0
    constraints = [
        {"type": "ineq", "fun": lambda c: max_total_load - np.sum(c)}
    ]

    def objective(sub_concs):
        k_tot = base_k.copy()
        s_tot = base_s.copy()
        for i, p_idx in enumerate(candidate_indices):
            c = sub_concs[i]
            k_tot += c * paste_k_matrix[:, p_idx]
            s_tot += c * paste_s_matrix[:, p_idx]

        ks_tot = k_tot / np.maximum(s_tot, 1e-6)
        r_i = ks_to_reflectance(ks_tot)
        r_m = inverse_saunderson(r_i, k1=k1, k2=k2)

        # Primary illuminant: D65
        lab_d65 = reflectance_to_lab(r_m, illuminant="D65", observer="10")
        diff_d65 = ciede2000(target_lab_d65, lab_d65)
        de_d65 = diff_d65["delta_e00"]

        # Secondary illuminant A
        if profile.weight_a > 0 or profile.weight_metamerism > 0:
            lab_a = reflectance_to_lab(r_m, illuminant="A", observer="10")
            de_a = ciede2000(target_lab_a, lab_a)["delta_e00"]
            mi_a = abs(de_a - de_d65)
        else:
            de_a = 0.0
            mi_a = 0.0

        # Tertiary illuminant F11 (TL84)
        if profile.weight_f11 > 0 or profile.weight_metamerism > 0:
            lab_f11 = reflectance_to_lab(r_m, illuminant="F11", observer="10")
            de_f11 = ciede2000(target_lab_f11, lab_f11)["delta_e00"]
            mi_f11 = abs(de_f11 - de_d65)
        else:
            de_f11 = 0.0
            mi_f11 = 0.0

        # DIN 6172 / ASTM E805 worst-case composite metamerism index
        mi_composite = max(mi_a, mi_f11)
        tot_c = float(np.sum(sub_concs))

        total_loss = (
            profile.weight_d65 * de_d65
            + profile.weight_a * de_a
            + profile.weight_f11 * de_f11
            + profile.weight_metamerism * mi_composite
            + profile.weight_load * tot_c
        )
        return total_loss

    res = minimize(
        objective,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 250, "eps": 1e-3, "ftol": 1e-6}
    )

    opt_raw = np.maximum(res.x, 0.0)

    # Diagnostic status evaluation
    slack = max_total_load - np.sum(opt_raw)
    if slack < -1e-4:
        diag_status = "CONSTRAINTS_VIOLATED"
    elif res.success:
        diag_status = "OPTIMAL_CONVERGED"
    elif res.status == 9:
        diag_status = "MAX_ITERATIONS"
    else:
        diag_status = "FEASIBLE_LOCAL_MIN"

    # Prune negligible traces (< 0.005%)
    pruned_concs = {}
    for i, p_idx in enumerate(candidate_indices):
        c = float(opt_raw[i])
        if c >= 0.005:
            pruned_concs[p_idx] = c

    # If active pastes exceed max_pastes, keep top max_pastes by concentration
    if len(pruned_concs) > max_pastes:
        sorted_by_c = sorted(pruned_concs.items(), key=lambda kv: kv[1], reverse=True)[:max_pastes]
        pruned_concs = dict(sorted_by_c)

        # Quick refinement polish on final top pastes
        sub_indices = list(pruned_concs.keys())
        sub_x0 = [pruned_concs[idx] for idx in sub_indices]
        sub_bounds = [(0.0, max_total_load) for _ in sub_indices]
        sub_constraints = [{"type": "ineq", "fun": lambda c: max_total_load - np.sum(c)}]

        def sub_obj(c_vec):
            k_t = base_k.copy()
            s_t = base_s.copy()
            for k, p_i in enumerate(sub_indices):
                k_t += c_vec[k] * paste_k_matrix[:, p_i]
                s_t += c_vec[k] * paste_s_matrix[:, p_i]
            ks_t = k_t / np.maximum(s_t, 1e-6)
            r_sim = inverse_saunderson(ks_to_reflectance(ks_t), k1=k1, k2=k2)
            l_d65 = reflectance_to_lab(r_sim, illuminant="D65", observer="10")
            d_d65 = ciede2000(target_lab_d65, l_d65)["delta_e00"]
            return d_d65 + profile.weight_load * np.sum(c_vec)

        res_ref = minimize(sub_obj, sub_x0, method="SLSQP", bounds=sub_bounds, constraints=sub_constraints, options={"maxiter": 60, "eps": 1e-3})
        if res_ref.success:
            for k, p_i in enumerate(sub_indices):
                pruned_concs[p_i] = max(0.0, float(res_ref.x[k]))

    # Final total load clamp verification
    sum_c = sum(pruned_concs.values())
    if sum_c > max_total_load:
        scale = max_total_load / max(sum_c, 1e-6)
        for p_i in pruned_concs:
            pruned_concs[p_i] *= scale

    # Compile matched pastes list
    matched_pastes = []
    for p_idx, conc in pruned_concs.items():
        if conc >= 0.005:
            p = available_pastes[p_idx]
            matched_pastes.append({
                "id": p["id"],
                "name": p["name"],
                "code": p.get("code", ""),
                "hex": p.get("hex", "#777777"),
                "concentration": round(float(conc), 3),
                "unit_k": p.get("unit_k"),
                "unit_s": p.get("unit_s")
            })

    # Sort pastes by concentration descending
    matched_pastes.sort(key=lambda x: x["concentration"], reverse=True)

    # Full simulation
    sim = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=matched_pastes,
        k1=k1,
        k2=k2,
        target_reflectance=target_r.tolist()
    )

    de00 = sim["comparison"]["delta_e00"] if "comparison" in sim else 99.0
    mi_dict = sim["comparison"].get("metamerism", {}) if "comparison" in sim else {}
    comp_mi = max(mi_dict.get("MI_A", 0.0), mi_dict.get("MI_F11", 0.0))

    # Analytical sensitivity matrix
    sensitivity = calculate_pigment_sensitivity_matrix(
        base_k=base_k,
        base_s=base_s,
        matched_pastes=matched_pastes,
        target_reflectance=target_r.tolist(),
        k1=k1,
        k2=k2,
        delta=0.05
    )

    # Formulation Quality Gate Evaluation
    from .quality_gate import evaluate_formulation_gate
    dir_res = {
        "delta_L": sim["comparison"].get("delta_L", 0.0),
        "delta_a": sim["comparison"].get("delta_a", 0.0),
        "delta_b": sim["comparison"].get("delta_b", 0.0),
        "delta_C": sim["comparison"].get("delta_C", 0.0),
        "delta_H": sim["comparison"].get("delta_H", 0.0),
    } if "comparison" in sim else {}

    fg_result = evaluate_formulation_gate(
        delta_e00_d65=float(de00),
        composite_mi=float(comp_mi),
        total_load=float(sim["total_colorant_load"]),
        max_total_load=max_total_load,
        solver_status=diag_status,
        constraint_slack=float(max_total_load - sim["total_colorant_load"]),
        directional_residuals=dir_res
    )

    return {
        "profile_id": profile.id,
        "profile_name": profile.name,
        "description": profile.description,
        "matched_pastes": matched_pastes,
        "prediction": sim,
        "delta_e00": round(float(de00), 3),
        "composite_mi": round(float(comp_mi), 3),
        "total_load": sim["total_colorant_load"],
        "passed_target_threshold": de00 < 0.50,
        "status": diag_status,
        "formulation_gate": fg_result,
        "quality_gate": fg_result,
        "diagnostics": {
            "solver": "SLSQP",
            "iterations": int(res.nit),
            "function_evaluations": int(res.nfev),
            "success": bool(res.success),
            "message": str(res.message),
            "final_loss": round(float(res.fun), 4),
            "constraint_slack": round(float(max_total_load - sim["total_colorant_load"]), 3)
        },
        "sensitivity_matrix": sensitivity
    }


def match_color_ccm(
    target_reflectance: list[float],
    base_k: np.ndarray | list[float],
    base_s: np.ndarray | list[float],
    available_pastes: list[dict],
    max_pastes: int = 4,
    max_total_load: float = 12.0,
    k1: float = 0.04,
    k2: float = 0.60,
    profile_id: str | None = None
) -> dict:
    """
    Automated Computer Color Matching (CCM) solver.
    Solves 3 distinct industrial formulations concurrently:
    - Recipe A: Color Match (Profile A - minimum D65 color difference)
    - Recipe B: Light Stability (Profile B - multi-illuminant metamerism penalty)
    - Recipe C: Economy / Low Load (Profile C - minimum total pigment loading)

    Args:
        target_reflectance: 31-point target spectral curve (400-700 nm @ 10 nm)
        base_k: Base absorption spectrum (31 points)
        base_s: Base scattering spectrum (31 points)
        available_pastes: List of candidate colorant dictionaries
        max_pastes: Maximum number of colorant pastes in final recipe (2 to 4)
        max_total_load: Maximum allowed total paste loading percentage (default: 12.0%)
        k1: Saunderson Fresnel reflection coefficient
        k2: Saunderson internal diffuse reflection coefficient
        profile_id: Optional profile preference ('color_match', 'light_stability', 'economy')

    Returns:
        Structured response with primary recipe, 3 alternative recipes, diagnostics, and sensitivity matrix.
    """
    n_pastes = len(available_pastes)
    if n_pastes == 0:
        raise ValueError("No available pastes provided for matching.")

    target_r = np.asarray(target_reflectance, dtype=float)
    target_r_int = saunderson_correction(target_r, k1=k1, k2=k2)
    target_ks = reflectance_to_ks(target_r_int)

    # Pre-calculate target Lab under D65, A, F11
    target_lab_d65 = reflectance_to_lab(target_r, illuminant="D65", observer="10")
    target_lab_a = reflectance_to_lab(target_r, illuminant="A", observer="10")
    target_lab_f11 = reflectance_to_lab(target_r, illuminant="F11", observer="10")

    b_k = np.asarray(base_k, dtype=float)
    b_s = np.asarray(base_s, dtype=float)
    base_ks = b_k / np.maximum(b_s, 1e-6)

    # Initial delta K/S requirement
    delta_ks = np.maximum(target_ks - base_ks, 0.0)

    # Construct spectral matrices for all available pastes
    A = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    paste_k_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)
    paste_s_matrix = np.zeros((N_WAVELENGTHS, n_pastes), dtype=float)

    for idx, p in enumerate(available_pastes):
        uk = np.asarray(p.get("unit_k", np.zeros(N_WAVELENGTHS)), dtype=float)
        us = np.asarray(p.get("unit_s", np.zeros(N_WAVELENGTHS)), dtype=float)
        paste_k_matrix[:, idx] = uk
        paste_s_matrix[:, idx] = us
        A[:, idx] = uk / np.maximum(b_s, 1e-6)

    # Step 1: Initial NNLS across full library
    initial_sol, _ = nnls(A, delta_ks)

    # Screen candidate pigments
    positive_indices = [idx for idx in np.argsort(initial_sol)[::-1] if initial_sol[idx] > 0.001]
    if len(positive_indices) < 2:
        # Fallback to top correlated pigments if NNLS is too sparse
        corr_scores = [float(np.dot(A[:, i], delta_ks)) for i in range(n_pastes)]
        positive_indices = list(np.argsort(corr_scores)[::-1][:min(4, n_pastes)])

    # Select candidate pool (up to max_pastes + 2 candidates for SLSQP to choose from)
    candidate_indices = positive_indices[:min(len(positive_indices), max(max_pastes + 2, 4))]

    # Step 2: Solve independently for Recipe A, B, and C
    recipe_a = _optimize_single_profile(
        profile=PROFILE_COLOR_MATCH,
        target_r=target_r,
        target_lab_d65=target_lab_d65,
        target_lab_a=target_lab_a,
        target_lab_f11=target_lab_f11,
        base_k=b_k,
        base_s=b_s,
        candidate_indices=candidate_indices,
        available_pastes=available_pastes,
        paste_k_matrix=paste_k_matrix,
        paste_s_matrix=paste_s_matrix,
        initial_sol=initial_sol,
        max_pastes=max_pastes,
        max_total_load=max_total_load,
        k1=k1,
        k2=k2
    )

    recipe_b = _optimize_single_profile(
        profile=PROFILE_LIGHT_STABILITY,
        target_r=target_r,
        target_lab_d65=target_lab_d65,
        target_lab_a=target_lab_a,
        target_lab_f11=target_lab_f11,
        base_k=b_k,
        base_s=b_s,
        candidate_indices=candidate_indices,
        available_pastes=available_pastes,
        paste_k_matrix=paste_k_matrix,
        paste_s_matrix=paste_s_matrix,
        initial_sol=initial_sol,
        max_pastes=max_pastes,
        max_total_load=max_total_load,
        k1=k1,
        k2=k2
    )

    recipe_c = _optimize_single_profile(
        profile=PROFILE_ECONOMY,
        target_r=target_r,
        target_lab_d65=target_lab_d65,
        target_lab_a=target_lab_a,
        target_lab_f11=target_lab_f11,
        base_k=b_k,
        base_s=b_s,
        candidate_indices=candidate_indices,
        available_pastes=available_pastes,
        paste_k_matrix=paste_k_matrix,
        paste_s_matrix=paste_s_matrix,
        initial_sol=initial_sol,
        max_pastes=max_pastes,
        max_total_load=max_total_load,
        k1=k1,
        k2=k2
    )

    # Determine primary recipe
    if profile_id == "light_stability":
        primary = recipe_b
        primary_key = "recipe_b"
    elif profile_id == "economy":
        primary = recipe_c
        primary_key = "recipe_c"
    else:
        primary = recipe_a
        primary_key = "recipe_a"

    return {
        "matched_pastes": primary["matched_pastes"],
        "prediction": primary["prediction"],
        "delta_e00": primary["delta_e00"],
        "composite_mi": primary["composite_mi"],
        "total_colorant_load": primary["total_load"],
        "passed_target_threshold": primary["passed_target_threshold"],
        "status": primary["status"],
        "formulation_gate": primary.get("quality_gate"),
        "quality_gate": primary.get("quality_gate"),
        "diagnostics": primary["diagnostics"],
        "sensitivity_matrix": primary["sensitivity_matrix"],
        "primary_recipe_key": primary_key,
        "recipes": {
            "recipe_a": recipe_a,
            "recipe_b": recipe_b,
            "recipe_c": recipe_c
        }
    }
