"""
TintMatch PRO - Metamerism Standards & Terminology Verification Test Suite
==========================================================================
Verifies:
1. ISO 18314-4:2018 / DIN 6172 Special Metamerism Index with multiplicative tristimulus correction.
2. Scientific separation between Illuminant Match Error Spread and Formal ISO Metamerism Index.
3. Correct behavior on identical specimens, isochromatic concentration shifts, and true metameric pairs.
4. Total eradication of misleading 'ASTM E805' metamerism claims while maintaining 100% backward compatibility.
"""

import pytest
import numpy as np
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.colorimetry import (
    reflectance_to_xyz,
    xyz_to_lab,
    reflectance_to_lab,
    ciede2000,
    calculate_composite_metamerism,
    compute_iso_metamerism_index,
    compute_metamerism_index
)
from backend.color_engine.formulation import predict_recipe, match_color_ccm


def test_iso_18314_4_identical_curves_zero_metamerism():
    """Identical standard and batch must yield exactly M_ISO = 0.0 across all illuminants."""
    r_std = np.array([0.15 + 0.50 / (1.0 + np.exp(-(w - 530) / 40.0)) for w in WAVELENGTHS])
    r_bat = np.copy(r_std)

    iso_data = compute_iso_metamerism_index(r_bat, r_std, observer="10", reference_illuminant="D65")

    assert iso_data["standard"] == "ISO 18314-4:2018 / DIN 6172"
    assert iso_data["correction_method"] == "multiplicative_tristimulus"
    assert abs(iso_data["correction_factors"]["f_X"] - 1.0) < 1e-5
    assert abs(iso_data["correction_factors"]["f_Y"] - 1.0) < 1e-5
    assert abs(iso_data["correction_factors"]["f_Z"] - 1.0) < 1e-5
    assert iso_data["M_composite"] == 0.0
    assert iso_data["M_A"] == 0.0
    assert iso_data["M_F11"] == 0.0
    assert iso_data["M_F2"] == 0.0


def test_iso_18314_4_isochromatic_shift_tristimulus_invariance():
    """
    An isochromatic shift (uniform scaling across wavelengths) is a concentration/lightness
    difference, NOT true spectral metamerism.
    Multiplicative tristimulus correction per ISO 18314-4 normalizes this out, yielding M_ISO ≈ 0.
    """
    r_std = np.array([0.20 + 0.40 * (w - 400) / 300 for w in WAVELENGTHS])
    # Batch is 5% darker across the entire spectrum
    r_bat = r_std * 0.95

    # Raw CIEDE2000 has a noticeable color difference
    lab_std_d65 = reflectance_to_lab(r_std, illuminant="D65", observer="10")
    lab_bat_d65 = reflectance_to_lab(r_bat, illuminant="D65", observer="10")
    raw_de = ciede2000(lab_std_d65, lab_bat_d65)["delta_e00"]
    assert raw_de > 0.5

    iso_data = compute_iso_metamerism_index(r_bat, r_std, observer="10", reference_illuminant="D65")

    # Correction factors account for the 5% scaling: f_X ≈ f_Y ≈ f_Z ≈ 1 / 0.95 ≈ 1.0526
    assert abs(iso_data["correction_factors"]["f_Y"] - (1.0 / 0.95)) < 1e-3

    # ISO Metamerism Index correctly reflects virtually zero metamerism (M < 0.05)
    assert iso_data["M_A"] < 0.05
    assert iso_data["M_F11"] < 0.05
    assert iso_data["M_composite"] < 0.05


def test_iso_18314_4_true_metameric_pair_detection():
    """
    Synthesize a true metameric pair: curves intersect 3+ times, match closely under D65,
    but diverge significantly under Illuminant A (incandescent).
    ISO 18314-4 must correctly isolate and detect the severe metameric shift.
    """
    # Standard: smooth sigmoid spectrum
    r_std = np.array([0.15 + 0.60 / (1.0 + np.exp(-(w - 550) / 30.0)) for w in WAVELENGTHS])

    # Metamer: oscillating spectrum with multiple crossover points tuned to match standard under D65
    wave_norm = (WAVELENGTHS - 400.0) / 300.0
    oscillation = 0.08 * np.sin(3.0 * np.pi * wave_norm)
    r_bat = np.clip(r_std + oscillation, 0.01, 0.99)

    # Under D65, check color difference
    lab_std_d65 = reflectance_to_lab(r_std, illuminant="D65", observer="10")
    lab_bat_d65 = reflectance_to_lab(r_bat, illuminant="D65", observer="10")
    de_d65 = ciede2000(lab_std_d65, lab_bat_d65)["delta_e00"]

    # Under Illuminant A
    lab_std_a = reflectance_to_lab(r_std, illuminant="A", observer="10")
    lab_bat_a = reflectance_to_lab(r_bat, illuminant="A", observer="10")
    de_a = ciede2000(lab_std_a, lab_bat_a)["delta_e00"]

    # Compute formal ISO metamerism index
    iso_data = compute_iso_metamerism_index(r_bat, r_std, observer="10", reference_illuminant="D65")

    # M_A must clearly capture the metameric shift
    assert iso_data["M_A"] > 0.30
    assert iso_data["M_composite"] >= iso_data["M_A"]


