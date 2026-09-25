"""
Instrument Comparison & Inter-Model Correlation Engine
======================================================
Provides rigorous comparison between measurements from different spectrophotometers:
- X-Rite RM400 (45°/0° Directional)
- CHNSpec DS-36D (d/8° Integrating Sphere, SCI and SCE)

Analyzes:
1. Wavelength-by-wavelength spectral difference Delta R(lambda) and bias
2. Spectral RMSE and Pearson correlation coefficient (R²)
3. CIEDE2000 color difference and directional shifts (Delta L*, Delta a*, Delta b*, Delta C*, Delta H*)
4. Optical geometry discrepancy diagnostics (e.g. Specular Included gloss bias vs diffuse body reflectance)

NOTE ON METHODOLOGY:
In accordance with ISO 7724 and ASTM E1164, different optical geometries (45°/0° vs d/8°)
measure fundamentally distinct physical optical phenomena. This module computes comparative
metrics and empirical bias; it does NOT attempt unphysical mathematical conversion of K-M
absorption/scattering constants across differing geometries.
"""

import numpy as np
from typing import Optional, Dict, Any, List

from .constants import WAVELENGTHS, N_WAVELENGTHS
from .spectrum_normalizer import normalize_spectrum
from .colorimetry import reflectance_to_lab, reflectance_to_hex, ciede2000
from .profiles import ToleranceProfile, DEFAULT_TOLERANCE_PROFILE


