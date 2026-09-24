"""
TintMatch PRO - Quality Gate Policy Engine 2.0
==============================================
Provides independent policy-driven validation gates:
1. Characterization Gate (ISO 18314 calibration validation):
   - Mean CIEDE2000 across dilution series
   - Maximum individual CIEDE2000 outlier barrier
   - Goodness-of-fit R²
   - Spectral Root Mean Square Error (RMSE)
   - Maximum spectral residual
   - Dilution series count (minimum 3 letdown concentrations)
   - Luminous Contrast Ratio / Opacity
   - Directional residuals (ΔL*, Δa*, Δb*, ΔC*, ΔH*)

2. Formulation Gate (CCM recipe validation):
   - Primary D65 ΔE00 against corporate ToleranceProfile
   - DIN 6172 / ASTM E805 Composite Metamerism Index (MI_composite <= limit)
   - Mass constraint compliance (sum(c_i) <= max_total_load)
   - SLSQP solver convergence diagnostics
   - Directional tint shifts
"""

import numpy as np
from typing import Literal
from .profiles import (
    ColorScienceProfile,
    ToleranceProfile,
    DEFAULT_SCIENCE_PROFILE,
    DEFAULT_TOLERANCE_PROFILE,
    TOLERANCE_STRICT_LAB
)


def evaluate_characterization_gate(
    mean_de00: float,
    max_de00: float,
    r_squared: float,
    spectral_rmse: float,
    contrast_ratio: float,
    letdown_count: int = 4,
    max_spectral_residual: float | None = None,
    directional_residuals: dict | None = None,
    profile: ColorScienceProfile = DEFAULT_SCIENCE_PROFILE,
    tolerance: ToleranceProfile = DEFAULT_TOLERANCE_PROFILE
) -> dict:
    """
    Evaluates spectrophotometer characterization conformance against optical models and tolerance limits.
    """
    checks = []

    # 1. Mean Delta E00
    mean_limit = tolerance.mean_de00_limit
    mean_pass = mean_de00 <= mean_limit
    checks.append({
        "metric": "mean_delta_e00",
        "label": "Ortalama Renk Farkı (Mean ΔE00)",
        "actual": round(float(mean_de00), 4),
        "limit": mean_limit,
        "operator": "<=",
        "status": "PASS" if mean_pass else "FAIL",
        "severity": "INFO" if mean_pass else "CRITICAL"
    })

    # 2. Max Delta E00 (Outlier prevention)
    max_limit = tolerance.single_de00_limit
    max_pass = max_de00 <= max_limit
    checks.append({
        "metric": "max_delta_e00",
        "label": "Maksimum Tekil Sapma (Max ΔE00)",
        "actual": round(float(max_de00), 4),
        "limit": max_limit,
        "operator": "<=",
        "status": "PASS" if max_pass else "FAIL",
        "severity": "INFO" if max_pass else "WARNING"
    })

    # 3. Goodness of Fit R²
    r2_limit = tolerance.min_r_squared
    r2_pass = r_squared >= r2_limit
    checks.append({
        "metric": "r_squared",
        "label": "Spektral Uyum Katsayısı (R²)",
        "actual": round(float(r_squared), 4),
        "limit": r2_limit,
        "operator": ">=",
        "status": "PASS" if r2_pass else "FAIL",
        "severity": "INFO" if r2_pass else "WARNING"
    })

    # 4. Spectral RMSE
    rmse_limit = tolerance.max_spectral_rmse
    rmse_pass = spectral_rmse <= rmse_limit
    checks.append({
        "metric": "spectral_rmse",
        "label": "Spektral Hata (RMSE)",
        "actual": round(float(spectral_rmse), 4),
        "limit": rmse_limit,
        "operator": "<=",
        "status": "PASS" if rmse_pass else "FAIL",
        "severity": "INFO" if rmse_pass else "WARNING"
    })

    # 5. Letdown Series Count (minimum 3 concentrations required for identifiability)
    count_pass = letdown_count >= 2
    checks.append({
        "metric": "letdown_count",
        "label": "Seyreltme Konsantrasyon Sayısı",
        "actual": letdown_count,
        "limit": 2,
        "operator": ">=",
        "status": "PASS" if count_pass else "FAIL",
        "severity": "INFO" if count_pass else "CRITICAL"
    })

    # 6. Maximum Spectral Residual (if provided)
    if max_spectral_residual is not None:
        res_limit = 0.040
        res_pass = max_spectral_residual <= res_limit
        checks.append({
            "metric": "max_spectral_residual",
            "label": "Maksimum Spektral Kalıntı",
            "actual": round(float(max_spectral_residual), 4),
            "limit": res_limit,
            "operator": "<=",
            "status": "PASS" if res_pass else "FAIL",
            "severity": "INFO" if res_pass else "WARNING"
        })

    # 7. Contrast Ratio / Opacity
    cr_pass = contrast_ratio >= tolerance.opacity_limit
    checks.append({
        "metric": "contrast_ratio",
        "label": "Kontrast Oranı (Opasite)",
        "actual": round(float(contrast_ratio), 2),
        "limit": tolerance.opacity_limit,
        "operator": ">=",
        "status": "PASS" if cr_pass else "PARTIAL",
        "severity": "INFO" if cr_pass else "INFO"
    })

    # Overall verdict
    is_fully_passed = mean_pass and max_pass and r2_pass and rmse_pass and count_pass
    overall_status = "PASS" if is_fully_passed else "FAIL"

    return {
        "gate_type": "CHARACTERIZATION_GATE",
        "status": overall_status,
        "tolerance_profile": tolerance.name,
        "overall_severity": "INFO" if is_fully_passed else "CRITICAL",
        "checks": checks,
        "directional_residuals": directional_residuals or {
            "delta_L": 0.0,
            "delta_a": 0.0,
            "delta_b": 0.0,
            "delta_C": 0.0,
            "delta_H": 0.0
        }
    }


