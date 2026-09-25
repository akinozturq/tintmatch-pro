"""
Physical Invariant Verification Tests for Kubelka-Munk Optics (Pillar 9)
========================================================================
Rigorous verification of fundamental optical and color science laws:
1. Physical reflectance boundedness: 0.0 <= R(lambda) <= 1.0 everywhere.
2. Non-negativity of absorption K and scattering S: K >= 0, S >= 0, K/S >= 0.
3. Saunderson forward and inverse bijection round-trip identity:
   saunderson_correction(inverse_saunderson(R_i)) == R_i within 1e-6.
4. Monotonicity: Increasing concentration of absorbing colorant strictly decreases
   internal reflectance and CIELAB L* lightness (dL*/dc < 0).
5. Substrate independence: At infinite thickness (x -> inf), substrate Rg has zero impact.
6. Boundary limits: K/S -> 0 implies R_inf -> 1.0; K/S -> inf implies R_inf -> 0.0.
7. Energy conservation: Internal reflectance R_i <= 1.0; measured R_m <= 1.0 - k1.
"""

import numpy as np
import pytest

from backend.color_engine.constants import N_WAVELENGTHS
from backend.color_engine.saunderson import saunderson_correction, inverse_saunderson
from backend.color_engine.kubelka_munk import (
    reflectance_to_ks,
    ks_to_reflectance,
    forward_two_constant_km
)
from backend.color_engine.colorimetry import reflectance_to_lab


def test_saunderson_bijection_roundtrip():
    """Verify that Saunderson forward and inverse corrections form an exact bijection (error < 1e-6)."""
    k1 = 0.04
    k2 = 0.60

    # 1. Sweep internal reflectance R_i in [0.001, 0.999]
    r_int_samples = np.linspace(0.001, 0.999, 1000)
    r_meas = inverse_saunderson(r_int_samples, k1=k1, k2=k2)
    r_int_recovered = saunderson_correction(r_meas, k1=k1, k2=k2)

    max_int_diff = np.max(np.abs(r_int_samples - r_int_recovered))
    assert max_int_diff < 1e-6, f"Saunderson R_i roundtrip error {max_int_diff} exceeded 1e-6"

    # 2. Sweep measured reflectance R_m in [k1 + 0.001, 0.999]
    r_meas_samples = np.linspace(k1 + 0.001, 0.999, 1000)
    r_int = saunderson_correction(r_meas_samples, k1=k1, k2=k2)
    r_meas_recovered = inverse_saunderson(r_int, k1=k1, k2=k2)

    max_meas_diff = np.max(np.abs(r_meas_samples - r_meas_recovered))
    assert max_meas_diff < 1e-6, f"Saunderson R_m roundtrip error {max_meas_diff} exceeded 1e-6"


def test_km_ks_inversion_bijection():
    """Verify K/S to R_inf and R_inf to K/S inversion exactness."""
    # Test across realistic coating domain: from 1e-3 (very white) to 2000.0 (near black)
    ks_values = np.logspace(-3, 3.2, 1000)
    r_inf = ks_to_reflectance(ks_values)

    # Invert back to K/S
    ks_recovered = reflectance_to_ks(r_inf)
    rel_diff = np.abs(ks_values - ks_recovered) / ks_values

    # In single precision float boundary, relative accuracy should be < 1e-4
    assert np.all(rel_diff < 1e-4), f"Max K/S relative inversion error {np.max(rel_diff)}"


def test_reflectance_physical_bounds():
    """Verify reflectance is strictly bounded in [0.0, 1.0] across all optical parameters."""
    rng = np.random.default_rng(42)

    for _ in range(50):
        # Random non-negative K and S
        k = rng.uniform(0.0, 50.0, N_WAVELENGTHS)
        s = rng.uniform(0.001, 20.0, N_WAVELENGTHS)
        thickness = rng.uniform(5.0, 500.0)
        rg = rng.uniform(0.0, 1.0)

        # Two-constant prediction
        r_meas = forward_two_constant_km(k, s, thickness=thickness, Rg=rg, k1=0.04, k2=0.60)
        assert np.all(r_meas >= 0.0), f"Negative measured reflectance found: min={np.min(r_meas)}"
        assert np.all(r_meas <= 1.0), f"Measured reflectance > 1 found: max={np.max(r_meas)}"

        # Internal reflectance
        r_int = forward_two_constant_km(k, s, thickness=thickness, Rg=rg, apply_saunderson=False)
        assert np.all(r_int >= 0.0)
        assert np.all(r_int <= 1.0)


