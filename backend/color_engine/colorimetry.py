"""
Colorimetry and Color Difference Module
=======================================
Computes CIE XYZ, CIE L*a*b*, sRGB Hex values, CIEDE2000 (ΔE00), and Metamerism Index (MI).
Standard condition: D65 Illuminant / 10° Supplementary Observer (ASTM E308 / ISO 18314).
"""

import numpy as np
from .constants import (
    WAVELENGTHS,
    CIE_X_10,
    CIE_Y_10,
    CIE_Z_10,
    CIE_X_2,
    CIE_Y_2,
    CIE_Z_2,
    ILLUMINANT_D65,
    ILLUMINANT_A,
    ILLUMINANT_F11,
    ILLUMINANT_F2,
    ILLUMINANTS,
)
from .spectrum_normalizer import normalize_spectrum


def reflectance_to_xyz(
    reflectance: np.ndarray | list[float],
    illuminant: str = "D65",
    observer: str = "10",
    wavelengths: list[float] | np.ndarray | None = None
) -> tuple[float, float, float]:
    """
    Computes CIE XYZ tristimulus values from a 31-point spectral reflectance curve (400-700 nm).

    k = 100 / sum(S(lambda) * y_bar(lambda) * d_lambda)
    X = k * sum(S * R * x_bar)
    Y = k * sum(S * R * y_bar)
    Z = k * sum(S * R * z_bar)
    """
    r = normalize_spectrum(reflectance, wavelengths=wavelengths)

    # Select observer
    if observer == "2":
        x_bar, y_bar, z_bar = CIE_X_2, CIE_Y_2, CIE_Z_2
    else:
        x_bar, y_bar, z_bar = CIE_X_10, CIE_Y_10, CIE_Z_10

    # Select illuminant SPD
    spd = ILLUMINANTS.get(illuminant, ILLUMINANT_D65)

    k = 100.0 / np.sum(spd * y_bar)
    X = k * np.sum(spd * r * x_bar)
    Y = k * np.sum(spd * r * y_bar)
    Z = k * np.sum(spd * r * z_bar)

    return float(X), float(Y), float(Z)


def get_white_point(illuminant: str = "D65", observer: str = "10") -> tuple[float, float, float]:
    """Calculates reference white point (Xn, Yn=100.0, Zn) for the illuminant/observer pair."""
    perfect_white = np.ones(31, dtype=float)
    return reflectance_to_xyz(perfect_white, illuminant=illuminant, observer=observer)


def xyz_to_lab(
    X: float,
    Y: float,
    Z: float,
    Xn: float | None = None,
    Yn: float = 100.0,
    Zn: float | None = None,
    illuminant: str = "D65",
    observer: str = "10"
) -> tuple[float, float, float]:
    """
    Transforms CIE XYZ to CIE L*a*b* using standard cube-root transfer function.
    """
    if Xn is None or Zn is None:
        white_x, white_y, white_z = get_white_point(illuminant, observer)
        Xn = white_x if Xn is None else Xn
        Zn = white_z if Zn is None else Zn

    def f(t: float) -> float:
        delta = 6.0 / 29.0
        if t > delta ** 3:
            return float(np.cbrt(t))
        else:
            return float(t / (3.0 * delta ** 2) + 4.0 / 29.0)

    fx = f(X / Xn)
    fy = f(Y / Yn)
    fz = f(Z / Zn)

    L = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)

    return float(L), float(a), float(b)


def reflectance_to_lab(
    reflectance: np.ndarray | list[float],
    illuminant: str = "D65",
    observer: str = "10"
) -> tuple[float, float, float]:
    """Direct conversion from 31-point spectral reflectance to CIE L*a*b*."""
    X, Y, Z = reflectance_to_xyz(reflectance, illuminant=illuminant, observer=observer)
    return xyz_to_lab(X, Y, Z, illuminant=illuminant, observer=observer)


