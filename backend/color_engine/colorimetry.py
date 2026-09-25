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
    Computes canonical Composite Metamerism Index across illuminants.

    Methods:
    - 'max' (default, DIN 6172 / ASTM E805): Worst-case individual illuminant shift |ΔE00(ill) - ΔE00(D65)|.
    - 'rms': Root-mean-square multi-illuminant color difference.

    Args:
        de_d65: Delta E00 under primary D65 illuminant.
        de_a: Delta E00 under Illuminant A (incandescent).
        de_f11: Delta E00 under TL84 / F11 (commercial store).
        de_f2: Optional Delta E00 under F2 (cool white fluorescent).
        method: Calculation method ('max' or 'rms').

    Returns:
        float: Composite Metamerism Index.
    """
    mi_a = abs(de_a - de_d65)
    mi_f11 = abs(de_f11 - de_d65)
    mi_f2 = abs(de_f2 - de_d65) if de_f2 is not None else 0.0

    if method == "rms":
        vals = [mi_a, mi_f11] + ([mi_f2] if de_f2 is not None else [])
        return float(np.sqrt(np.mean([v ** 2 for v in vals])))

    # Default 'max': DIN 6172 / ASTM E805 worst-case divergence
    return float(max(mi_a, mi_f11, mi_f2))


def compute_metamerism_index(
    reflectance_batch: np.ndarray | list[float],
    reflectance_standard: np.ndarray | list[float],
    observer: str = "10",
    composite_method: str = "max"
) -> dict:
    """
    Computes Metamerism Index (MI) comparing a sample to a standard under:
    - Primary: D65 (Daylight)
    - Secondary: A (Incandescent)
    - Tertiary: F11 (Store Fluorescent)
    - Quaternary: F2 (Cool White Fluorescent)

    MI_A = |ΔE00(A) - ΔE00(D65)|
    MI_F11 = |ΔE00(F11) - ΔE00(D65)|
    MI_composite = calculate_composite_metamerism(...)
    """
    delta_e_map = {}

    for ill in ["D65", "A", "F11", "F2"]:
        lab_std = reflectance_to_lab(reflectance_standard, illuminant=ill, observer=observer)
        lab_bat = reflectance_to_lab(reflectance_batch, illuminant=ill, observer=observer)
        de = ciede2000(lab_std, lab_bat)["delta_e00"]
        delta_e_map[ill] = de

    de_d65 = delta_e_map["D65"]
    mi_a = abs(delta_e_map["A"] - de_d65)
    mi_f11 = abs(delta_e_map["F11"] - de_d65)
    mi_f2 = abs(delta_e_map["F2"] - de_d65)
    mi_composite = calculate_composite_metamerism(
        de_d65, delta_e_map["A"], delta_e_map["F11"], delta_e_map["F2"], method=composite_method
    )
    mi_composite_rms = calculate_composite_metamerism(
        de_d65, delta_e_map["A"], delta_e_map["F11"], delta_e_map["F2"], method="rms"
    )

    return {
        "dE00_D65": round(de_d65, 4),
        "dE00_A": round(delta_e_map["A"], 4),
        "dE00_F11": round(delta_e_map["F11"], 4),
        "dE00_F2": round(delta_e_map["F2"], 4),
        "MI_A": round(mi_a, 4),
        "MI_F11": round(mi_f11, 4),
        "MI_F2": round(mi_f2, 4),
        "MI_composite": round(mi_composite, 4),
        "MI_composite_rms": round(mi_composite_rms, 4),
        "rating": "Excellent" if mi_composite < 0.5 else ("Good" if mi_composite < 1.0 else "Warning - High Metamerism")
    }