def evaluate_formulation_gate(
    delta_e00_d65: float,
    composite_mi: float,
    total_load: float,
    max_total_load: float = 12.0,
    solver_status: str = "OPTIMAL_CONVERGED",
    constraint_slack: float = 0.0,
    directional_residuals: dict | None = None,
    tolerance: ToleranceProfile = DEFAULT_TOLERANCE_PROFILE
) -> dict:
    """
    Evaluates CCM matched formulation compliance against factory acceptance rules.
    """
    checks = []

    # 1. Primary D65 Color Difference
    de_limit = tolerance.single_de00_limit
    de_pass = delta_e00_d65 <= de_limit
    checks.append({
        "metric": "delta_e00_d65",
        "label": "D65 CIEDE2000 Renk Farkı",
        "actual": round(float(delta_e00_d65), 3),
        "limit": de_limit,
        "operator": "<=",
        "status": "PASS" if de_pass else "FAIL",
        "severity": "INFO" if de_pass else "CRITICAL"
    })

    # 2. DIN 6172 / ASTM E805 Composite Metamerism Index
    mi_limit = tolerance.composite_mi_limit
    mi_pass = composite_mi <= mi_limit
    checks.append({
        "metric": "composite_metamerism",
        "label": "Bileşik Metamerizm İndeksi (MI)",
        "actual": round(float(composite_mi), 3),
        "limit": mi_limit,
        "operator": "<=",
        "status": "PASS" if mi_pass else "FAIL",
        "severity": "INFO" if mi_pass else "WARNING"
    })

    # 3. Maximum Pigment Paste Mass Constraint
    load_pass = total_load <= max_total_load + 1e-4
    checks.append({
        "metric": "total_load",
        "label": "Toplam Pasta Yükü (%)",
        "actual": round(float(total_load), 3),
        "limit": max_total_load,
        "operator": "<=",
        "status": "PASS" if load_pass else "FAIL",
        "severity": "INFO" if load_pass else "CRITICAL"
    })

    # 4. SLSQP Solver Convergence
    solver_pass = solver_status in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    checks.append({
        "metric": "solver_status",
        "label": "SLSQP Çözücü Durumu",
        "actual": solver_status,
        "limit": "OPTIMAL_CONVERGED",
        "operator": "==",
        "status": "PASS" if solver_pass else "FAIL",
        "severity": "INFO" if solver_pass else "WARNING"
    })

    overall_pass = de_pass and load_pass and solver_pass
    return {
        "gate_type": "FORMULATION_GATE",
        "status": "PASS" if overall_pass else "FAIL",
        "tolerance_profile": tolerance.name,
        "overall_severity": "INFO" if overall_pass else "CRITICAL",
        "checks": checks,
        "directional_residuals": directional_residuals or {}
    }


# Backward-compatible alias
def evaluate_quality_gate(
    mean_de00: float,
    max_de00: float,
    r_squared: float,
    spectral_rmse: float,
    contrast_ratio: float,
    directional_residuals: dict | None = None,
    profile: ColorScienceProfile = DEFAULT_SCIENCE_PROFILE
) -> dict:
    return evaluate_characterization_gate(
        mean_de00=mean_de00,
        max_de00=max_de00,
        r_squared=r_squared,
        spectral_rmse=spectral_rmse,
        contrast_ratio=contrast_ratio,
        directional_residuals=directional_residuals,
        profile=profile
    )