def xyz_to_srgb(X: float, Y: float, Z: float) -> tuple[int, int, int, str]:
    """
    Converts CIE XYZ (D65/2° or D65/10° approximated to sRGB D65) to sRGB [0..255] and hex '#RRGGBB'.
    Applies standard sRGB gamma companding.
    """
    # Scale XYZ from 0..100 to 0..1
    x = X / 100.0
    y = Y / 100.0
    z = Z / 100.0

    # sRGB matrix transformation (D65 standard)
    r_lin = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
    g_lin = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z
    b_lin = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z

    def gamma(c: float) -> float:
        c_clamped = max(0.0, min(1.0, c))
        if c_clamped <= 0.0031308:
            return 12.92 * c_clamped
        else:
            return 1.055 * (c_clamped ** (1.0 / 2.4)) - 0.055

    r = int(round(np.clip(gamma(r_lin) * 255.0, 0, 255)))
    g = int(round(np.clip(gamma(g_lin) * 255.0, 0, 255)))
    b = int(round(np.clip(gamma(b_lin) * 255.0, 0, 255)))

    hex_color = f"#{r:02x}{g:02x}{b:02x}"
    return r, g, b, hex_color


def reflectance_to_hex(reflectance: np.ndarray | list[float]) -> str:
    """Convenience helper to turn spectral reflectance directly into an accurate sRGB hex swatch."""
    X, Y, Z = reflectance_to_xyz(reflectance, illuminant="D65", observer="10")
    _, _, _, hex_code = xyz_to_srgb(X, Y, Z)
    return hex_code


