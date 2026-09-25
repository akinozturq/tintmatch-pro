"""
Kubelka-Munk Spectral Calculation Engine
========================================
Implements Single-Constant and Two-Constant Kubelka-Munk theory,
Saunderson-integrated spectral forward models, contrast ratio / opacity checks,
and multi-concentration letdown characterization with least-squares optimization.
"""

import numpy as np
from scipy.optimize import minimize, nnls
from .constants import WAVELENGTHS, N_WAVELENGTHS
from .saunderson import saunderson_correction, inverse_saunderson
from .colorimetry import reflectance_to_lab, ciede2000
from .quality_gate import evaluate_quality_gate


def reflectance_to_ks(r_internal: np.ndarray | list[float]) -> np.ndarray:
    """
    Computes Kubelka-Munk K/S (Absorption over Scattering) ratio from internal reflectance:
    K/S = (1 - R_inf)^2 / (2 * R_inf)
    """
    r = np.asarray(r_internal, dtype=float)
    r_safe = np.clip(r, 0.0001, 0.9999)
    return ((1.0 - r_safe) ** 2) / (2.0 * r_safe)


def ks_to_reflectance(ks: np.ndarray | list[float]) -> np.ndarray:
    """
    Inverts K/S ratio to internal reflectance R_inf:
    R_inf = 1 + (K/S) - sqrt((K/S)^2 + 2*(K/S))
    """
    val = np.asarray(ks, dtype=float)
    val_safe = np.maximum(val, 0.0)
    r = 1.0 + val_safe - np.sqrt(val_safe ** 2 + 2.0 * val_safe)
    return np.clip(r, 0.0, 1.0)


def forward_two_constant_km(
    K: np.ndarray | list[float],
    S: np.ndarray | list[float],
    thickness: float = 100.0,
    Rg: float | np.ndarray = 0.0,
    k1: float = 0.04,
    k2: float = 0.60,
    apply_saunderson: bool = True
) -> np.ndarray:
    """
    Two-Constant Kubelka-Munk forward prediction for non-opaque or finite film thickness.

    R_internal = [1 - Rg * (a - b * coth(b*S*x))] / [a + b * coth(b*S*x) - Rg]
    where:
      a = 1 + K/S
      b = sqrt(a^2 - 1)
      x = thickness in micrometers (normalized scale)
    """
    k_arr = np.asarray(K, dtype=float)
    s_arr = np.asarray(S, dtype=float)
    rg_arr = np.asarray(Rg, dtype=float)

    # Detect near-zero scattering (transparent limit, Beer-Lambert law)
    is_clear = s_arr < 1e-5
    s_safe = np.where(is_clear, 1e-5, s_arr)

    a = 1.0 + k_arr / s_safe
    b = np.sqrt(np.maximum(a ** 2 - 1.0, 0.0))
    bS = b * s_safe

    optical_x = (thickness / 100.0) * 25.0

    # Argument to hyperbolic cotangent
    y = np.clip(bS * optical_x, 1e-7, 60.0)

    # coth(y) = (e^y + e^-y) / (e^y - e^-y)
    exp_pos = np.exp(y)
    exp_neg = np.exp(-y)
    denom_coth = np.maximum(exp_pos - exp_neg, 1e-10)
    coth_y = (exp_pos + exp_neg) / denom_coth

    b_coth_y = b * coth_y
    # As bS -> 0, b * coth(y) approaches 1 / (S * optical_x)
    small_bS = bS < 1e-6
    limit_b_coth_y = 1.0 / np.maximum(s_safe * optical_x, 1e-9)
    b_coth_y = np.where(small_bS, limit_b_coth_y, b_coth_y)

    num = 1.0 - rg_arr * (a - b_coth_y)
    denom = a + b_coth_y - rg_arr
    denom = np.where(np.abs(denom) < 1e-9, 1e-9, denom)

    r_internal = num / denom

    # Handle pure transparent limit (Beer-Lambert: R = Rg * exp(-2*K*x))
    r_beer = rg_arr * np.exp(-2.0 * k_arr * optical_x)
    r_internal = np.where(is_clear, r_beer, r_internal)
    r_internal = np.clip(r_internal, 0.0, 0.9999)

    if apply_saunderson:
        return inverse_saunderson(r_internal, k1=k1, k2=k2)
    return r_internal


