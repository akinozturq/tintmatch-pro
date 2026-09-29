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
- Finite-Difference Numerical Sensitivity Matrix (What-If partial derivatives: d(dE00)/dc, dL/dc, da/dc, db/dc, dC/dc, dH/dc)
"""

import uuid
import itertools
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
    ENGINE_VERSION,
    OptimizationProfile,
    PROFILE_COLOR_MATCH,
    PROFILE_LIGHT_STABILITY,
    PROFILE_ECONOMY,
    STANDARD_OPTIMIZATION_PROFILES,
)
from .constraints import FormulationConstraints, ConstraintEngine, InfeasibleConstraintSet


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
    Computes finite-difference numerical 'What-If' sensitivity partial derivatives for each pigment in a recipe:
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

        # Concrete discrete step +0.10%
        step_plus_pastes = []
        for p in matched_pastes:
            p_copy = dict(p)
            if p.get("id") == paste.get("id"):
                p_copy["concentration"] = c_orig + 0.10
            step_plus_pastes.append(p_copy)

        sim_plus = predict_recipe(
            base_k=base_k,
            base_s=base_s,
            pastes=step_plus_pastes,
            k1=k1,
            k2=k2,
            target_reflectance=target_reflectance
        )
        r_plus = np.asarray(sim_plus["reflectance"], dtype=float)
        lab_plus = reflectance_to_lab(r_plus, illuminant="D65", observer="10")
        c_plus = np.sqrt(lab_plus[1] ** 2 + lab_plus[2] ** 2)
        diff_ab_sq_plus = ((lab_plus[1] - lab_base[1]) ** 2) + ((lab_plus[2] - lab_base[2]) ** 2)
        dH_plus = float(np.sqrt(max(0.0, diff_ab_sq_plus - ((c_plus - c_base) ** 2))))

        step_plus_010 = {
            "concentration": round(c_orig + 0.10, 4),
            "delta_e00": round(float(sim_plus["comparison"]["delta_e00"]), 3) if "comparison" in sim_plus else 0.0,
            "delta_L": round(float(lab_plus[0] - lab_base[0]), 3),
            "delta_a": round(float(lab_plus[1] - lab_base[1]), 3),
            "delta_b": round(float(lab_plus[2] - lab_base[2]), 3),
            "delta_C": round(float(c_plus - c_base), 3),
            "delta_H": round(dH_plus, 3)
        }

        # Concrete discrete step -0.10% (bounded at 0.0)
        c_minus_target = max(0.0, c_orig - 0.10)
        step_minus_pastes = []
        for p in matched_pastes:
            p_copy = dict(p)
            if p.get("id") == paste.get("id"):
                p_copy["concentration"] = c_minus_target
            step_minus_pastes.append(p_copy)

        sim_minus = predict_recipe(
            base_k=base_k,
            base_s=base_s,
            pastes=step_minus_pastes,
            k1=k1,
            k2=k2,
            target_reflectance=target_reflectance
        )
        r_minus = np.asarray(sim_minus["reflectance"], dtype=float)
        lab_minus = reflectance_to_lab(r_minus, illuminant="D65", observer="10")
        c_minus = np.sqrt(lab_minus[1] ** 2 + lab_minus[2] ** 2)
        diff_ab_sq_minus = ((lab_minus[1] - lab_base[1]) ** 2) + ((lab_minus[2] - lab_base[2]) ** 2)
        dH_minus = float(np.sqrt(max(0.0, diff_ab_sq_minus - ((c_minus - c_base) ** 2))))

        step_minus_010 = {
            "concentration": round(c_minus_target, 4),
            "delta_e00": round(float(sim_minus["comparison"]["delta_e00"]), 3) if "comparison" in sim_minus else 0.0,
            "delta_L": round(float(lab_minus[0] - lab_base[0]), 3),
            "delta_a": round(float(lab_minus[1] - lab_base[1]), 3),
            "delta_b": round(float(lab_minus[2] - lab_base[2]), 3),
            "delta_C": round(float(c_minus - c_base), 3),
            "delta_H": round(dH_minus, 3)
        }

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
            "step_plus_010": step_plus_010,
            "step_minus_010": step_minus_010,
            "interpretation": interp
        })

    return matrix


def evaluate_recipe_objective(
    concs: np.ndarray | list[float],
    active_indices: list[int],
    paste_k_matrix: np.ndarray,
    paste_s_matrix: np.ndarray,
    base_k: np.ndarray,
    base_s: np.ndarray,
    target_lab_d65: tuple[float, float, float],
    target_lab_a: tuple[float, float, float],
    target_lab_f11: tuple[float, float, float],
    profile: OptimizationProfile,
    k1: float = 0.04,
    k2: float = 0.60
) -> float:
    """
    Unified objective loss calculation for both primary SLSQP search and pruning refinement.
    Ensures Recipe B (Light Stability) and Recipe C (Economy) preserve their profile penalty weights.
    """
    k_tot = base_k.copy()
    s_tot = base_s.copy()
    for i, p_idx in enumerate(active_indices):
        c = max(0.0, float(concs[i]))
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
    tot_c = float(np.sum(np.maximum(concs, 0.0)))

    total_loss = (
        profile.weight_d65 * de_d65
        + profile.weight_a * de_a
        + profile.weight_f11 * de_f11
        + profile.weight_metamerism * mi_composite
        + profile.weight_load * tot_c
    )
    return float(total_loss)


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
    k2: float,
    constraints_config: FormulationConstraints | None = None,
    enable_multistart: bool = False,
    num_starts: int = 3
) -> dict:
    """
    Executes constrained SLSQP optimization run for a given OptimizationProfile.
    Supports single-start or multi-start initialization to guard against non-convex CIEDE2000 local minima.
    Enforces true linear inequality constraint: sum(c_i) <= max_total_load and group/dispensing bounds.
    """
    n_active = len(candidate_indices)
    if n_active == 0:
        return {
            "profile_id": profile.id,
            "profile_name": profile.name,
            "description": profile.description,
            "matched_pastes": [],
            "prediction": None,
            "delta_e00": 99.0,
            "composite_mi": 99.0,
            "total_load": 0.0,
            "passed_target_threshold": False,
            "status": "NO_ACTIVE_PIGMENTS",
            "formulation_gate": {
                "overall_pass": False,
                "de_pass": False,
                "mi_pass": False,
                "load_pass": False,
                "min_load_pass": False,
                "solver_pass": False,
                "failures": ["No active colorant pastes available for formulation."]
            },
            "quality_gate": {
                "overall_pass": False,
                "de_pass": False,
                "mi_pass": False,
                "load_pass": False,
                "min_load_pass": False,
                "solver_pass": False,
                "failures": ["No active colorant pastes available for formulation."]
            },
            "diagnostics": {
                "solver": "SLSQP",
                "iterations": 0,
                "function_evaluations": 0,
                "success": False,
                "message": "No active colorant pastes available.",
                "final_loss": 999.0,
                "constraint_slack": 0.0,
                "slack_details": {},
                "constraint_validation": {"is_valid": False, "violations": ["No active pigments"]},
                "multistart": {"enabled": False, "num_starts_evaluated": 0, "chosen_start_index": 0}
            },
            "sensitivity_matrix": {}
        }

    if constraints_config is None:
        constraints_config = FormulationConstraints(max_total_load=max_total_load, max_pastes=max_pastes)
    elif constraints_config.max_pastes is None:
        constraints_config.max_pastes = max_pastes

    engine = ConstraintEngine(constraints_config)
    candidate_keys = [str(available_pastes[idx].get("id", idx)) for idx in candidate_indices]

    # Initial guess vectors - strictly projected to feasible constraint set
    x0_raw = [float(initial_sol[idx]) for idx in candidate_indices]
    if np.sum(x0_raw) <= 0.0:
        x0_raw = [constraints_config.max_total_load / (2.0 * max(n_active, 1))] * n_active
    try:
        x0_nnls = engine.project_to_feasible(x0_raw, candidate_keys).tolist()
    except InfeasibleConstraintSet as e:
        return {
            "profile_id": profile.id,
            "profile_name": profile.name,
            "description": profile.description,
            "matched_pastes": [],
            "prediction": None,
            "delta_e00": 99.0,
            "composite_mi": 99.0,
            "total_load": 0.0,
            "passed_target_threshold": False,
            "status": "INFEASIBLE_CONSTRAINT_SET",
            "formulation_gate": {
                "overall_pass": False,
                "de_pass": False,
                "mi_pass": False,
                "load_pass": False,
                "min_load_pass": False,
                "solver_pass": False,
                "failures": [str(e)]
            },
            "quality_gate": {
                "overall_pass": False,
                "de_pass": False,
                "mi_pass": False,
                "load_pass": False,
                "min_load_pass": False,
                "solver_pass": False,
                "failures": [str(e)]
            },
            "diagnostics": {
                "solver": "SLSQP",
                "iterations": 0,
                "function_evaluations": 0,
                "success": False,
                "message": f"Infeasible constraint set: {str(e)}",
                "final_loss": 999.0,
                "constraint_slack": 0.0,
                "slack_details": {},
                "constraint_validation": {"is_valid": False, "violations": [str(e)]},
                "multistart": {"enabled": enable_multistart, "num_starts_evaluated": 0, "chosen_start_index": 0}
            },
            "sensitivity_matrix": {}
        }

    bounds = engine.build_scipy_bounds(candidate_keys, default_upper_bound=constraints_config.max_total_load)
    constraints = engine.build_scipy_constraints(candidate_keys)

    def objective(sub_concs):
        return evaluate_recipe_objective(
            concs=sub_concs,
            active_indices=candidate_indices,
            paste_k_matrix=paste_k_matrix,
            paste_s_matrix=paste_s_matrix,
            base_k=base_k,
            base_s=base_s,
            target_lab_d65=target_lab_d65,
            target_lab_a=target_lab_a,
            target_lab_f11=target_lab_f11,
            profile=profile,
            k1=k1,
            k2=k2
        )

    if enable_multistart and num_starts > 1:
        # Multi-start candidate initial points - all strictly projected to feasible set
        starts = [x0_nnls]
        # Uniform initial point
        try:
            x0_uniform = engine.project_to_feasible(
                [constraints_config.max_total_load / (2.0 * max(n_active, 1))] * n_active,
                candidate_keys
            ).tolist()
            starts.append(x0_uniform)
        except InfeasibleConstraintSet:
            pass

        # Perturbed initial point
        try:
            x0_pert = engine.project_to_feasible(
                [val * 1.25 if i == 0 else max(0.0, val * 0.75) for i, val in enumerate(x0_nnls)],
                candidate_keys
            ).tolist()
            starts.append(x0_pert)
        except InfeasibleConstraintSet:
            pass

        if num_starts > 3:
            rng = np.random.default_rng(42)
            for _ in range(num_starts - 3):
                # Simplex Dirichlet distribution ensures sum of weights is 1.0
                weights = rng.dirichlet(np.ones(n_active))
                load_fraction = float(rng.uniform(0.20, 0.90) * constraints_config.max_total_load)
                try:
                    rand_start = engine.project_to_feasible(weights * load_fraction, candidate_keys).tolist()
                    starts.append(rand_start)
                except InfeasibleConstraintSet:
                    pass

        best_res = None
        best_fun = float("inf")
        best_start_idx = 0

        for s_idx, st in enumerate(starts[:num_starts]):
            try:
                st_clamped = engine.project_to_feasible(st, candidate_keys).tolist()
            except InfeasibleConstraintSet:
                st_clamped = st
            res_cand = minimize(
                objective,
                st_clamped,
                method="SLSQP",
                bounds=bounds,
                constraints=constraints,
                options={"maxiter": 250, "eps": 1e-3, "ftol": 1e-6}
            )
            if res_cand.fun < best_fun or best_res is None:
                best_fun = float(res_cand.fun)
                best_res = res_cand
                best_start_idx = s_idx

        res = best_res
        multistart_meta = {"enabled": True, "num_starts_evaluated": len(starts[:num_starts]), "chosen_start_index": best_start_idx}
    else:
        res = minimize(
            objective,
            x0_nnls,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 250, "eps": 1e-3, "ftol": 1e-6}
        )
        multistart_meta = {"enabled": False, "num_starts_evaluated": 1, "chosen_start_index": 0}

    opt_raw = np.maximum(res.x, 0.0)

    # -------------------------------------------------------------------------
    # STAGE 2: Candidate Subsets Generation & Combinatorial Pre-Ranking
    # -------------------------------------------------------------------------
    # Effective minimum dispense threshold: configured gravimetric valve limit or 0.005% cutoff
    disp_threshold = max(constraints_config.min_dispense_threshold, 0.005)

    target_r_int = saunderson_correction(target_r, k1=k1, k2=k2)
    target_ks = reflectance_to_ks(target_r_int)
    base_ks = base_k / np.maximum(base_s, 1e-6)
    delta_ks_req = np.maximum(target_ks - base_ks, 0.0)

    # If candidate pool <= max_pastes, solve directly on full candidate pool
    if len(candidate_indices) <= max_pastes:
        subsets_to_evaluate = [list(candidate_indices)]
    else:
        # Combinatorial subset optimization:
        # Generate all pigment subsets of size k in [max(1, min(max_pastes, 2)), max_pastes]
        all_subsets = []
        for k in range(max(1, min(max_pastes, 2)), max_pastes + 1):
            for comb in itertools.combinations(candidate_indices, k):
                all_subsets.append(list(comb))

        # Spectral pre-ranking using NNLS residual on delta(K/S)
        subset_rankings = []
        for S in all_subsets:
            A_sub = paste_k_matrix[:, S] / np.maximum(base_s[:, None], 1e-6)
            c_sub, res_norm = nnls(A_sub, delta_ks_req)
            subset_rankings.append((S, float(res_norm)))

        subset_rankings.sort(key=lambda item: item[1])
        # Keep top subsets (up to 20 best spectral fits)
        subsets_to_evaluate = [item[0] for item in subset_rankings[:20]]

        # Also include the greedy top-concentration subset from raw global SLSQP
        sorted_raw = [
            p_idx for p_idx, _ in sorted(
                [(p, float(opt_raw[candidate_indices.index(p)])) for p in candidate_indices if opt_raw[candidate_indices.index(p)] >= disp_threshold],
                key=lambda kv: kv[1],
                reverse=True
            )[:max_pastes]
        ]
        if sorted_raw and sorted_raw not in subsets_to_evaluate:
            subsets_to_evaluate.insert(0, sorted_raw)

    # -------------------------------------------------------------------------
    # STAGE 3 & 4: Subsets Optimization, Slack Clamping, and Global Best Selection
    # -------------------------------------------------------------------------
    best_loss = float("inf")
    best_res = res
    best_matched_pastes = []
    best_final_concs_arr = np.zeros(len(candidate_indices), dtype=float)
    best_val_result = None

    for active_indices in subsets_to_evaluate:
        sub_keys = [str(available_pastes[idx].get("id", idx)) for idx in active_indices]

        # Initial starting vector for this subset: evaluate NNLS start and opt_raw start
        A_sub = paste_k_matrix[:, active_indices] / np.maximum(base_s[:, None], 1e-6)
        c_nnls, _ = nnls(A_sub, delta_ks_req)
        x0_nnls_sub = [float(c) for c in c_nnls]
        if sum(x0_nnls_sub) <= 0.0:
            x0_nnls_sub = [constraints_config.max_total_load / (2.0 * max(len(active_indices), 1))] * len(active_indices)
        try:
            x0_nnls_sub = engine.project_to_feasible(x0_nnls_sub, sub_keys).tolist()
        except InfeasibleConstraintSet:
            pass

        sub_x0 = x0_nnls_sub
        if all(opt_raw[candidate_indices.index(p)] > 1e-5 for p in active_indices):
            x0_opt_sub = [float(opt_raw[candidate_indices.index(p)]) for p in active_indices]
            try:
                x0_opt_sub = engine.project_to_feasible(x0_opt_sub, sub_keys).tolist()
            except InfeasibleConstraintSet:
                pass
            loss_opt = evaluate_recipe_objective(
                x0_opt_sub, active_indices, paste_k_matrix, paste_s_matrix, base_k, base_s,
                target_lab_d65, target_lab_a, target_lab_f11, profile, k1, k2
            )
            loss_nnls = evaluate_recipe_objective(
                x0_nnls_sub, active_indices, paste_k_matrix, paste_s_matrix, base_k, base_s,
                target_lab_d65, target_lab_a, target_lab_f11, profile, k1, k2
            )
            if loss_opt < loss_nnls:
                sub_x0 = x0_opt_sub

        sub_bounds = engine.build_scipy_bounds(sub_keys, default_upper_bound=constraints_config.max_total_load)
        sub_constraints = engine.build_scipy_constraints(sub_keys)

        def sub_obj(c_vec):
            return evaluate_recipe_objective(
                concs=c_vec,
                active_indices=active_indices,
                paste_k_matrix=paste_k_matrix,
                paste_s_matrix=paste_s_matrix,
                base_k=base_k,
                base_s=base_s,
                target_lab_d65=target_lab_d65,
                target_lab_a=target_lab_a,
                target_lab_f11=target_lab_f11,
                profile=profile,
                k1=k1,
                k2=k2
            )

        res_sub = minimize(
            sub_obj,
            sub_x0,
            method="SLSQP",
            bounds=sub_bounds,
            constraints=sub_constraints,
            options={"maxiter": 100, "eps": 1e-3, "ftol": 1e-6}
        )
        if res_sub.success:
            ref_x = np.maximum(res_sub.x, 0.0)
        else:
            ref_x = np.maximum(np.asarray(sub_x0, dtype=float), 0.0)

        # STAGE 4: Build candidate exact rounded final_dict for this subset
        cand_dict: dict[int, float] = {}
        for k, p_idx in enumerate(active_indices):
            c = float(ref_x[k])
            if c >= disp_threshold:
                cand_dict[p_idx] = round(c, 3)

        if not cand_dict and active_indices and constraints_config.min_total_load > 0.0:
            for k, p_idx in enumerate(active_indices):
                c = float(ref_x[k])
                if round(c, 3) > 0.0:
                    cand_dict[p_idx] = round(c, 3)

        # Post-rounding conservative slack adjustments to strictly satisfy bounds
        # 1. Total load upper clamp
        tot_rounded = sum(cand_dict.values())
        eff_max = constraints_config.max_total_load
        if tot_rounded > eff_max:
            excess = round(tot_rounded - eff_max, 3)
            if excess > 0 and cand_dict:
                max_p = max(cand_dict, key=cand_dict.get)
                cand_dict[max_p] = round(max(0.0, cand_dict[max_p] - excess), 3)

        # 2. Total load lower clamp (if min_total_load > 0)
        tot_rounded = sum(cand_dict.values())
        eff_min = constraints_config.min_total_load
        if eff_min > 0.0 and 0.0 < tot_rounded < eff_min:
            deficit = round(eff_min - tot_rounded, 3)
            if deficit > 0 and cand_dict:
                for p_idx in sorted(cand_dict, key=cand_dict.get, reverse=True):
                    k_str = str(available_pastes[p_idx].get("id", p_idx))
                    ub = constraints_config.individual_bounds.get(k_str, (0.0, eff_max))[1]
                    if cand_dict[p_idx] + deficit <= ub + 1e-5:
                        cand_dict[p_idx] = round(cand_dict[p_idx] + deficit, 3)
                        break

        # 3. Individual upper bounds clamp after rounding
        for p_idx, c in list(cand_dict.items()):
            k_str = str(available_pastes[p_idx].get("id", p_idx))
            if k_str in constraints_config.individual_bounds:
                ub = constraints_config.individual_bounds[k_str][1]
                if c > ub:
                    cand_dict[p_idx] = round(ub, 3)

        # 4. Group bounds clamp after rounding
        for grp_name, grp_limit in constraints_config.group_bounds.items():
            member_ids = set(constraints_config.pigment_groups.get(grp_name, []))
            grp_p_indices = [p_idx for p_idx in cand_dict if str(available_pastes[p_idx].get("id", p_idx)) in member_ids]
            grp_sum = sum(cand_dict[p_idx] for p_idx in grp_p_indices)
            if grp_sum > grp_limit:
                excess = round(grp_sum - grp_limit, 3)
                if excess > 0 and grp_p_indices:
                    max_grp_p = max(grp_p_indices, key=lambda idx: cand_dict[idx])
                    cand_dict[max_grp_p] = round(max(0.0, cand_dict[max_grp_p] - excess), 3)

        # Build candidate matched pastes list
        cand_matched_pastes = []
        for p_idx, conc in cand_dict.items():
            if conc > 0.0:
                p = available_pastes[p_idx]
                cand_matched_pastes.append({
                    "id": p["id"],
                    "name": p["name"],
                    "code": p.get("code", ""),
                    "hex": p.get("hex", "#777777"),
                    "concentration": float(conc),
                    "unit_k": p.get("unit_k"),
                    "unit_s": p.get("unit_s")
                })
        cand_matched_pastes.sort(key=lambda x: x["concentration"], reverse=True)

        # Build candidate final_concs_arr strictly from cand_matched_pastes
        cand_paste_map = {p["id"]: p["concentration"] for p in cand_matched_pastes}
        cand_final_concs_arr = np.array([
            cand_paste_map.get(available_pastes[idx]["id"], 0.0)
            for idx in candidate_indices
        ], dtype=float)

        # Validate candidate solution authoritatively against all physical/chemical/dispensing constraints
        cand_val_result = engine.validate_solution(
            cand_final_concs_arr, candidate_keys, max_pastes=max_pastes, check_dispense=True, check_max_pastes=True
        )

        if cand_val_result["is_valid"]:
            # Evaluate objective loss on exact rounded concentrations
            cand_loss = evaluate_recipe_objective(
                concs=[cand_paste_map.get(available_pastes[idx]["id"], 0.0) for idx in active_indices],
                active_indices=active_indices,
                paste_k_matrix=paste_k_matrix,
                paste_s_matrix=paste_s_matrix,
                base_k=base_k,
                base_s=base_s,
                target_lab_d65=target_lab_d65,
                target_lab_a=target_lab_a,
                target_lab_f11=target_lab_f11,
                profile=profile,
                k1=k1,
                k2=k2
            )
            if cand_loss < best_loss:
                best_loss = cand_loss
                best_res = res_sub
                best_matched_pastes = cand_matched_pastes
                best_final_concs_arr = cand_final_concs_arr
                best_val_result = cand_val_result

    # -------------------------------------------------------------------------
    # STAGE 5: Authoritative Final Validation on Winning Recipe Vector
    # -------------------------------------------------------------------------
    if best_val_result is not None:
        matched_pastes = best_matched_pastes
        final_concs_arr = best_final_concs_arr
        val_result = best_val_result
    else:
        # If no evaluated subset was valid, perform terminal validation on zero vector
        val_result = engine.validate_solution(
            np.zeros(len(candidate_indices), dtype=float),
            candidate_keys,
            max_pastes=max_pastes,
            check_dispense=True,
            check_max_pastes=True
        )
        matched_pastes = []
        final_concs_arr = np.zeros(len(candidate_indices), dtype=float)

    slack_info = val_result["slack_info"]

    # Final diagnostic status evaluation based on authoritative validation:
    # If final solution fails constraint validation, DO NOT return an unusable recipe!
    if not val_result["is_valid"]:
        return {
            "profile_id": profile.id,
            "profile_name": profile.name,
            "description": profile.description,
            "matched_pastes": [],
            "prediction": None,
            "delta_e00": 99.0,
            "composite_mi": 99.0,
            "total_load": 0.0,
            "passed_target_threshold": False,
            "status": "INFEASIBLE_CONSTRAINT_SET",
            "formulation_gate": {
                "overall_pass": False,
                "de_pass": False,
                "mi_pass": False,
                "load_pass": False,
                "min_load_pass": False,
                "solver_pass": False,
                "failures": val_result.get("violations", ["Constraints infeasible or contradictory."])
            },
            "quality_gate": {
                "overall_pass": False,
                "de_pass": False,
                "mi_pass": False,
                "load_pass": False,
                "min_load_pass": False,
                "solver_pass": False,
                "failures": val_result.get("violations", ["Constraints infeasible or contradictory."])
            },
            "diagnostics": {
                "solver": "SLSQP",
                "iterations": int(getattr(res, "nit", 0)),
                "function_evaluations": int(getattr(res, "nfev", 0)),
                "success": False,
                "message": "Optimization ended in an infeasible constraint state; recipe discarded.",
                "final_loss": 999.0,
                "constraint_slack": 0.0,
                "slack_details": slack_info,
                "constraint_validation": val_result,
                "multistart": multistart_meta
            },
            "sensitivity_matrix": {}
        }

    # Determine solver convergence status
    if res.success:
        diag_status = "OPTIMAL_CONVERGED"
    elif res.status == 9:
        diag_status = "MAX_ITERATIONS"
    else:
        diag_status = "FEASIBLE_LOCAL_MIN"

    # -------------------------------------------------------------------------
    # STAGE 6: Simulation & Recipe Generation
    # -------------------------------------------------------------------------
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
        max_total_load=constraints_config.max_total_load,
        min_total_load=constraints_config.min_total_load,
        solver_status=diag_status,
        constraint_slack=float(constraints_config.max_total_load - sim["total_colorant_load"]),
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
            "constraint_slack": round(float(constraints_config.max_total_load - sim["total_colorant_load"]), 3),
            "slack_details": slack_info,
            "constraint_validation": val_result,
            "multistart": multistart_meta
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
    profile_id: str | None = None,
    constraints: FormulationConstraints | None = None,
    enable_multistart: bool = False,
    num_starts: int = 3
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
        constraints: Optional FormulationConstraints configuration
        enable_multistart: Whether to run multi-start SLSQP to guard against CIEDE2000 local minima
        num_starts: Number of initial starting points to evaluate when enable_multistart is True

    Returns:
        Structured response with calculation_id, engine_version, primary recipe, 3 alternatives, diagnostics.
    """
    n_pastes = len(available_pastes)
    if n_pastes == 0:
        raise ValueError("No available pastes provided for matching.")

    if constraints is None:
        constraints = FormulationConstraints(max_total_load=max_total_load, max_pastes=max_pastes)
    else:
        max_total_load = constraints.max_total_load
        if constraints.max_pastes is None:
            constraints.max_pastes = max_pastes

    calculation_id = f"calc_{uuid.uuid4().hex[:12]}"

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

    # Multi-Domain Signed Spectral Candidate Pre-Screening:
    # 1. Primary NNLS positive absorption demand:
    #    delta_ks_req = max(target_ks - base_ks, 0) identifies primary absorption colorants.
    delta_ks_req = np.maximum(target_ks - base_ks, 0.0)
    initial_sol, _ = nnls(A, delta_ks_req)
    positive_indices = [idx for idx in np.argsort(initial_sol)[::-1] if initial_sol[idx] > 0.001]

    # 2. Signed spectral magnitude demand:
    #    Captures bidirectional absorption/scattering demand across wavelengths.
    abs_delta_ks = np.abs(target_ks - base_ks)
    abs_sol, _ = nnls(A, abs_delta_ks)
    abs_indices = [idx for idx in np.argsort(abs_sol)[::-1] if abs_sol[idx] > 0.001]

    # 3. Lightening and scattering demand:
    r_base_int = ks_to_reflectance(base_ks)
    lightening_demand = np.maximum(target_r_int - r_base_int, 0.0)
    has_lightening = bool(np.any(lightening_demand > 0.005))
    if has_lightening:
        scat_sol, _ = nnls(paste_s_matrix, lightening_demand)
    else:
        scat_sol = np.zeros(n_pastes)

    spec_scores = []
    for i in range(n_pastes):
        uk = paste_k_matrix[:, i]
        us = paste_s_matrix[:, i]
        scat_score = float(scat_sol[i]) + (float(np.dot(us, lightening_demand)) if has_lightening else 0.0)
        norm_a = float(np.linalg.norm(A[:, i]))
        norm_d = float(np.linalg.norm(abs_delta_ks))
        shape_corr = float(np.dot(A[:, i], abs_delta_ks)) / (norm_a * norm_d + 1e-6) if norm_a > 1e-6 and norm_d > 1e-6 else 0.0
        w_pos = 3.0 if initial_sol[i] > 0.001 else 0.0
        w_abs = 2.0 if abs_sol[i] > 0.001 else 0.0
        composite_score = 15.0 * scat_score + 5.0 * shape_corr + w_pos + w_abs
        spec_scores.append((i, composite_score))

    sorted_by_spec = [kv[0] for kv in sorted(spec_scores, key=lambda kv: kv[1], reverse=True)]

    # Candidate pool sizing:
    # For standard industrial dispensing machines (N <= 12 colorant canisters),
    # retain all available canisters to guarantee 100% candidate recall.
    # For large industrial databases (N > 12), retain top K + 6 (min 12) candidate colorants.
    if n_pastes <= max(max_pastes + 6, 12):
        candidate_indices = list(range(n_pastes))
    else:
        merged_indices = list(positive_indices)
        for cand_idx in abs_indices:
            if cand_idx not in merged_indices:
                merged_indices.append(cand_idx)
        for cand_idx in sorted_by_spec:
            if cand_idx not in merged_indices:
                merged_indices.append(cand_idx)
        pool_size = min(len(merged_indices), max(max_pastes + 6, 12))
        candidate_indices = merged_indices[:pool_size]

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
        k2=k2,
        constraints_config=constraints,
        enable_multistart=enable_multistart,
        num_starts=num_starts
    )
    recipe_a["calculation_id"] = calculation_id
    recipe_a["engine_version"] = ENGINE_VERSION

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
        k2=k2,
        constraints_config=constraints,
        enable_multistart=enable_multistart,
        num_starts=num_starts
    )
    recipe_b["calculation_id"] = calculation_id
    recipe_b["engine_version"] = ENGINE_VERSION

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
        k2=k2,
        constraints_config=constraints,
        enable_multistart=enable_multistart,
        num_starts=num_starts
    )
    recipe_c["calculation_id"] = calculation_id
    recipe_c["engine_version"] = ENGINE_VERSION

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
        "calculation_id": calculation_id,
        "engine_version": ENGINE_VERSION,
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
        "screened_candidate_ids": [available_pastes[idx]["id"] for idx in candidate_indices],
        "recipes": {
            "recipe_a": recipe_a,
            "recipe_b": recipe_b,
            "recipe_c": recipe_c
        }
    }