def ciede2000(
    lab1: tuple[float, float, float] | list[float],
    lab2: tuple[float, float, float] | list[float],
    kL: float = 1.0,
    kC: float = 1.0,
    kH: float = 1.0
) -> dict:
    """
    Calculates CIEDE2000 (ΔE00) total color difference and sub-components.
    Standard industrial tolerance for CCM characterization validation is ΔE00 < 0.3.
    """
    L1, a1, b1 = float(lab1[0]), float(lab1[1]), float(lab1[2])
    L2, a2, b2 = float(lab2[0]), float(lab2[1]), float(lab2[2])

    # 1. Calculate C_i and mean C
    C1 = np.sqrt(a1 ** 2 + b1 ** 2)
    C2 = np.sqrt(a2 ** 2 + b2 ** 2)
    C_bar = (C1 + C2) / 2.0

    C_bar_7 = C_bar ** 7
    G = 0.5 * (1.0 - np.sqrt(C_bar_7 / (C_bar_7 + 25.0 ** 7)))

    a1_prime = (1.0 + G) * a1
    a2_prime = (1.0 + G) * a2

    C1_prime = np.sqrt(a1_prime ** 2 + b1 ** 2)
    C2_prime = np.sqrt(a2_prime ** 2 + b2 ** 2)

    def compute_h_prime(a_p: float, b_p: float) -> float:
        if a_p == 0.0 and b_p == 0.0:
            return 0.0
        deg = np.degrees(np.arctan2(b_p, a_p))
        return deg + 360.0 if deg < 0.0 else deg

    h1_prime = compute_h_prime(a1_prime, b1)
    h2_prime = compute_h_prime(a2_prime, b2)

    # 2. Differences
    delta_L_prime = L2 - L1
    delta_C_prime = C2_prime - C1_prime

    if C1_prime * C2_prime == 0.0:
        delta_h_prime = 0.0
    else:
        diff_h = h2_prime - h1_prime
        if abs(diff_h) <= 180.0:
            delta_h_prime = diff_h
        elif diff_h > 180.0:
            delta_h_prime = diff_h - 360.0
        else:
            delta_h_prime = diff_h + 360.0

    delta_H_prime = 2.0 * np.sqrt(C1_prime * C2_prime) * np.sin(np.radians(delta_h_prime / 2.0))

    # 3. Mean values
    L_bar_prime = (L1 + L2) / 2.0
    C_bar_prime = (C1_prime + C2_prime) / 2.0

    if C1_prime * C2_prime == 0.0:
        h_bar_prime = h1_prime + h2_prime
    else:
        abs_diff = abs(h1_prime - h2_prime)
        sum_h = h1_prime + h2_prime
        if abs_diff <= 180.0:
            h_bar_prime = sum_h / 2.0
        elif sum_h < 360.0:
            h_bar_prime = (sum_h + 360.0) / 2.0
        else:
            h_bar_prime = (sum_h - 360.0) / 2.0

    T = (1.0
         - 0.17 * np.cos(np.radians(h_bar_prime - 30.0))
         + 0.24 * np.cos(np.radians(2.0 * h_bar_prime))
         + 0.32 * np.cos(np.radians(3.0 * h_bar_prime + 6.0))
         - 0.20 * np.cos(np.radians(4.0 * h_bar_prime - 63.0)))

    delta_theta = 30.0 * np.exp(-((h_bar_prime - 275.0) / 25.0) ** 2)

    C_bar_prime_7 = C_bar_prime ** 7
    R_C = 2.0 * np.sqrt(C_bar_prime_7 / (C_bar_prime_7 + 25.0 ** 7))

    S_L = 1.0 + (0.015 * (L_bar_prime - 50.0) ** 2) / np.sqrt(20.0 + (L_bar_prime - 50.0) ** 2)
    S_C = 1.0 + 0.045 * C_bar_prime
    S_H = 1.0 + 0.015 * C_bar_prime * T

    R_T = -np.sin(np.radians(2.0 * delta_theta)) * R_C

    dL_term = delta_L_prime / (kL * S_L)
    dC_term = delta_C_prime / (kC * S_C)
    dH_term = delta_H_prime / (kH * S_H)

    de00_sq = (dL_term ** 2) + (dC_term ** 2) + (dH_term ** 2) + (R_T * dC_term * dH_term)
    de00 = float(np.sqrt(max(0.0, de00_sq)))

    return {
        "delta_e00": round(de00, 4),
        "delta_L": round(float(delta_L_prime), 4),
        "delta_C": round(float(delta_C_prime), 4),
        "delta_H": round(float(delta_H_prime), 4),
        "delta_a": round(float(a2 - a1), 4),
        "delta_b": round(float(b2 - b1), 4),
        "passed": de00 < 0.3,
        "tolerance": 0.3
    }


def calculate_composite_metamerism(
    de_d65: float,
    de_a: float,
    de_f11: float,
    de_f2: float | None = None,
    method: str = "max"
) -> float:
    """
    Computes Illuminant Match Error Spread across secondary and tertiary illuminants.

    Scientific Note:
    This evaluates the multi-illuminant match divergence relative to the primary reference illuminant:
    - 'max' (default): Worst-case individual illuminant shift |ΔE00(ill) - ΔE00(ref)|.
    - 'rms': Root-mean-square multi-illuminant color difference shift.
    For formal Special Metamerism Index with tristimulus correction per ISO 18314-4 / DIN 6172,
    refer to `compute_iso_metamerism_index()`.

    Args:
        de_d65: Delta E00 under primary D65 illuminant.
        de_a: Delta E00 under Illuminant A (incandescent).
        de_f11: Delta E00 under TL84 / F11 (commercial store).
        de_f2: Optional Delta E00 under F2 (cool white fluorescent).
        method: Calculation method ('max' or 'rms').

    Returns:
        float: Composite Illuminant Match Error Spread.
    """
    mi_a = abs(de_a - de_d65)
    mi_f11 = abs(de_f11 - de_d65)
    mi_f2 = abs(de_f2 - de_d65) if de_f2 is not None else 0.0

    if method == "rms":
        vals = [mi_a, mi_f11] + ([mi_f2] if de_f2 is not None else [])
        return float(np.sqrt(np.mean([v ** 2 for v in vals])))

    # Default 'max': worst-case divergence across illuminants
    return float(max(mi_a, mi_f11, mi_f2))