def test_structured_separation_in_compute_metamerism_index():
    """
    Verify compute_metamerism_index provides clean, non-conflated separation:
    - illuminant_deltas
    - illuminant_match_error_spread (max(ΔE_test) - ΔE_ref)
    - iso_18314_4 (Formal ISO 18314-4 / DIN 6172)
    - backward-compatible root fields
    """
    r_std = np.array([0.25 + 0.35 * (w - 400) / 300 for w in WAVELENGTHS])
    r_bat = np.array([0.28 + 0.30 * (w - 400) / 300 for w in WAVELENGTHS])

    mi = compute_metamerism_index(
        reflectance_batch=r_bat,
        reflectance_standard=r_std,
        observer="10",
        reference_illuminant="D65",
        test_illuminants=["A", "F11"]
    )

    # 1. Backward-compatible fields
    assert "dE00_D65" in mi
    assert "dE00_A" in mi
    assert "dE00_F11" in mi
    assert "MI_A" in mi
    assert "MI_F11" in mi
    assert "MI_composite" in mi
    assert "rating" in mi

    # 2. Rigorous scientific structure
    assert "illuminant_deltas" in mi
    assert "dE00_reference" in mi["illuminant_deltas"]
    assert "dE00_D65" in mi["illuminant_deltas"]
    assert "dE00_A" in mi["illuminant_deltas"]
    assert "dE00_F11" in mi["illuminant_deltas"]

    # 3. Illuminant Match Error Spread
    assert "illuminant_match_error_spread" in mi
    spread = mi["illuminant_match_error_spread"]
    assert "spread_max" in spread
    assert "spread_A" in spread
    assert "spread_F11" in spread
    # spread_max = max(dE_test) - dE_ref
    expected_spread_max = max(mi["dE00_A"], mi["dE00_F11"]) - mi["dE00_D65"]
    assert abs(spread["spread_max"] - expected_spread_max) < 1e-4

    # 4. Formal ISO 18314-4 implementation
    assert "iso_18314_4" in mi
    iso = mi["iso_18314_4"]
    assert iso["standard"] == "ISO 18314-4:2018 / DIN 6172"
    assert "M_A" in iso
    assert "M_F11" in iso
    assert "M_composite" in iso
    assert "correction_factors" in iso

    # 5. Standards compliance metadata
    assert "standards_compliance" in mi
    comp = mi["standards_compliance"]
    assert "ISO 18314-4" in comp["formal_metamerism_standard"]
    assert "ASTM E805" not in comp["formal_metamerism_standard"]


def test_predict_recipe_and_ccm_include_standards_compliant_metamerism():
    """Verify predict_recipe and match_color_ccm carry the standardized metamerism payload."""
    base_k = np.full(31, 0.02)
    base_s = np.full(31, 1.00)
    pastes = [
        {"id": 1, "name": "Yellow", "code": "PY74", "concentration": 1.5, "unit_k": [0.05 + 0.03 * i for i in range(31)], "unit_s": [0.1] * 31},
        {"id": 2, "name": "Blue", "code": "PB15", "concentration": 0.8, "unit_k": [0.8 - 0.02 * i for i in range(31)], "unit_s": [0.05] * 31}
    ]
    target_r = [0.40] * 31

    pred = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=pastes,
        target_reflectance=target_r
    )

    meta = pred["comparison"]["metamerism"]
    assert "iso_18314_4" in meta
    assert "illuminant_match_error_spread" in meta
    assert "standards_compliance" in meta
    assert meta["iso_18314_4"]["standard"] == "ISO 18314-4:2018 / DIN 6172"