def calculate_opacity_contrast_ratio(
    K: np.ndarray,
    S: np.ndarray,
    thickness: float = 100.0,
    k1: float = 0.04,
    k2: float = 0.60
) -> dict:
    """
    Computes spectral contrast ratio over black substrate (Rg=0.04) and white substrate (Rg=0.82)
    and overall luminous Y-contrast ratio (ISO 2814 / ASTM D2805).
    Opacity >= 98.0% denotes complete hiding.
    """
    r_black = forward_two_constant_km(K, S, thickness=thickness, Rg=0.04, k1=k1, k2=k2)
    r_white = forward_two_constant_km(K, S, thickness=thickness, Rg=0.82, k1=k1, k2=k2)

    spectral_cr = (r_black / np.maximum(r_white, 1e-6)) * 100.0
    spectral_cr = np.clip(spectral_cr, 0.0, 100.0)

    # Luminous Y value for black and white
    from .colorimetry import reflectance_to_xyz
    _, Y_black, _ = reflectance_to_xyz(r_black, illuminant="D65", observer="10")
    _, Y_white, _ = reflectance_to_xyz(r_white, illuminant="D65", observer="10")

    luminous_cr = float(np.clip((Y_black / max(Y_white, 1e-6)) * 100.0, 0.0, 100.0))
    is_opaque = luminous_cr >= 98.0

    return {
        "luminous_contrast_ratio": round(luminous_cr, 2),
        "is_opaque": is_opaque,
        "spectral_contrast_ratio": [round(float(v), 2) for v in spectral_cr],
        "reflectance_black": [round(float(v), 4) for v in r_black],
        "reflectance_white": [round(float(v), 4) for v in r_white],
        "status": "PASS - Complete Hiding (≥98%)" if is_opaque else f"PARTIAL - Semi-transparent ({luminous_cr:.1f}%)"
    }


def calculate_km_jacobian_condition(
    concs: np.ndarray,
    base_k: np.ndarray,
    base_s: np.ndarray,
    unit_k: np.ndarray,
    unit_s: np.ndarray,
    k1: float = 0.04,
    k2: float = 0.60
) -> dict:
    """
    Computes both scaled and raw 2-constant Kubelka-Munk Jacobian condition numbers.
    Evaluates J = [∂R_m/∂K_p, ∂R_m/∂S_p] across letdown concentrations and wavelengths.
    Returns:
        dict with 'scaled_condition_number', 'raw_condition_number', 'condition_number', and 'status'.
    """
    c_arr = np.asarray(concs, dtype=float)
    if len(c_arr) < 2:
        return {
            "scaled_condition_number": 999.0,
            "raw_condition_number": 999.0,
            "condition_number": 999.0,
            "status": "SEVERELY_ILL_CONDITIONED"
        }

    scaled_conds = []
    raw_conds = []
    n_wl = len(base_k)

    for wl_idx in range(n_wl):
        bk = float(base_k[wl_idx])
        bs = float(base_s[wl_idx])
        uk = float(unit_k[wl_idx])
        us = float(unit_s[wl_idx])

        J_scaled = np.zeros((len(c_arr), 2), dtype=float)
        J_raw = np.zeros((len(c_arr), 2), dtype=float)

        for i, c in enumerate(c_arr):
            K = max(bk + c * uk, 1e-6)
            S = max(bs + c * us, 1e-6)
            theta = K / S
            a = 1.0 + theta
            b = np.sqrt(max(a * a - 1.0, 1e-8))
            R_i = max(a - b, 1e-6)

            dRi_dtheta = 1.0 - a / b
            denom = max((1.0 - k2 * R_i) ** 2, 1e-6)
            dRm_dRi = (1.0 - k1) * (1.0 - k2) / denom
            factor = dRm_dRi * dRi_dtheta

            dtheta_dKp = c / S
            dtheta_dSp = -c * theta / S

            scale_k = max(uk, 0.01)
            scale_s = max(us, 0.01)

            J_raw[i, 0] = factor * dtheta_dKp
            J_raw[i, 1] = factor * dtheta_dSp

            J_scaled[i, 0] = factor * dtheta_dKp * scale_k
            J_scaled[i, 1] = factor * dtheta_dSp * scale_s

        try:
            c_s = np.linalg.cond(J_scaled)
            if not np.isnan(c_s) and not np.isinf(c_s):
                scaled_conds.append(c_s)
        except Exception:
            pass

        try:
            c_r = np.linalg.cond(J_raw)
            if not np.isnan(c_r) and not np.isinf(c_r):
                raw_conds.append(c_r)
        except Exception:
            pass

    scaled_val = round(float(np.median(scaled_conds)), 2) if scaled_conds else 999.0
    raw_val = round(float(np.median(raw_conds)), 2) if raw_conds else 999.0
    p95_scaled = round(float(np.percentile(scaled_conds, 95)), 2) if scaled_conds else 999.0
    max_scaled = round(float(np.max(scaled_conds)), 2) if scaled_conds else 999.0
    worst_idx = int(np.argmax(scaled_conds)) if scaled_conds else 0
    worst_wl = int(WAVELENGTHS[worst_idx]) if scaled_conds else 400

    if scaled_val <= 250.0 and max_scaled <= 2000.0:
        status_str = "WELL_CONDITIONED"
    elif scaled_val <= 1000.0:
        status_str = "MODERATELY_ILL_CONDITIONED"
    else:
        status_str = "SEVERELY_ILL_CONDITIONED"

    return {
        "scaled_condition_number": scaled_val,
        "raw_condition_number": raw_val,
        "condition_number": scaled_val,
        "p95_condition_number": p95_scaled,
        "max_condition_number": max_scaled,
        "worst_wavelength_nm": worst_wl,
        "status": status_str
    }