def compute_iso_metamerism_index(
    reflectance_batch: np.ndarray | list[float],
    reflectance_standard: np.ndarray | list[float],
    observer: str = "10",
    reference_illuminant: str = "D65",
    test_illuminants: list[str] | tuple[str, ...] | None = None
) -> dict:
    """
    Computes the formal Special Metamerism Index for Change in Illuminant per ISO 18314-4 / DIN 6172.

    Standards Background:
    - ISO 18314-4:2018 ("Analytical colorimetry — Part 4: Metamerism index for pairs of samples for change of illuminant")
    - DIN 6172 ("Special metamerism index for pairs of samples on change in illuminant")

    Methodology:
    Because real specimen pairs rarely match perfectly under the reference illuminant (residual ΔE_ref > 0),
    evaluating raw color difference under a test illuminant conflates formulation/batching error with true metamerism.
    ISO 18314-4 standardizes a multiplicative correction to the batch tristimulus values under the test illuminant:
        f_X = X_std,ref / max(X_bat,ref, 1e-6)
        f_Y = Y_std,ref / max(Y_bat,ref, 1e-6)
        f_Z = Z_std,ref / max(Z_bat,ref, 1e-6)

        X_bat,test,corr = X_bat,test * f_X
        Y_bat,test,corr = Y_bat,test * f_Y
        Z_bat,test,corr = Z_bat,test * f_Z

    The formal Metamerism Index M_test is then evaluated as the color difference (CIEDE2000 and CIELAB ΔE*ab)
    between the standard under the test illuminant and the corrected batch:
        M_test = CIEDE2000(Lab_std,test, Lab_bat,test,corr)

    Args:
        reflectance_batch: 31-point batch/sample spectral reflectance (400-700 nm @ 10 nm)
        reflectance_standard: 31-point standard/target spectral reflectance (400-700 nm @ 10 nm)
        observer: CIE Standard Observer ('10' for 10° Supplementary, '2' for 2° Standard)
        reference_illuminant: Reference daylight illuminant (default: 'D65')
        test_illuminants: Secondary test illuminants (default: ('A', 'F11', 'F2'))

    Returns:
        dict containing:
        - M_<ill>: CIEDE2000 ISO metamerism index under each test illuminant
        - M_ab_<ill>: Classic CIELAB ΔE*ab index under each test illuminant
        - M_composite: max(M_test)
        - M_composite_rms: RMS(M_test)
        - correction_factors: {f_X, f_Y, f_Z}
        - standard_reference: "ISO 18314-4:2018 / DIN 6172"
    """
    tests = list(test_illuminants) if test_illuminants is not None else ["A", "F11", "F2"]

    # 1. Tristimulus values under reference illuminant
    X_std_0, Y_std_0, Z_std_0 = reflectance_to_xyz(reflectance_standard, illuminant=reference_illuminant, observer=observer)
    X_bat_0, Y_bat_0, Z_bat_0 = reflectance_to_xyz(reflectance_batch, illuminant=reference_illuminant, observer=observer)

    # 2. Multiplicative correction factors per ISO 18314-4 Section 5.2 / DIN 6172
    f_X = float(X_std_0 / max(X_bat_0, 1e-6))
    f_Y = float(Y_std_0 / max(Y_bat_0, 1e-6))
    f_Z = float(Z_std_0 / max(Z_bat_0, 1e-6))

    indices_de00 = {}
    indices_de_ab = {}
    details = {}

    for ill in tests:
        # Standard under test illuminant
        X_std_t, Y_std_t, Z_std_t = reflectance_to_xyz(reflectance_standard, illuminant=ill, observer=observer)
        lab_std_t = xyz_to_lab(X_std_t, Y_std_t, Z_std_t, illuminant=ill, observer=observer)

        # Batch under test illuminant, corrected by reference ratio
        X_bat_t, Y_bat_t, Z_bat_t = reflectance_to_xyz(reflectance_batch, illuminant=ill, observer=observer)
        X_bat_t_corr = X_bat_t * f_X
        Y_bat_t_corr = Y_bat_t * f_Y
        Z_bat_t_corr = Z_bat_t * f_Z
        lab_bat_t_corr = xyz_to_lab(X_bat_t_corr, Y_bat_t_corr, Z_bat_t_corr, illuminant=ill, observer=observer)

        # Metric 1: CIEDE2000 (modern industrial standard)
        de00 = float(ciede2000(lab_std_t, lab_bat_t_corr)["delta_e00"])

        # Metric 2: Classic CIELAB Euclidean ΔE*ab (strict DIN 6172 formula)
        dL = lab_std_t[0] - lab_bat_t_corr[0]
        da = lab_std_t[1] - lab_bat_t_corr[1]
        db = lab_std_t[2] - lab_bat_t_corr[2]
        de_ab = float(np.sqrt(dL ** 2 + da ** 2 + db ** 2))

        indices_de00[f"M_{ill}"] = round(de00, 4)
        indices_de_ab[f"M_ab_{ill}"] = round(de_ab, 4)
        details[ill] = {
            "M_ciede2000": round(de00, 4),
            "M_cielab_ab": round(de_ab, 4),
            "lab_std": [round(float(v), 3) for v in lab_std_t],
            "lab_bat_corrected": [round(float(v), 3) for v in lab_bat_t_corr]
        }

    vals_00 = list(indices_de00.values())
    m_composite = float(max(vals_00)) if vals_00 else 0.0
    m_rms = float(np.sqrt(np.mean([v ** 2 for v in vals_00]))) if vals_00 else 0.0

    return {
        "standard": "ISO 18314-4:2018 / DIN 6172",
        "reference_illuminant": reference_illuminant,
        "observer": observer,
        "correction_method": "multiplicative_tristimulus",
        "correction_factors": {
            "f_X": round(f_X, 5),
            "f_Y": round(f_Y, 5),
            "f_Z": round(f_Z, 5)
        },
        "M_composite": round(m_composite, 4),
        "M_composite_rms": round(m_rms, 4),
        **indices_de00,
        **indices_de_ab,
        "details": details
    }