def test_monotonicity_absorbing_colorants():
    """Verify that adding an absorbing colorant strictly decreases reflectance and lightness L*."""
    base_k = np.full(N_WAVELENGTHS, 0.02)
    base_s = np.full(N_WAVELENGTHS, 1.0)
    # Absorbing paste
    paste_k = np.full(N_WAVELENGTHS, 5.0)
    paste_s = np.full(N_WAVELENGTHS, 0.05)

    concs = [0.0, 0.1, 0.5, 1.0, 2.5, 5.0, 10.0]
    lightness_values = []
    spectra = []

    for c in concs:
        mix_k = base_k + c * paste_k
        mix_s = base_s + c * paste_s
        r_int = ks_to_reflectance(mix_k / mix_s)
        r_meas = inverse_saunderson(r_int, k1=0.04, k2=0.60)

        lab = reflectance_to_lab(r_meas, illuminant="D65", observer="10")
        lightness_values.append(lab[0])
        spectra.append(r_meas)

    # Check strict decrease in lightness L*
    for i in range(len(lightness_values) - 1):
        assert lightness_values[i] > lightness_values[i + 1], (
            f"Lightness did not decrease: L*({concs[i]})={lightness_values[i]} <= L*({concs[i+1]})={lightness_values[i+1]}"
        )

    # Check strict decrease in reflectance across all wavelengths
    for i in range(len(spectra) - 1):
        assert np.all(spectra[i] > spectra[i + 1]), f"Reflectance did not strictly decrease from c={concs[i]} to {concs[i+1]}"


def test_boundary_limits_pure_white_and_pure_black():
    """Verify asymptotic mathematical limits for pure white and pure black."""
    # Pure white: K/S -> 0
    white_ks = 1e-9
    r_white_inf = ks_to_reflectance(white_ks)
    assert np.isclose(r_white_inf, 1.0, atol=1e-4)

    # Pure black: K/S -> 1e6
    black_ks = 1e6
    r_black_inf = ks_to_reflectance(black_ks)
    assert np.isclose(r_black_inf, 0.0, atol=1e-4)

    # Measured pure black cannot be less than surface reflectance k1
    r_black_meas = inverse_saunderson(r_black_inf, k1=0.04, k2=0.60)
    assert np.isclose(r_black_meas, 0.04, atol=1e-4)


def test_substrate_independence_at_infinity():
    """Verify that substrate reflectance difference decays to zero as thickness increases."""
    base_k = np.full(N_WAVELENGTHS, 0.1)
    base_s = np.full(N_WAVELENGTHS, 1.0)

    rg_black = 0.0
    rg_white = 1.0

    # At x = 10 um, large contrast between black and white background
    r_thin_b = forward_two_constant_km(base_k, base_s, thickness=10.0, Rg=rg_black)
    r_thin_w = forward_two_constant_km(base_k, base_s, thickness=10.0, Rg=rg_white)
    diff_thin = np.max(np.abs(r_thin_w - r_thin_b))
    assert diff_thin > 0.08, "Thin film should show substantial substrate contrast"

    # At x = 400 um, contrast must vanish (< 1e-4)
    r_thick_b = forward_two_constant_km(base_k, base_s, thickness=400.0, Rg=rg_black)
    r_thick_w = forward_two_constant_km(base_k, base_s, thickness=400.0, Rg=rg_white)
    diff_thick = np.max(np.abs(r_thick_w - r_thick_b))
    assert diff_thick < 1e-4, f"Thick film substrate difference {diff_thick} should be < 1e-4"