def compare_spectral_measurements(
    ref_spectrum: List[float] | np.ndarray,
    target_spectrum: List[float] | np.ndarray,
    ref_meta: Optional[Dict[str, Any]] = None,
    target_meta: Optional[Dict[str, Any]] = None,
    illuminant: str = "D65",
    observer: str = "10",
    tolerance_profile: Optional[ToleranceProfile] = None
) -> Dict[str, Any]:
    """
    Compares two spectral reflectance curves, evaluating spectral discrepancy,
    inter-instrument bias, and colorimetric difference.

    Args:
        ref_spectrum: 31-point reference reflectance [400..700 nm @ 10 nm]
        target_spectrum: 31-point target reflectance [400..700 nm @ 10 nm]
        ref_meta: Optional metadata for reference (instrument, geometry, mode)
        target_meta: Optional metadata for target (instrument, geometry, mode)
        illuminant: CIE illuminant (default 'D65')
        observer: CIE observer angle (default '10')

    Returns:
        Comprehensive comparison dictionary.
    """
    ref_norm = np.array(normalize_spectrum(ref_spectrum), dtype=float)
    target_norm = np.array(normalize_spectrum(target_spectrum), dtype=float)

    ref_meta = ref_meta or {}
    target_meta = target_meta or {}

    ref_geo = ref_meta.get("geometry", "45°/0°")
    target_geo = target_meta.get("geometry", "d/8°")
    ref_inst = ref_meta.get("instrument", "Reference Spectrophotometer")
    target_inst = target_meta.get("instrument", "Target Spectrophotometer")

    # 1. Wavelength-by-wavelength spectral difference
    delta_r = target_norm - ref_norm
    mean_bias = float(np.mean(delta_r))
    spectral_rmse = float(np.sqrt(np.mean(delta_r ** 2)))
    max_abs_idx = int(np.argmax(np.abs(delta_r)))
    max_abs_diff = float(np.abs(delta_r[max_abs_idx]))
    max_diff_wl = int(WAVELENGTHS[max_abs_idx])

    # 2. Pearson correlation coefficient r and R²
    ref_dev = ref_norm - np.mean(ref_norm)
    target_dev = target_norm - np.mean(target_norm)
    denom = np.sqrt(np.sum(ref_dev ** 2) * np.sum(target_dev ** 2))
    if denom > 1e-12:
        r_corr = float(np.sum(ref_dev * target_dev) / denom)
    else:
        r_corr = 1.0 if np.allclose(ref_norm, target_norm) else 0.0
    r_squared = float(r_corr ** 2)

    # 3. Colorimetry
    ref_lab = reflectance_to_lab(ref_norm, illuminant=illuminant, observer=observer)
    target_lab = reflectance_to_lab(target_norm, illuminant=illuminant, observer=observer)
    ref_hex = reflectance_to_hex(ref_norm)
    target_hex = reflectance_to_hex(target_norm)

    diff = ciede2000(ref_lab, target_lab)
    de00 = round(float(diff["delta_e00"]), 3)
    dL = round(float(diff.get("delta_L", target_lab[0] - ref_lab[0])), 2)
    da = round(float(diff.get("delta_a", target_lab[1] - ref_lab[1])), 2)
    db = round(float(diff.get("delta_b", target_lab[2] - ref_lab[2])), 2)
    dC = round(float(diff.get("delta_C", 0.0)), 2)
    dH = round(float(diff.get("delta_H", 0.0)), 2)

    # 4. Geometry & Discrepancy Diagnostics
    same_geo = (ref_geo.strip().lower() == target_geo.strip().lower())
    target_mode = target_meta.get("mode", "").upper()
    ref_mode = ref_meta.get("mode", "").upper()

    notes = []
    if not same_geo:
        notes.append(
            f"Farklı optik geometriler karşılaştırılıyor ({ref_geo} vs {target_geo}). "
            "Küre (d/8°) ve yönlü (45°/0°) geometriler yüzey parıltısı ve dokudan farklı etkilenir."
        )
        if "SCI" in target_mode or "SCI" in target_geo:
            notes.append(
                f"Hedef ölçümde ayna yansıması dahil edilmiştir (SCI). "
                f"Ortalama yansıma farkı: +{mean_bias*100.0:.2f}% R (yüzey aynasal yansıması, sphere trap etkisi ve optik geometri farkından kaynaklanan bileşik kayma)."
            )
        elif "SCE" in target_mode or "SCE" in target_geo:
            notes.append(
                "Hedef ölçümde ayna yansıması hariç tutulmuştur (SCE, gövde difüz yansıması)."
            )
    else:
        notes.append(
            f"Aynı optik geometri ({ref_geo}). "
            "Sapmalar cihazlar arası uyum (IIA), kalibrasyon farkı veya numune konumlandırmasından kaynaklanır."
        )

    prof = tolerance_profile or DEFAULT_TOLERANCE_PROFILE
    if de00 <= prof.mean_de00_limit:
        comparison_status = "PASS"
    elif de00 <= prof.single_de00_limit:
        comparison_status = "WARN"
    else:
        comparison_status = "FAIL"

    if de00 <= 0.30:
        agreement_class = "EXCELLENT (Inter-instrument agreement ΔE00 ≤ 0.30)"
    elif de00 <= 0.80:
        agreement_class = "GOOD (Acceptable commercial inter-model correlation ΔE00 ≤ 0.80)"
    elif de00 <= 1.50:
        agreement_class = "MODERATE (Noticeable difference ΔE00 ≤ 1.50)"
    else:
        agreement_class = "SIGNIFICANT_DISCREPANCY (ΔE00 > 1.50 - Geometry or calibration bias)"

    return {
        "success": True,
        "reference": {
            "instrument": ref_inst,
            "geometry": ref_geo,
            "mode": ref_mode or "N/A",
            "reflectance": [round(float(v), 5) for v in ref_norm],
            "lab": {"L": round(ref_lab[0], 2), "a": round(ref_lab[1], 2), "b": round(ref_lab[2], 2)},
            "hex": ref_hex
        },
        "target": {
            "instrument": target_inst,
            "geometry": target_geo,
            "mode": target_mode or "N/A",
            "reflectance": [round(float(v), 5) for v in target_norm],
            "lab": {"L": round(target_lab[0], 2), "a": round(target_lab[1], 2), "b": round(target_lab[2], 2)},
            "hex": target_hex
        },
        "wavelengths": [int(w) for w in WAVELENGTHS],
        "delta_reflectance": [round(float(v), 5) for v in delta_r],
        "statistics": {
            "mean_spectral_bias": round(mean_bias, 5),
            "spectral_rmse": round(spectral_rmse, 5),
            "max_absolute_difference": round(max_abs_diff, 5),
            "max_difference_wavelength_nm": max_diff_wl,
            "pearson_r": round(r_corr, 5),
            "r_squared": round(r_squared, 5)
        },
        "colorimetric_difference": {
            "delta_e00": de00,
            "delta_L": dL,
            "delta_a": da,
            "delta_b": db,
            "delta_C": dC,
            "delta_H": dH,
            "illuminant": illuminant,
            "observer": observer
        },
        "diagnostics": {
            "same_geometry": same_geo,
            "comparison_status": comparison_status,
            "agreement_classification": agreement_class,
            "notes": notes
        }
    }