def compute_metamerism_index(
    reflectance_batch: np.ndarray | list[float],
    reflectance_standard: np.ndarray | list[float],
    observer: str = "10",
    composite_method: str = "max",
    reference_illuminant: str = "D65",
    test_illuminants: list[str] | tuple[str, ...] | None = None,
    illuminants: list[str] | tuple[str, ...] | None = None
) -> dict:
    """
    Evaluates multi-illuminant color difference behavior between a batch and standard.

    Provides rigorous scientific separation between:
    1. Illuminant Match Error Spread:
       Evaluates the divergence across illuminants relative to reference illuminant:
       spread_max = max(ΔE_test) - ΔE_ref
       spread_<ill> = |ΔE_<ill> - ΔE_ref|
    2. Formal Special Metamerism Index (ISO 18314-4:2018 / DIN 6172):
       Evaluates true spectral metamerism index with multiplicative tristimulus correction.
    3. Backward-Compatible Fields:
       dE00_D65, dE00_A, dE00_F11, dE00_F2, MI_A, MI_F11, MI_F2, MI_composite, MI_composite_rms, rating.
    """
    if test_illuminants is None and illuminants is not None:
        test_illuminants = illuminants
    if test_illuminants is None:
        tests = ["A", "F11", "F2"]
    else:
        tests = list(test_illuminants)
        if "F2" not in tests and len(tests) == 2:
            tests.append("F2")

    all_ills = [reference_illuminant] + [i for i in tests if i != reference_illuminant]
    delta_e_map = {}

    for ill in all_ills:
        lab_std = reflectance_to_lab(reflectance_standard, illuminant=ill, observer=observer)
        lab_bat = reflectance_to_lab(reflectance_batch, illuminant=ill, observer=observer)
        de = ciede2000(lab_std, lab_bat)["delta_e00"]
        delta_e_map[ill] = de

    de_ref = delta_e_map[reference_illuminant]
    de_a = delta_e_map.get("A", de_ref)
    de_f11 = delta_e_map.get("F11", de_ref)
    de_f2 = delta_e_map.get("F2", de_ref)

    # 1. Illuminant Match Error Spread
    test_de_vals = [delta_e_map[ill] for ill in tests if ill in delta_e_map]
    spread_max = (max(test_de_vals) - de_ref) if test_de_vals else 0.0

    match_error_spread = {
        "spread_max": round(float(spread_max), 4),
        "spread_A": round(abs(de_a - de_ref), 4),
        "spread_F11": round(abs(de_f11 - de_ref), 4),
        "spread_F2": round(abs(de_f2 - de_ref), 4)
    }
    for ill in tests:
        match_error_spread[f"spread_{ill}"] = round(abs(delta_e_map[ill] - de_ref), 4)

    # 2. Formal ISO 18314-4 / DIN 6172 Metamerism Index
    iso_result = compute_iso_metamerism_index(
        reflectance_batch=reflectance_batch,
        reflectance_standard=reflectance_standard,
        observer=observer,
        reference_illuminant=reference_illuminant,
        test_illuminants=tests
    )

    # 3. Backward-compatible fields
    mi_a = abs(de_a - de_ref)
    mi_f11 = abs(de_f11 - de_ref)
    mi_f2 = abs(de_f2 - de_ref)

    test_shifts = [abs(delta_e_map[ill] - de_ref) for ill in tests if ill in delta_e_map]
    if composite_method == "rms":
        mi_composite = float(np.sqrt(np.mean([s ** 2 for s in test_shifts]))) if test_shifts else 0.0
    else:
        mi_composite = float(max(test_shifts)) if test_shifts else 0.0

    mi_composite_rms = float(np.sqrt(np.mean([s ** 2 for s in test_shifts]))) if test_shifts else 0.0

    res = {
        "dE00_D65": round(delta_e_map.get("D65", de_ref), 4),
        "dE00_A": round(de_a, 4),
        "dE00_F11": round(de_f11, 4),
        "dE00_F2": round(de_f2, 4),
        "MI_A": round(mi_a, 4),
        "MI_F11": round(mi_f11, 4),
        "MI_F2": round(mi_f2, 4),
        "MI_composite": round(mi_composite, 4),
        "MI_composite_rms": round(mi_composite_rms, 4),
        "rating": "Excellent" if mi_composite < 0.5 else ("Good" if mi_composite < 1.0 else "Warning - High Metamerism"),

        # Rigorous Scientific Separation
        "illuminant_deltas": {
            "dE00_reference": round(de_ref, 4),
            **{f"dE00_{ill}": round(delta_e_map[ill], 4) for ill in all_ills}
        },
        "illuminant_match_error_spread": match_error_spread,
        "iso_18314_4": iso_result,
        "standards_compliance": {
            "formal_metamerism_standard": "ISO 18314-4:2018 / DIN 6172 (Multiplicative Tristimulus Correction)",
            "spread_metric_definition": "Illuminant Match Error Spread: max(ΔE_test) - ΔE_ref",
            "reference_illuminant": reference_illuminant,
            "test_illuminants": tests,
            "observer": observer
        }
    }

    # Dynamic test illuminant keys
    for ill in tests:
        res[f"dE00_{ill}"] = round(delta_e_map.get(ill, de_ref), 4)
        res[f"MI_{ill}"] = round(abs(delta_e_map.get(ill, de_ref) - de_ref), 4)

    return res
