"""
TintMatch PRO - Quality Gate Policy Engine
==========================================
Provides multi-metric industrial conformance evaluation:
- Mean CIEDE2000 across dilution series
- Maximum individual CIEDE2000 outlier barrier
- Goodness-of-fit R²
- Spectral Root Mean Square Error (RMSE)
- Luminous Contrast Ratio / Opacity
- Directional residuals (ΔL*, Δa*, Δb*, ΔC*, ΔH*) for colorist diagnostic insights
"""

import numpy as np
from typing import Literal
from .profiles import ColorScienceProfile, DEFAULT_SCIENCE_PROFILE


def evaluate_quality_gate(
    mean_de00: float,
    max_de00: float,
    r_squared: float,
    spectral_rmse: float,
    contrast_ratio: float,
    directional_residuals: dict | None = None,
    profile: ColorScienceProfile = DEFAULT_SCIENCE_PROFILE
) -> dict:
    """
    Evaluates lab conformance against the configured ColorScienceProfile.

    Returns:
        Structured Quality Gate dictionary with overall status, individual checks, and directional residuals.
    """
    checks = []

    # 1. Mean Delta E00
    mean_pass = mean_de00 <= profile.char_mean_de00_max
    checks.append({
        "metric": "mean_delta_e00",
        "label": "Ortalama Renk Farkı (Mean ΔE00)",
        "actual": round(float(mean_de00), 4),
        "limit": profile.char_mean_de00_max,
        "operator": "<=",
        "status": "PASS" if mean_pass else "FAIL",
        "severity": "INFO" if mean_pass else "CRITICAL"
    })

    # 2. Max Delta E00 (Outlier prevention)
    max_pass = max_de00 <= profile.char_single_de00_max
    checks.append({
        "metric": "max_delta_e00",
        "label": "Maksimum Sapma (Max ΔE00)",
        "actual": round(float(max_de00), 4),
        "limit": profile.char_single_de00_max,
        "operator": "<=",
        "status": "PASS" if max_pass else "FAIL",
        "severity": "INFO" if max_pass else "WARNING"
    })

    # 3. Goodness of Fit R²
    r2_pass = r_squared >= profile.char_min_r_squared
    checks.append({
        "metric": "r_squared",
        "label": "Spektral Uyum Katsayısı (R²)",
        "actual": round(float(r_squared), 4),
        "limit": profile.char_min_r_squared,
        "operator": ">=",
        "status": "PASS" if r2_pass else "FAIL",
        "severity": "INFO" if r2_pass else "WARNING"
    })

    # 4. Spectral RMSE
    rmse_pass = spectral_rmse <= profile.char_max_spectral_rmse
    checks.append({
        "metric": "spectral_rmse",
        "label": "Spektral Hata (RMSE)",
        "actual": round(float(spectral_rmse), 4),
        "limit": profile.char_max_spectral_rmse,
        "operator": "<=",
        "status": "PASS" if rmse_pass else "FAIL",
        "severity": "INFO" if rmse_pass else "WARNING"
    })

    # 5. Contrast Ratio / Opacity
    cr_pass = contrast_ratio >= profile.opacity_hiding_threshold
    checks.append({
        "metric": "contrast_ratio",
        "label": "Kontrast Oranı (Opasite)",
        "actual": round(float(contrast_ratio), 2),
        "limit": profile.opacity_hiding_threshold,
        "operator": ">=",
        "status": "PASS" if cr_pass else "PARTIAL",
        "severity": "INFO" if cr_pass else "INFO"
    })

    # Overall verdict
    is_fully_passed = mean_pass and max_pass and r2_pass and rmse_pass
    overall_status = "PASS" if is_fully_passed else "FAIL"

    return {
        "status": overall_status,
        "is_production_ready": is_fully_passed and cr_pass,
        "summary": "Tüm endüstriyel kalite kriterleri sağlandı." if is_fully_passed else "Kalite kriterlerinde sınır aşımları mevcut.",
        "checks": checks,
        "directional_residuals": directional_residuals or {
            "delta_L": 0.0,
            "delta_a": 0.0,
            "delta_b": 0.0,
            "delta_C": 0.0,
            "delta_H": 0.0
        }
    }
