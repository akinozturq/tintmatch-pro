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
   - Multi-Illuminant Stability & Match Error Spread (MI_composite <= limit)
   - Mass constraint compliance (sum(c_i) <= max_total_load)
   - SLSQP solver convergence diagnostics
   - Directional tint shifts
"""

import numpy as np
from typing import Literal
from .profiles import (
    ColorScienceProfile,
    ToleranceProfile,
    OptimizationProfile,
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
    loocv_result: dict | None = None,
    is_opaque: bool = True,
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

    # 5. Letdown Series Count (minimum 3 concentrations required for robust validation)
    if letdown_count >= 3:
        count_status = "PASS"
        count_severity = "INFO"
        count_pass = True
    elif letdown_count == 2:
        count_status = "WARN"
        count_severity = "WARNING"
        count_pass = True  # Fit is mathematically possible, but warn
    else:
        count_status = "FAIL"
        count_severity = "CRITICAL"
        count_pass = False

    checks.append({
        "metric": "letdown_count",
        "label": "Seyreltme Konsantrasyon Sayısı",
        "actual": letdown_count,
        "limit": 3,
        "operator": ">=",
        "status": count_status,
        "severity": count_severity
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
    if not is_opaque:
        cr_pass = True
        cr_status = "INFORMATIONAL"
        cr_severity = "INFO"
        cr_label = "Kontrast Oranı (Şeffaf / Derin Baz - Bilgilendirme Amaçlı)"
    else:
        cr_pass = contrast_ratio >= tolerance.opacity_limit
        cr_status = "PASS" if cr_pass else "WARN"
        cr_severity = "INFO" if cr_pass else "WARNING"
        cr_label = "Kontrast Oranı (Opasite)"

    checks.append({
        "metric": "contrast_ratio",
        "label": cr_label,
        "actual": round(float(contrast_ratio), 2),
        "limit": tolerance.opacity_limit if is_opaque else None,
        "operator": ">=" if is_opaque else "N/A",
        "status": cr_status,
        "severity": cr_severity
    })

    # 8. Out-of-Sample Prediction Validation (LOOCV)
    loocv_mean_pass = True
    loocv_max_pass = True
    loocv_p95_pass = True
    if loocv_result is not None:
        if loocv_result.get("status") == "LOOCV_EVALUATED":
            loocv_mean = loocv_result.get("mean_delta_e00", 0.0)
            loocv_limit = getattr(tolerance, "loocv_de00_limit", 0.50)
            loocv_mean_pass = (loocv_mean is not None and loocv_mean <= loocv_limit)
            checks.append({
                "metric": "loocv_mean_delta_e00",
                "label": "Görülmemiş Numune Tahmin Hatası (LOOCV Mean ΔE00)",
                "actual": round(float(loocv_mean), 3) if loocv_mean is not None else None,
                "limit": loocv_limit,
                "operator": "<=",
                "status": "PASS" if loocv_mean_pass else "FAIL",
                "severity": "INFO" if loocv_mean_pass else "WARNING"
            })

            loocv_max = loocv_result.get("max_delta_e00", 0.0)
            loocv_max_limit = getattr(tolerance, "loocv_max_de00_limit", 1.00)
            loocv_max_pass = (loocv_max is not None and loocv_max <= loocv_max_limit)
            checks.append({
                "metric": "loocv_max_delta_e00",
                "label": "Maksimum Numune Tahmin Hatası (LOOCV Max ΔE00)",
                "actual": round(float(loocv_max), 3) if loocv_max is not None else None,
                "limit": loocv_max_limit,
                "operator": "<=",
                "status": "PASS" if loocv_max_pass else "FAIL",
                "severity": "INFO" if loocv_max_pass else "WARNING"
            })

            loocv_p95 = loocv_result.get("p95_delta_e00", 0.0)
            loocv_p95_limit = getattr(tolerance, "loocv_p95_de00_limit", 0.80)
            loocv_p95_pass = (loocv_p95 is not None and loocv_p95 <= loocv_p95_limit)
            checks.append({
                "metric": "loocv_p95_delta_e00",
                "label": "95. Yüzdelik Tahmin Hatası (LOOCV p95 ΔE00)",
                "actual": round(float(loocv_p95), 3) if loocv_p95 is not None else None,
                "limit": loocv_p95_limit,
                "operator": "<=",
                "status": "PASS" if loocv_p95_pass else "FAIL",
                "severity": "INFO" if loocv_p95_pass else "WARNING"
            })
        else:
            loocv_mean_pass = False
            loocv_max_pass = False
            loocv_p95_pass = False
            checks.append({
                "metric": "loocv_mean_delta_e00",
                "label": "Görülmemiş Numune Tahmin Hatası (LOOCV)",
                "actual": "INSUFFICIENT_LETDOWNS (n < 4)",
                "limit": getattr(tolerance, "loocv_de00_limit", 0.50),
                "operator": "<=",
                "status": "WARN",
                "severity": "WARNING"
            })
    else:
        loocv_mean_pass = False
        loocv_max_pass = False
        loocv_p95_pass = False

    loocv_pass = loocv_mean_pass and loocv_max_pass and loocv_p95_pass

    # Overall verdict
    is_fully_passed = mean_pass and max_pass and r2_pass and rmse_pass and count_pass and loocv_pass
    if not is_fully_passed:
        # If all self-fit checks passed, but LOOCV was skipped due to n < 4, it is a WARN, NOT PASS
        if mean_pass and max_pass and r2_pass and rmse_pass and count_pass and letdown_count < 4:
            overall_status = "WARN"
            overall_severity = "WARNING"
        else:
            overall_status = "FAIL"
            overall_severity = "CRITICAL"
    elif letdown_count < 4:
        overall_status = "WARN"
        overall_severity = "WARNING"
    else:
        overall_status = "PASS"
        overall_severity = "INFO"

    return {
        "gate_type": "CHARACTERIZATION_GATE",
        "status": overall_status,
        "tolerance_profile": tolerance.name,
        "overall_severity": overall_severity,
        "checks": checks,
        "loocv_result": loocv_result,
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
    min_total_load: float = 0.0,
    solver_status: str = "OPTIMAL_CONVERGED",
    constraint_slack: float = 0.0,
    directional_residuals: dict | None = None,
    tolerance: ToleranceProfile = DEFAULT_TOLERANCE_PROFILE,
    profile: OptimizationProfile | None = None,
    delta_e00_a: float | None = None,
    delta_e00_f11: float | None = None,
    delta_e00_f2: float | None = None,
    baseline_load: float | None = None
) -> dict:
    """
    Evaluates CCM matched formulation compliance against factory acceptance rules.
    Supports profile-based acceptance policies:
    - Color Match (Recipe A): D65 <= 0.50
    - Light Stability (Recipe B): D65 <= 0.50, A <= 0.80, F11 <= 0.80, MI <= 0.50
    - Economy (Recipe C): D65 <= 0.80, load <= economy_load_limit
    """
    checks = []

    # 1. Primary D65 Color Difference
    if profile is not None and getattr(profile, "gate_limit_d65", None) is not None:
        de_limit = profile.gate_limit_d65
    else:
        de_limit = tolerance.single_de00_limit
    de_pass = delta_e00_d65 <= de_limit + 1e-4
    checks.append({
        "metric": "delta_e00_d65",
        "label": "D65 CIEDE2000 Renk Farkı",
        "actual": round(float(delta_e00_d65), 3),
        "limit": round(float(de_limit), 3),
        "operator": "<=",
        "status": "PASS" if de_pass else "FAIL",
        "severity": "INFO" if de_pass else "CRITICAL"
    })

    # 2. Secondary Illuminant A (Tungsten) Check
    pass_a = True
    critical_a = False
    if delta_e00_a is not None:
        if profile is not None and getattr(profile, "gate_limit_a", None) is not None:
            limit_a = profile.gate_limit_a
            critical_a = True
            pass_a = delta_e00_a <= limit_a + 1e-4
            severity_a = "INFO" if pass_a else "CRITICAL"
            status_a = "PASS" if pass_a else "FAIL"
        else:
            limit_a = round(float(tolerance.single_de00_limit * 1.5), 2)
            critical_a = False
            pass_a = delta_e00_a <= limit_a + 1e-4
            severity_a = "INFO" if pass_a else "WARNING"
            status_a = "PASS" if pass_a else "WARN"

        checks.append({
            "metric": "delta_e00_a",
            "label": "A (Akkor) CIEDE2000 Renk Farkı",
            "actual": round(float(delta_e00_a), 3),
            "limit": round(float(limit_a), 3),
            "operator": "<=",
            "status": status_a,
            "severity": severity_a
        })

    # 3. Tertiary Illuminant F11 / TL84 (Commercial Store) Check
    pass_f11 = True
    critical_f11 = False
    if delta_e00_f11 is not None:
        if profile is not None and getattr(profile, "gate_limit_f11", None) is not None:
            limit_f11 = profile.gate_limit_f11
            critical_f11 = True
            pass_f11 = delta_e00_f11 <= limit_f11 + 1e-4
            severity_f11 = "INFO" if pass_f11 else "CRITICAL"
            status_f11 = "PASS" if pass_f11 else "FAIL"
        else:
            limit_f11 = round(float(tolerance.single_de00_limit * 1.5), 2)
            critical_f11 = False
            pass_f11 = delta_e00_f11 <= limit_f11 + 1e-4
            severity_f11 = "INFO" if pass_f11 else "WARNING"
            status_f11 = "PASS" if pass_f11 else "WARN"

        checks.append({
            "metric": "delta_e00_f11",
            "label": "F11 / TL84 CIEDE2000 Renk Farkı",
            "actual": round(float(delta_e00_f11), 3),
            "limit": round(float(limit_f11), 3),
            "operator": "<=",
            "status": status_f11,
            "severity": severity_f11
        })

    # 4. Multi-Illuminant Stability & Match Error Spread (MI_composite)
    if profile is not None:
        if profile.id == "light_stability":
            mi_limit = profile.gate_limit_mi if profile.gate_limit_mi is not None else tolerance.composite_mi_limit
            mi_critical = True
        elif profile.gate_limit_mi is not None:
            mi_limit = profile.gate_limit_mi
            mi_critical = True
        else:
            mi_limit = tolerance.composite_mi_limit
            mi_critical = False
    else:
        mi_limit = tolerance.composite_mi_limit
        mi_critical = True

    mi_pass = composite_mi <= mi_limit + 1e-4
    mi_status = "PASS" if mi_pass else ("FAIL" if mi_critical else "WARN")
    mi_severity = "INFO" if mi_pass else ("CRITICAL" if mi_critical else "WARNING")

    checks.append({
        "metric": "composite_metamerism",
        "label": "Bileşik Metamerizm / Aydınlatıcı Yayılım İndeksi (MI)",
        "actual": round(float(composite_mi), 3),
        "limit": round(float(mi_limit), 3),
        "operator": "<=",
        "status": mi_status,
        "severity": mi_severity
    })

    # 5. Maximum Pigment Paste Mass / Economy Constraint
    if profile is not None and profile.id == "economy":
        if profile.gate_limit_load is not None:
            eff_max_load = profile.gate_limit_load
        elif profile.gate_load_budget_ratio is not None:
            eff_max_load = max_total_load * profile.gate_load_budget_ratio
        elif baseline_load is not None and baseline_load > 0:
            eff_max_load = baseline_load * 0.90
        else:
            eff_max_load = max_total_load

        load_pass = total_load <= eff_max_load + 1e-4
        checks.append({
            "metric": "total_load",
            "label": "Ekonomi Toplam Pasta Yükü (%)",
            "actual": round(float(total_load), 3),
            "limit": round(float(eff_max_load), 3),
            "operator": "<=",
            "status": "PASS" if load_pass else "FAIL",
            "severity": "INFO" if load_pass else "CRITICAL"
        })
    else:
        load_pass = total_load <= max_total_load + 1e-4
        checks.append({
            "metric": "total_load",
            "label": "Toplam Pasta Yükü (%)",
            "actual": round(float(total_load), 3),
            "limit": round(float(max_total_load), 3),
            "operator": "<=",
            "status": "PASS" if load_pass else "FAIL",
            "severity": "INFO" if load_pass else "CRITICAL"
        })

    # 6. Minimum Pigment Paste Mass Constraint (if configured)
    min_load_pass = True
    if min_total_load > 0.0:
        min_load_pass = total_load >= min_total_load - 1e-4
        checks.append({
            "metric": "min_total_load",
            "label": "Minimum Pasta Yükü (%)",
            "actual": round(float(total_load), 3),
            "limit": round(float(min_total_load), 3),
            "operator": ">=",
            "status": "PASS" if min_load_pass else "FAIL",
            "severity": "INFO" if min_load_pass else "CRITICAL"
        })

    # 7. SLSQP Solver Convergence
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

    # Overall Acceptance Gate Decision
    critical_illuminants_pass = (pass_a if critical_a else True) and (pass_f11 if critical_f11 else True)
    critical_mi_pass = mi_pass if mi_critical else True
    overall_pass = de_pass and critical_mi_pass and load_pass and min_load_pass and solver_pass and critical_illuminants_pass

    failures = [
        f"{c['label']} ({c['actual']}) {c['operator']} {c['limit']} şartını sağlamadı."
        for c in checks if c["status"] == "FAIL"
    ]

    return {
        "gate_type": "FORMULATION_GATE",
        "status": "PASS" if overall_pass else "FAIL",
        "profile_id": profile.id if profile else None,
        "profile_name": profile.name if profile else None,
        "tolerance_profile": tolerance.name,
        "overall_severity": "INFO" if overall_pass else "CRITICAL",
        "checks": checks,
        "failures": failures,
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
