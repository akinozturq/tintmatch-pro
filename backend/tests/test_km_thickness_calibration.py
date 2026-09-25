"""
Tests for Kubelka-Munk Film Thickness-Scale Calibration (Pillar 4)
================================================================
Validates:
1. Asymptotic limits of Two-Constant Kubelka-Munk theory:
   - x -> infinity: R(x, Rg1) and R(x, Rg2) converge to R_inf.
   - x -> 0: R(x, Rg) converges to inverse_saunderson(Rg).
2. Monotonicity of Luminous Contrast Ratio CR(x) with respect to film thickness.
3. Critical hiding thickness calculation (x_98 for ASTM D2805 / ISO 2814 complete hiding).
4. Dual-substrate drawdown thickness inversion (recovering synthetic film thickness within 0.5 um).
"""

import numpy as np
import pytest

from backend.color_engine.constants import N_WAVELENGTHS
from backend.color_engine.kubelka_munk import (
    forward_two_constant_km,
    calculate_opacity_contrast_ratio,
    calculate_critical_hiding_thickness,
    calibrate_thickness_from_drawdown,
    reflectance_to_ks,
    ks_to_reflectance,
    saunderson_correction,
    inverse_saunderson
)


@pytest.fixture
def standard_paint_optical_properties():
    """Typical architectural coating optical properties (White Base A + tint)."""
    base_k = np.full(N_WAVELENGTHS, 0.05)
    base_s = np.full(N_WAVELENGTHS, 1.0)
    # Add absorption peak in blue
    base_k[0:10] += 0.15
    return base_k, base_s


def test_asymptotic_infinite_thickness_limit(standard_paint_optical_properties):
    """Verify that as thickness -> infinity (e.g. 400 um), R over black and white converge to R_inf."""
    K, S = standard_paint_optical_properties
    r_inf_int = ks_to_reflectance(K / S)
    r_inf_meas = inverse_saunderson(r_inf_int, k1=0.04, k2=0.60)

    # Thick film prediction (400 um)
    r_thick_black = forward_two_constant_km(K, S, thickness=400.0, Rg=0.04, k1=0.04, k2=0.60)
    r_thick_white = forward_two_constant_km(K, S, thickness=400.0, Rg=0.82, k1=0.04, k2=0.60)

    # Reflectance over black and white must be identical to R_inf within 1e-4
    assert np.allclose(r_thick_black, r_inf_meas, atol=1e-4)
    assert np.allclose(r_thick_white, r_inf_meas, atol=1e-4)
    assert np.allclose(r_thick_black, r_thick_white, atol=1e-4)


def test_asymptotic_zero_thickness_limit(standard_paint_optical_properties):
    """Verify that as thickness -> 0, R over substrate approaches substrate reflectance."""
    K, S = standard_paint_optical_properties
    rg = 0.50
    # Expected measured reflectance of substrate after surface reflection
    expected_r = inverse_saunderson(rg, k1=0.04, k2=0.60)

    r_thin = forward_two_constant_km(K, S, thickness=0.001, Rg=rg, k1=0.04, k2=0.60)
    assert np.allclose(r_thin, expected_r, atol=1e-3)


def test_contrast_ratio_monotonicity(standard_paint_optical_properties):
    """Verify that Luminous Contrast Ratio CR(x) monotonically increases with film thickness."""
    K, S = standard_paint_optical_properties
    thickness_steps = [10.0, 25.0, 50.0, 75.0, 100.0, 150.0, 200.0]
    cr_values = []

    for x in thickness_steps:
        cr_data = calculate_opacity_contrast_ratio(K, S, thickness=x, k1=0.04, k2=0.60)
        cr_values.append(cr_data["luminous_contrast_ratio"])

    # Monotonicity check (strictly increasing until saturation at 100%)
    for i in range(len(cr_values) - 1):
        if cr_values[i] < 99.9:
            assert cr_values[i] < cr_values[i + 1], f"CR({thickness_steps[i]}) >= CR({thickness_steps[i+1]})"
        else:
            assert cr_values[i] <= cr_values[i + 1], f"CR({thickness_steps[i]}) > CR({thickness_steps[i+1]})"

    assert cr_values[-1] >= 98.0, "High thickness (200 um) should achieve >= 98% hiding"


def test_critical_hiding_thickness_calculation(standard_paint_optical_properties):
    """Verify calculation of x_98 hiding thickness."""
    K, S = standard_paint_optical_properties
    x_98 = calculate_critical_hiding_thickness(K, S, target_cr=98.0)

    assert 10.0 < x_98 < 160.0
    cr_at_x98 = calculate_opacity_contrast_ratio(K, S, thickness=x_98)["luminous_contrast_ratio"]
    assert np.isclose(cr_at_x98, 98.0, atol=0.2)

    # For pure transparent clear coat, hiding should be infinite
    clear_k = np.full(N_WAVELENGTHS, 0.0001)
    clear_s = np.full(N_WAVELENGTHS, 0.0001)
    x_clear = calculate_critical_hiding_thickness(clear_k, clear_s, target_cr=98.0)
    assert np.isinf(x_clear)


def test_dual_substrate_thickness_inversion(standard_paint_optical_properties):
    """Verify that calibrate_thickness_from_drawdown accurately recovers synthetic film thickness."""
    K, S = standard_paint_optical_properties
    true_thickness = 85.0  # micrometers

    # Synthesize forward drawdown measurement
    r_black_meas = forward_two_constant_km(K, S, thickness=true_thickness, Rg=0.04, k1=0.04, k2=0.60)
    r_white_meas = forward_two_constant_km(K, S, thickness=true_thickness, Rg=0.82, k1=0.04, k2=0.60)

    # Perform inversion
    inversion_result = calibrate_thickness_from_drawdown(
        r_black=r_black_meas,
        r_white=r_white_meas,
        K=K,
        S=S,
        Rg_black=0.04,
        Rg_white=0.82,
        k1=0.04,
        k2=0.60
    )

    est_x = inversion_result["estimated_thickness_um"]
    assert abs(est_x - true_thickness) < 0.5, f"Recovered thickness {est_x} um differs from true {true_thickness} um"
    assert inversion_result["spectral_rmse"] < 1e-4
    assert inversion_result["optimization_success"] is True
    assert inversion_result["optical_depth_Sx"] > 0
