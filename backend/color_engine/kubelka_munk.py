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
        c = float(item["concentration"])
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
    for i in range(N_WAVELENGTHS):
        ks_obs = np.array([ks_meas_list[j][i] for j in range(n_letdowns)])
        delta_ks = ks_obs - base_ks_calc[i]

        # Initial estimate of unit K/S via non-negative least squares: delta_ks ~= c * (K/S)_paste
        slope, _ = nnls(concs[:, np.newaxis], delta_ks)
        unit_ks[i] = max(0.0, float(slope[0]))

        if use_two_constant and n_letdowns >= 2:
            # Non-linear optimization for K_p and S_p at this wavelength
            # We want to minimize sum_j [( (K_base + c_j * K_p) / (S_base + c_j * S_p) - ks_obs_j )^2]
            k_base_i = base_k[i]
            s_base_i = base_s[i]

            r_target_i = np.array([r_int_list[j][i] for j in range(n_letdowns)])

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
        sse = float(np.sum((meas_r - pred_r_meas) ** 2))
        total_sse += sse
        total_var += float(np.sum((meas_r - np.mean(meas_r)) ** 2))

        back_predictions.append({
            "concentration": c,
            "measured_reflectance": [round(float(v), 4) for v in meas_r],
            "predicted_reflectance": [round(float(v), 4) for v in pred_r_meas],
            "measured_lab": [round(float(v), 2) for v in lab_meas],
            "predicted_lab": [round(float(v), 2) for v in lab_pred],
            "delta_e00": delta_e,
            "passed": delta_e < 0.3,
            "status": "PASS (<0.3)" if delta_e < 0.3 else ("WARNING (<0.6)" if delta_e < 0.6 else "RECHECK")
        })

    mean_de00 = float(np.mean(delta_e_list))
    max_de00 = float(np.max(delta_e_list))
    r_squared = float(max(0.0, 1.0 - (total_sse / max(total_var, 1e-9))))
    passed_validation = mean_de00 < 0.3

    return {
        "unit_k": [round(float(v), 5) for v in unit_k],
        "unit_s": [round(float(v), 5) for v in unit_s],
        "unit_ks": [round(float(v), 5) for v in unit_ks],
        "wavelengths": WAVELENGTHS.tolist(),
        "back_predictions": back_predictions,
        "mean_delta_e00": round(mean_de00, 3),
        "max_delta_e00": round(max_de00, 3),
        "passed_validation": passed_validation,
        "r_squared": round(r_squared, 4),
        "validation_threshold": 0.3,
        "model_type": "Two-Constant Kubelka-Munk" if use_two_constant else "Single-Constant K/S",
        "summary": "Industrial Validation PASSED (ΔE00 < 0.3)" if passed_validation else f"Requires Calibration Tuning (Mean ΔE00 = {mean_de00:.2f})"
    }
