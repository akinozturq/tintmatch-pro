"""
TintMatch PRO - Color Science & CCM Engine Unit Tests
=====================================================
Validates Saunderson surface correction, Kubelka-Munk two-constant optimization,
CIEDE2000 color difference, Metamerism Index, and RM400 parser.
"""

import pytest
import numpy as np

from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.saunderson import saunderson_correction, inverse_saunderson
from backend.color_engine.kubelka_munk import (
    reflectance_to_ks,
    ks_to_reflectance,
    forward_two_constant_km,
    calculate_opacity_contrast_ratio,
    characterize_letdown_series
)
from backend.color_engine.colorimetry import (
    reflectance_to_xyz,
    reflectance_to_lab,
    reflectance_to_hex,
    ciede2000,
    compute_metamerism_index
)
from backend.color_engine.rm400_parser import (
    parse_rm400_content,
    get_industrial_sample_datasets
)


def test_saunderson_roundtrip():
    """Verify that forward and inverse Saunderson correction invert accurately."""
    r_meas = np.linspace(0.05, 0.90, 31)
    k1 = 0.04
    k2 = 0.60

    r_int = saunderson_correction(r_meas, k1=k1, k2=k2)
    r_reconstructed = inverse_saunderson(r_int, k1=k1, k2=k2)

    np.testing.assert_allclose(r_meas, r_reconstructed, atol=1e-5)


def test_ks_roundtrip():
    """Verify Kubelka-Munk K/S transformation inverts accurately."""
    r_int = np.array([0.1, 0.3, 0.5, 0.7, 0.85])
    ks = reflectance_to_ks(r_int)
    r_back = ks_to_reflectance(ks)

    np.testing.assert_allclose(r_int, r_back, atol=1e-5)


def test_ciede2000_identical_colors():
    """Identical colors must have delta E00 = 0.0."""
    lab = [50.0, 10.0, -20.0]
    diff = ciede2000(lab, lab)
    assert diff["delta_e00"] == 0.0
    assert diff["passed"] is True


def test_ciede2000_threshold_check():
    """Small difference under 0.30 should pass, larger difference should fail."""
    lab1 = [60.0, 12.0, 25.0]
    lab2 = [60.1, 12.05, 25.1]
    diff_small = ciede2000(lab1, lab2)
    assert diff_small["delta_e00"] < 0.30
    assert diff_small["passed"] is True

    lab3 = [60.0, 15.0, 30.0]
    diff_large = ciede2000(lab1, lab3)
    assert diff_large["delta_e00"] > 0.30
    assert diff_large["passed"] is False


def test_opacity_contrast_ratio():
    """Opaque white base must have contrast ratio >= 98.0%."""
    k = np.full(31, 0.015)
    s = np.full(31, 1.0)
    cr_info = calculate_opacity_contrast_ratio(k, s, thickness=100.0)

    assert cr_info["luminous_contrast_ratio"] >= 98.0
    assert cr_info["is_opaque"] is True


def test_sample_datasets_validation_threshold():
    """All industrial calibration datasets must validate with mean Delta E00 < 0.30."""
    datasets = get_industrial_sample_datasets()
    base_r = datasets["base_a"]["reflectance"]

    for key, colorant in datasets["colorants"].items():
        res = characterize_letdown_series(
            base_reflectance=base_r,
            letdowns=colorant["letdowns"],
            k1=0.04,
            k2=0.60,
            use_two_constant=True
        )
        assert res["passed_validation"] is True, f"{key} failed validation: dE00={res['mean_delta_e00']}"
        assert res["mean_delta_e00"] < 0.30, f"{key} mean dE00 {res['mean_delta_e00']} >= 0.30"


def test_metamerism_index():
    """Verify Metamerism Index computation across illuminants."""
    r_std = np.full(31, 0.5)
    r_sample = np.full(31, 0.51)
    mi = compute_metamerism_index(r_sample, r_std)

    assert "dE00_D65" in mi
    assert "dE00_A" in mi
    assert "dE00_F11" in mi
    assert mi["MI_A"] < 0.5


def test_rm400_parser():
    """Verify parsing of RM400 tabular spectral text."""
    csv_text = "Wavelength;Sample_1\n" + "\n".join(f"{400 + i*10};{(0.1 + i*0.01):.4f}" for i in range(31))
    parsed = parse_rm400_content(csv_text)

    assert len(parsed["samples"]) >= 1
    assert len(parsed["samples"][0]["reflectance"]) == 31