def _fit_spectral_ks(
    concs: np.ndarray,
    r_int_list: list[np.ndarray],
    ks_meas_list: list[np.ndarray],
    base_k: np.ndarray,
    base_s: np.ndarray,
    base_ks_calc: np.ndarray,
    use_two_constant: bool = True
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fits unit_k, unit_s, and unit_ks across wavelengths using non-negative least squares and L-BFGS-B."""
    n_samples = len(concs)
    unit_k = np.zeros(N_WAVELENGTHS, dtype=float)
    unit_s = np.zeros(N_WAVELENGTHS, dtype=float)
    unit_ks = np.zeros(N_WAVELENGTHS, dtype=float)

    for i in range(N_WAVELENGTHS):
        ks_obs = np.array([ks_meas_list[j][i] for j in range(n_samples)])
        delta_ks = ks_obs - base_ks_calc[i]

        slope, _ = nnls(concs[:, np.newaxis], delta_ks)
        unit_ks[i] = max(0.0, float(slope[0]))

        if use_two_constant and n_samples >= 2:
            k_base_i = base_k[i]
            s_base_i = base_s[i]
            r_target_i = np.array([r_int_list[j][i] for j in range(n_samples)])

            def obj_wl(params):
                kp, sp = params
                pred_ks = (k_base_i + concs * kp) / np.maximum(s_base_i + concs * sp, 1e-6)
                r_pred = ks_to_reflectance(pred_ks)
                return np.sum((r_pred - r_target_i) ** 2)

            init_kp = unit_ks[i] * s_base_i
            init_sp = 0.02
            bounds = [(0.0, 60.0), (0.0, 10.0)]

            res = minimize(obj_wl, [init_kp, init_sp], method="L-BFGS-B", bounds=bounds, options={"maxiter": 300, "ftol": 1e-9})
            if res.success:
                unit_k[i] = max(0.0, float(res.x[0]))
                unit_s[i] = max(0.0, float(res.x[1]))
            else:
                unit_k[i] = max(0.0, float(init_kp))
                unit_s[i] = max(0.0, float(init_sp))
        else:
            unit_k[i] = unit_ks[i] * base_s[i]
            unit_s[i] = 0.0

    return unit_k, unit_s, unit_ks


def characterize_letdown_series(
    base_reflectance: np.ndarray | list[float],
    letdowns: list[dict],
    k1: float = 0.04,
    k2: float = 0.60,
    base_k: np.ndarray | None = None,
    base_s: np.ndarray | None = None,
    use_two_constant: bool = True
) -> dict:
    """
    Characterizes a colorant paste from a multi-concentration dilution series (letdowns).

    Args:
        base_reflectance: 31-point measured reflectance of the un-tinted base paint (Base A, B, C, or D)
        letdowns: List of dicts, each containing:
            - 'concentration': float (percentage, e.g. 0.1, 0.5, 1.0, 2.5, 5.0, 10.0)
            - 'reflectance': list of 31 float numbers (measured R%)
        k1: Fresnel surface constant (default 0.04)
        k2: Internal reflection constant (default 0.60)
        base_k: Pre-calibrated base K array (optional)
        base_s: Pre-calibrated base S array (optional, defaults to 1.0 for White Base A)
        use_two_constant: Whether to optimize both K(lambda) and S(lambda)

    Returns:
        Dictionary containing:
        - unit_k: 31-point unit absorption spectrum per 1% concentration
        - unit_s: 31-point unit scattering spectrum per 1% concentration
        - unit_ks: 31-point unit K/S spectrum per 1% concentration
        - back_predictions: List of predicted curves and CIEDE2000 residuals per letdown
        - mean_delta_e00: Average CIEDE2000 across the series
        - max_delta_e00: Maximum CIEDE2000 across the series
        - passed_validation: True if mean_delta_e00 < 0.3
        - r_squared: Spectral goodness-of-fit coefficient
    """
    base_r_raw = np.asarray(base_reflectance, dtype=float)
    base_r_raw = np.clip(base_r_raw, 0.001, 0.999)

    # 1. Saunderson correction on Base
    base_r_int = saunderson_correction(base_r_raw, k1=k1, k2=k2)
    base_ks_calc = reflectance_to_ks(base_r_int)

    # Base scattering default: 1.0 (arbitrary reference for white base)
    if base_s is None:
        base_s = np.ones(N_WAVELENGTHS, dtype=float)
    else:
        base_s = np.asarray(base_s, dtype=float)

    if base_k is None:
        base_k = base_ks_calc * base_s
    else:
        base_k = np.asarray(base_k, dtype=float)

    # 2. Extract letdown data
    concs = []
    r_meas_list = []
    r_int_list = []
    ks_meas_list = []

    for item in letdowns:
        raw_c = item.get("concentration")
        if raw_c is None:
            continue
        c = float(raw_c)
        if c <= 0:
            continue
        r_m = np.asarray(item["reflectance"], dtype=float)
        # Check if values are in 0..100% scale instead of 0..1
        if np.max(r_m) > 1.5:
            r_m = r_m / 100.0
        r_m = np.clip(r_m, 0.001, 0.999)

        r_int = saunderson_correction(r_m, k1=k1, k2=k2)
        ks_m = reflectance_to_ks(r_int)

        concs.append(c)
        r_meas_list.append(r_m)
        r_int_list.append(r_int)
        ks_meas_list.append(ks_m)

    concs = np.array(concs, dtype=float)
    n_letdowns = len(concs)
    if n_letdowns == 0:
        raise ValueError("At least one letdown measurement is required.")

    unit_k = np.zeros(N_WAVELENGTHS, dtype=float)
    unit_s = np.zeros(N_WAVELENGTHS, dtype=float)
    unit_ks = np.zeros(N_WAVELENGTHS, dtype=float)

    # 3. Solve for each wavelength across all concentrations
    # Model: (K/S)_mix(c) = (K_base + c * K_paste) / (S_base + c * S_paste)
    unit_k, unit_s, unit_ks = _fit_spectral_ks(
        concs, r_int_list, ks_meas_list,
        base_k, base_s, base_ks_calc,
        use_two_constant=use_two_constant
    )

    # 4. Back-Prediction and CIEDE2000 Validation
    back_predictions = []
    delta_e_list = []
    total_sse = 0.0
    total_var = 0.0

    for j in range(n_letdowns):
        c = concs[j]
        meas_r = r_meas_list[j]

        # Predict mixture internal K/S
        if use_two_constant and np.any(unit_s > 0):
            mix_k = base_k + c * unit_k
            mix_s = base_s + c * unit_s
            pred_ks = mix_k / np.maximum(mix_s, 1e-6)
        else:
            pred_ks = base_ks_calc + c * unit_ks

        pred_r_int = ks_to_reflectance(pred_ks)
        pred_r_meas = inverse_saunderson(pred_r_int, k1=k1, k2=k2)

        # Color difference evaluation
        lab_meas = reflectance_to_lab(meas_r, illuminant="D65", observer="10")
        lab_pred = reflectance_to_lab(pred_r_meas, illuminant="D65", observer="10")
        diff = ciede2000(lab_meas, lab_pred)

        delta_e = diff["delta_e00"]
        delta_e_list.append(delta_e)

        # Spectral sum of squared errors
        diff_curve = meas_r - pred_r_meas
        sse = float(np.sum(diff_curve ** 2))
        total_sse += sse
        total_var += float(np.sum((meas_r - np.mean(meas_r)) ** 2))

        back_predictions.append({
            "concentration": c,
            "measured_reflectance": [round(float(v), 4) for v in meas_r],
            "predicted_reflectance": [round(float(v), 4) for v in pred_r_meas],
            "measured_lab": [round(float(v), 2) for v in lab_meas],
            "predicted_lab": [round(float(v), 2) for v in lab_pred],
            "delta_e00": delta_e,
            "delta_L": diff.get("delta_L", 0.0),
            "delta_a": diff.get("delta_a", 0.0),
            "delta_b": diff.get("delta_b", 0.0),
            "delta_C": diff.get("delta_C", 0.0),
            "delta_H": diff.get("delta_H", 0.0),
            "max_residual": round(float(np.max(np.abs(diff_curve))), 4),
            "passed": delta_e < 0.3,
            "status": "PASS (<0.3)" if delta_e < 0.3 else ("WARNING (<0.6)" if delta_e < 0.6 else "RECHECK")
        })

    mean_de00 = float(np.mean(delta_e_list))
    max_de00 = float(np.max(delta_e_list))
    r_squared = float(max(0.0, 1.0 - (total_sse / max(total_var, 1e-9))))
    spectral_rmse = float(np.sqrt(total_sse / max(n_letdowns * N_WAVELENGTHS, 1)))
    max_spec_res = float(np.max([bp["max_residual"] for bp in back_predictions])) if back_predictions else 0.0

    # Directional residuals (mean across series)
    mean_dir_res = {
        "delta_L": round(float(np.mean([bp["delta_L"] for bp in back_predictions])), 2),
        "delta_a": round(float(np.mean([bp["delta_a"] for bp in back_predictions])), 2),
        "delta_b": round(float(np.mean([bp["delta_b"] for bp in back_predictions])), 2),
        "delta_C": round(float(np.mean([bp["delta_C"] for bp in back_predictions])), 2),
        "delta_H": round(float(np.mean([bp["delta_H"] for bp in back_predictions])), 2)
    }

    # 5. Out-of-sample Leave-One-Out Cross-Validation (LOOCV)
    # Minimum 4 letdown concentrations required so each fold retains at least 3 points with df > 0
    if n_letdowns >= 4:
        loocv_errors = []
        loocv_fold_results = []
        for h in range(n_letdowns):
            train_idx = [idx for idx in range(n_letdowns) if idx != h]
            train_concs = concs[train_idx]
            train_r_int = [r_int_list[idx] for idx in train_idx]
            train_ks_meas = [ks_meas_list[idx] for idx in train_idx]

            fold_k, fold_s, fold_ks = _fit_spectral_ks(
                train_concs, train_r_int, train_ks_meas,
                base_k, base_s, base_ks_calc,
                use_two_constant=use_two_constant
            )

            # Predict held-out sample
            c_held = concs[h]
            if use_two_constant and np.any(fold_s > 0):
                held_mix_k = base_k + c_held * fold_k
                held_mix_s = base_s + c_held * fold_s
                held_pred_ks = held_mix_k / np.maximum(held_mix_s, 1e-6)
            else:
                held_pred_ks = base_ks_calc + c_held * fold_ks

            held_pred_r_int = ks_to_reflectance(held_pred_ks)
            held_pred_r_meas = inverse_saunderson(held_pred_r_int, k1=k1, k2=k2)

            lab_held_meas = reflectance_to_lab(r_meas_list[h], illuminant="D65", observer="10")
            lab_held_pred = reflectance_to_lab(held_pred_r_meas, illuminant="D65", observer="10")
            diff_h = ciede2000(lab_held_meas, lab_held_pred)
            de00_h = round(float(diff_h["delta_e00"]), 3)
            loocv_errors.append(de00_h)
            loocv_fold_results.append({
                "omitted_index": h,
                "omitted_concentration": round(float(concs[h]), 4),
                "delta_e00": de00_h,
                "predicted_lab": [round(float(v), 2) for v in lab_held_pred],
                "measured_lab": [round(float(v), 2) for v in lab_held_meas]
            })

        loocv_mean_de00 = float(np.mean(loocv_errors))
        loocv_max_de00 = float(np.max(loocv_errors))
        loocv_result = {
            "status": "LOOCV_EVALUATED",
            "samples_count": n_letdowns,
            "mean_delta_e00": round(loocv_mean_de00, 3),
            "max_delta_e00": round(loocv_max_de00, 3),
            "errors": loocv_errors,
            "fold_results": loocv_fold_results
        }
    else:
        loocv_result = {
            "status": "LOOCV_SKIPPED_INSUFFICIENT_LETDOWNS",
            "samples_count": n_letdowns,
            "mean_delta_e00": None,
            "max_delta_e00": None,
            "errors": [],
            "fold_results": [],
            "message": f"LOOCV requires n >= 4 letdown concentrations (provided: {n_letdowns})."
        }

    # Numerical conditioning & parameter identifiability
    pos_concs = concs[concs > 0]
    span_ratio = float(np.max(pos_concs) / max(np.min(pos_concs), 1e-4)) if len(pos_concs) > 0 else 1.0
    jac_res = calculate_km_jacobian_condition(pos_concs, base_k, base_s, unit_k, unit_s, k1=k1, k2=k2)
    jac_cond = jac_res["scaled_condition_number"]

    if n_letdowns >= 3 and jac_cond <= 250.0 and span_ratio >= 10.0:
        identifiability = "ROBUST - Well Conditioned"
    elif n_letdowns >= 2 and jac_cond <= 1000.0:
        identifiability = "ACCEPTABLE"
    else:
        identifiability = "POOR - Ill-Conditioned"

    # Contrast ratio of base paint
    cr_info = calculate_opacity_contrast_ratio(base_k, base_s, thickness=100.0, k1=k1, k2=k2)
    base_cr = cr_info["luminous_contrast_ratio"]

    from .quality_gate import evaluate_characterization_gate
    qg_result = evaluate_characterization_gate(
        mean_de00=mean_de00,
        max_de00=max_de00,
        r_squared=r_squared,
        spectral_rmse=spectral_rmse,
        contrast_ratio=base_cr,
        letdown_count=n_letdowns,
        max_spectral_residual=max_spec_res,
        directional_residuals=mean_dir_res,
        loocv_result=loocv_result
    )

    return {
        "unit_k": [round(float(v), 5) for v in unit_k],
        "unit_s": [round(float(v), 5) for v in unit_s],
        "unit_ks": [round(float(v), 5) for v in unit_ks],
        "wavelengths": WAVELENGTHS.tolist(),
        "back_predictions": back_predictions,
        "mean_delta_e00": round(mean_de00, 3),
        "max_delta_e00": round(max_de00, 3),
        "spectral_rmse": round(spectral_rmse, 4),
        "max_spectral_residual": round(max_spec_res, 4),
        "jacobian_condition_number": jac_cond,
        "jacobian_diagnostics": jac_res,
        "concentration_span_ratio": round(span_ratio, 2),
        "condition_index": round(span_ratio, 2),
        "identifiability": identifiability,
        "loocv": loocv_result,
        "loocv_mean_delta_e00": loocv_result.get("mean_delta_e00"),
        "loocv_max_delta_e00": loocv_result.get("max_delta_e00"),
        "loocv_status": loocv_result.get("status"),
        "passed_validation": qg_result["status"] == "PASS",
        "r_squared": round(r_squared, 4),
        "validation_threshold": 0.3,
        "model_type": "Two-Constant Kubelka-Munk" if use_two_constant else "Single-Constant K/S",
        "characterization_gate": qg_result,
        "quality_gate": qg_result,
        "summary": "Industrial Validation PASSED (Calculation performed using ISO 18314-aligned colorimetric methodology)" if qg_result["status"] == "PASS" else f"Calibration Refinement Required (Mean ΔE00 = {mean_de00:.2f})"
    }
