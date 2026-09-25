"""
Test Spectrum Normalizer Module
===============================
Verifies centralized spectral normalization:
- PCHIP interpolation without Runge overshoot
- Monotonicity and deduplication
- Scaling (0-1 vs 0-100%)
- Rejection of ambiguous arrays
"""

import numpy as np
import pytest
from backend.color_engine.spectrum_normalizer import normalize_spectrum
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.colorimetry import reflectance_to_xyz, reflectance_to_lab


def test_standard_31_point_passthrough():
    """Exact 31 points 400-700 nm should pass through with boundary clamping."""
    sample = np.linspace(0.1, 0.9, 31)
    res = normalize_spectrum(sample)
    assert len(res) == 31
    assert np.allclose(res, sample)
    assert np.all(res >= 0.0) and np.all(res <= 1.0)


def test_percentage_scale_auto_conversion():
    """Values in 0-100% range should be automatically divided by 100."""
    sample_pct = np.linspace(10.0, 90.0, 31)
    res = normalize_spectrum(sample_pct)
    assert np.all(res <= 1.0)
    assert np.isclose(res[0], 0.10)
    assert np.isclose(res[-1], 0.90)


def test_ambiguous_length_rejection():
    """Passing non-31 points without explicit wavelengths must raise ValueError."""
    with pytest.raises(ValueError, match="Explicit wavelength coordinate array must be provided"):
        normalize_spectrum([0.5] * 36)

    with pytest.raises(ValueError, match="Explicit wavelength coordinate array must be provided"):
        normalize_spectrum([0.5] * 16)


def test_wide_grid_interpolation_380_to_730():
    """380-730 nm @ 10 nm (36 points) must interpolate cleanly to 31 points without Runge overshoot."""
    wls_36 = np.arange(380, 740, 10)  # 380, 390, ..., 730 (36 points)
    # Steep cliff: low reflectance then sharp jump
    refl_36 = np.where(wls_36 < 500, 0.05, 0.95)

    res = normalize_spectrum(refl_36, wavelengths=wls_36)
    assert len(res) == 31
    assert np.all(res >= 0.0) and np.all(res <= 1.0)
    # Check that 400 nm is low and 700 nm is high
    assert res[0] < 0.10
    assert res[-1] > 0.90


def test_fine_grid_5nm_interpolation():
    """400-700 nm @ 5 nm (61 points) should interpolate cleanly onto 31 points."""
    wls_61 = np.arange(400, 705, 5)
    refl_61 = 0.5 + 0.4 * np.sin(np.linspace(0, np.pi, len(wls_61)))

    res = normalize_spectrum(refl_61, wavelengths=wls_61)
    assert len(res) == 31
    assert np.all(res >= 0.0) and np.all(res <= 1.0)
    # Values at matching wavelengths should match closely
    assert np.isclose(res[0], refl_61[0], atol=1e-3)
    assert np.isclose(res[-1], refl_61[-1], atol=1e-3)


def test_colorimetry_rejects_silent_truncation():
    """reflectance_to_xyz should raise ValueError if 36 points are passed without wavelengths."""
    bad_refl = [0.5] * 36
    with pytest.raises(ValueError):
        reflectance_to_xyz(bad_refl)

    # But should succeed if wavelengths are provided!
    wls_36 = np.arange(380, 740, 10)
    xyz = reflectance_to_xyz(bad_refl, wavelengths=wls_36)
    assert len(xyz) == 3
    assert all(v > 0 for v in xyz)


def test_duplicate_wavelength_group_averaging():
    """Duplicate wavelength measurements should be averaged rather than silently dropped."""
    # 400 nm measured twice: 0.40 and 0.60 -> average must be 0.50
    wls = [400, 400] + list(range(410, 710, 10))
    refl = [0.40, 0.60] + [0.50] * 30
    res = normalize_spectrum(refl, wavelengths=wls)
    assert len(res) == 31
    assert np.isclose(res[0], 0.50, atol=1e-3)


def test_nan_inf_and_invalid_wavelength_rejection():
    """NaN, Inf, non-positive wavelengths and empty inputs must raise ValueError."""
    # NaN in reflectance
    with pytest.raises(ValueError, match="NaN or infinite"):
        normalize_spectrum([np.nan] * 31)

    # Inf in reflectance
    with pytest.raises(ValueError, match="NaN or infinite"):
        normalize_spectrum([np.inf] * 31)

    # NaN in wavelengths
    with pytest.raises(ValueError, match="NaN or infinite"):
        wls = list(range(400, 710, 10))
        wls[5] = np.nan
        normalize_spectrum([0.5] * 31, wavelengths=wls)

    # Non-positive wavelength
    with pytest.raises(ValueError, match="strictly positive"):
        wls = list(range(400, 710, 10))
        wls[0] = -400
        normalize_spectrum([0.5] * 31, wavelengths=wls)

    # Empty array
    with pytest.raises(ValueError, match="cannot be empty"):
        normalize_spectrum([])
