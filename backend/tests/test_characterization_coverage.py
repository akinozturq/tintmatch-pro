"""
TintMatch PRO - Characterization Comprehensive Coverage Test Suite
==================================================================
Exhaustive test suite covering:
- Saunderson surface correction forward/inverse Fresnel transformations
- Two-Constant and Single-Constant Kubelka-Munk derivation
- Letdown dilution series characterization & back-prediction residuals
- X-Rite RM400 raw file parser (CSV, TXT, XML/CxF, corrupted files)
- Characterization FastAPI router endpoints (calculate, save, samples, import)
"""

import io
import json
import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
from backend.color_engine.saunderson import saunderson_correction, inverse_saunderson
from backend.color_engine.kubelka_munk import (
    reflectance_to_ks,
    ks_to_reflectance,
    forward_two_constant_km,
    calculate_opacity_contrast_ratio,
    characterize_letdown_series,
)
from backend.color_engine.rm400_parser import (
    parse_rm400_content,
    get_industrial_sample_datasets,
    generate_sample_rm400_csv,
    _extract_concentration,
    _is_float,
)
from backend.database.db import get_db_connection

client = TestClient(app)


# ============================================================================
# 1. Saunderson Surface Correction Unit Coverage
# ============================================================================

def test_saunderson_boundary_conditions():
    """Test Saunderson behavior at extreme reflectance boundaries: 0, k1, 1."""
    k1 = 0.04
    k2 = 0.60

    # At R_m = k1, internal reflectance should be exactly 0
    r_int_zero = saunderson_correction(k1, k1=k1, k2=k2)
    assert abs(r_int_zero) < 1e-6

    # At R_m = 1.0, internal reflectance should be 1.0
    r_int_one = saunderson_correction(1.0, k1=k1, k2=k2)
    assert abs(r_int_one - 1.0) < 1e-4

    # Inverse transformation at 0 and 1
    r_meas_zero = inverse_saunderson(0.0, k1=k1, k2=k2)
    assert abs(r_meas_zero - k1) < 1e-5

    r_meas_one = inverse_saunderson(1.0, k1=k1, k2=k2)
    assert abs(r_meas_one - 1.0) < 5e-4


def test_saunderson_vector_and_custom_fresnel():
    """Test vector array evaluation with non-standard k1 and k2 parameters."""
    for k1 in [0.02, 0.04, 0.06]:
        for k2 in [0.45, 0.60, 0.70]:
            r_meas = np.linspace(k1 + 0.02, 0.95, 31)
            r_int = saunderson_correction(r_meas, k1=k1, k2=k2)
            assert np.all(r_int >= 0.0)
            assert np.all(r_int <= 1.0)

            # Invert
            r_rec = inverse_saunderson(r_int, k1=k1, k2=k2)
            np.testing.assert_allclose(r_meas, r_rec, atol=1e-5)


# ============================================================================
# 2. Kubelka-Munk Core Mathematics Coverage
# ============================================================================

def test_ks_transform_extremes():
    """Verify K/S transformations near 0 and near 1."""
    # Near zero reflectance -> huge K/S
    r_low = np.array([0.001])
    ks_high = reflectance_to_ks(r_low)
    assert ks_high[0] > 400.0

    # Near 1.0 reflectance -> near zero K/S
    r_high = np.array([0.999])
    ks_low = reflectance_to_ks(r_high)
    assert ks_low[0] < 0.001

    # Invert roundtrip
    r_back = ks_to_reflectance(ks_high)
    np.testing.assert_allclose(r_low, r_back, atol=1e-5)


def test_single_constant_vs_two_constant_derivation():
    """Verify that both single-constant and two-constant characterization execute cleanly."""
    datasets = get_industrial_sample_datasets()
    base_r = datasets["base_a"]["reflectance"]
    letdowns = datasets["colorants"]["PG7"]["letdowns"]

    # 1. Two-constant mode
    two_const = characterize_letdown_series(
        base_reflectance=base_r,
        letdowns=letdowns,
        k1=0.04,
        k2=0.60,
        use_two_constant=True
    )
    assert "Two-Constant" in two_const["model_type"]
    assert two_const["passed_validation"] is True
    assert two_const["mean_delta_e00"] < 0.30
    assert len(two_const["unit_k"]) == 31
    assert len(two_const["unit_s"]) == 31
    assert len(two_const["unit_ks"]) == 31

    # 2. Single-constant mode
    single_const = characterize_letdown_series(
        base_reflectance=base_r,
        letdowns=letdowns,
        k1=0.04,
        k2=0.60,
        use_two_constant=False
    )
    assert "Single-Constant" in single_const["model_type"]
    assert len(single_const["unit_k"]) == 31
    assert len(single_const["unit_s"]) == 31
    assert len(single_const["unit_ks"]) == 31
    assert len(single_const["back_predictions"]) == len(letdowns)


def test_forward_km_with_various_backgrounds():
    """Verify forward Kubelka-Munk over white and black backgrounds (contrast ratio)."""
    k = np.full(31, 0.05)
    s = np.full(31, 0.8)

    # Infinite thickness
    r_inf_black = forward_two_constant_km(k, s, thickness=500.0, Rg=0.0)
    r_inf_white = forward_two_constant_km(k, s, thickness=500.0, Rg=1.0)
    np.testing.assert_allclose(r_inf_black, r_inf_white, atol=1e-2)

    # Thin film shows background influence
    r_thin_black = forward_two_constant_km(k, s, thickness=10.0, Rg=0.04)
    r_thin_white = forward_two_constant_km(k, s, thickness=10.0, Rg=0.82)
    assert np.mean(r_thin_white) > np.mean(r_thin_black)


def test_all_sample_pigments_two_constant_residuals():
    """Verify that all 3 industrial datasets (PG7, PR101, PB15) meet strict ΔE00 < 0.30."""
    datasets = get_industrial_sample_datasets()
    base_r = datasets["base_a"]["reflectance"]

    for code in ["PG7", "PR101", "PB15"]:
        letdowns = datasets["colorants"][code]["letdowns"]
        res = characterize_letdown_series(
            base_reflectance=base_r,
            letdowns=letdowns,
            k1=0.04,
            k2=0.60,
            use_two_constant=True
        )
        assert res["passed_validation"] is True, f"{code} failed: mean dE00={res['mean_delta_e00']}"
        assert res["mean_delta_e00"] < 0.30

        # Each concentration must also individually perform well
        for bp in res["back_predictions"]:
            assert bp["delta_e00"] < 0.50, f"{code} conc {bp['concentration']}% dE00 was {bp['delta_e00']}"


# ============================================================================
# 3. RM400 File Parser Deep Coverage
# ============================================================================

def test_rm400_parser_csv_vertical_delimiters():
    """Test vertical column parsing with comma, tab, and semicolon."""
    wls = [400 + i * 10 for i in range(31)]

    # Semicolon
    csv_semi = "Wavelength;PG7 1.0%;PR101 2.5%\n" + "\n".join(
        f"{w};{(0.1 + i*0.01):.4f};{(0.2 + i*0.015):.4f}" for i, w in enumerate(wls)
    )
    res_semi = parse_rm400_content(csv_semi)
    assert len(res_semi["samples"]) == 2
    assert res_semi["samples"][0]["concentration"] == 1.0
    assert res_semi["samples"][1]["concentration"] == 2.5

    # Comma
    csv_comma = "Wavelength,PG7 0.5%,PB15:3 5.0%\n" + "\n".join(
        f"{w},{(0.1 + i*0.01):.4f},{(0.15 + i*0.012):.4f}" for i, w in enumerate(wls)
    )
    res_comma = parse_rm400_content(csv_comma)
    assert len(res_comma["samples"]) == 2
    assert res_comma["samples"][0]["concentration"] == 0.5

    # Tab
    csv_tab = "Wavelength\tSample A 10.0%\n" + "\n".join(
        f"{w}\t{(0.05 + i*0.01):.4f}" for i, w in enumerate(wls)
    )
    res_tab = parse_rm400_content(csv_tab)
    assert len(res_tab["samples"]) == 1
    assert res_tab["samples"][0]["concentration"] == 10.0


def test_rm400_parser_percentage_scaling():
    """Verify that reflectance given in 0-100% is normalized to 0.0-1.0."""
    csv_pct = "Wavelength;Sample_Pct 1%\n" + "\n".join(
        f"{400+i*10};{(10.0 + i*1.5):.2f}" for i in range(31)
    )
    res = parse_rm400_content(csv_pct)
    refl = res["samples"][0]["reflectance"]
    assert np.max(refl) <= 1.0
    assert abs(refl[0] - 0.10) < 1e-4


def test_rm400_parser_horizontal_row_layout():
    """Verify parsing when each sample is a row containing 31 spectral values."""
    wls = "\t".join(str(400 + i * 10) for i in range(31))
    sample1 = "Letdown_0.1%\t" + "\t".join(f"{(0.1 + i*0.01):.4f}" for i in range(31))
    sample2 = "Letdown_2.5%\t" + "\t".join(f"{(0.2 + i*0.005):.4f}" for i in range(31))

    text = f"Sample\t{wls}\n{sample1}\n{sample2}\n"
    res = parse_rm400_content(text)
    assert len(res["samples"]) == 2
    assert len(res["samples"][0]["reflectance"]) == 31


def test_rm400_parser_xml_cxf_format():
    """Verify parsing XML / CxF spectrophotometer files."""
    spectral_values = " ".join(f"{(0.08 + i*0.01):.4f}" for i in range(31))
    xml_content = f"""<?xml version="1.0" encoding="utf-8"?>
    <CxF xmlns="http://colorexchangeformat.com/CxF3-core">
      <FileInformation>
        <Creator>X-Rite RM400</Creator>
      </FileInformation>
      <ColorSpecification>
        <Measurement Name="PG7 Green 2.5%">
          <ReflectanceSpectrum>
            {spectral_values}
          </ReflectanceSpectrum>
        </Measurement>
      </ColorSpecification>
    </CxF>
    """
    res = parse_rm400_content(xml_content)
    assert res["format"] == "XML/CxF3"
    assert len(res["samples"]) >= 1
    assert len(res["samples"][0]["reflectance"]) == 31
    assert res["samples"][0]["concentration"] == 2.5


def test_rm400_parser_corrupted_inputs():
    """Ensure parser gracefully handles corrupted or insufficient data."""
    # Empty string
    res_empty = parse_rm400_content("")
    assert len(res_empty["samples"]) == 0
    assert len(res_empty["warnings"]) > 0

    # Too few wavelengths
    too_few = "Wavelength;Sample\n400;0.5\n410;0.6\n420;0.7\n"
    res_few = parse_rm400_content(too_few)
    assert len(res_few["samples"]) == 0

    # Helper functions
    assert _is_float("3.1415") is True
    assert _is_float("3,1415") is True
    assert _is_float("not_a_number") is False

    assert _extract_concentration("Sample 2.5%") == 2.5
    assert _extract_concentration("Conc: 10%") == 10.0
    assert _extract_concentration("c=0.1") == 0.1
    assert _extract_concentration("NoConcHere") is None


def test_sample_rm400_csv_generator():
    """Verify CSV generator for all sample pigments."""
    for key in ["PG7", "PR101", "PB15"]:
        csv_str = generate_sample_rm400_csv(key)
        assert "Wavelength" in csv_str
        assert "400" in csv_str
        assert "700" in csv_str
        parsed = parse_rm400_content(csv_str)
        # 1 base + 6 letdowns = 7 columns
        assert len(parsed["samples"]) == 7


# ============================================================================
# 4. FastAPI Characterization Router End-to-End Tests
# ============================================================================

def test_api_characterization_samples_endpoints():
    """Verify samples list, individual sample detail, and CSV sample download."""
    # 1. Samples list
    resp = client.get("/api/characterization/samples")
    assert resp.status_code == 200
    data = resp.json()
    assert "samples" in data
    assert len(data["samples"]) >= 3

    # 2. Specific sample
    resp_sample = client.get("/api/characterization/samples/PR101")
    assert resp_sample.status_code == 200
    sample_data = resp_sample.json()
    assert sample_data["colorant"]["code"] == "PR101"

    # 3. 404 for unknown sample
    resp_404 = client.get("/api/characterization/samples/UNKNOWN_CODE")
    assert resp_404.status_code == 404

    # 4. Sample CSV download
    resp_csv = client.get("/api/characterization/samples/PG7/csv")
    assert resp_csv.status_code == 200
    assert "csv" in resp_csv.json()
    assert "RM400_PG7_Letdowns.csv" in resp_csv.json()["filename"]


def test_api_characterization_calculate_variants():
    """Test /api/characterization/calculate with valid, single-constant, and error payloads."""
    samp_resp = client.get("/api/characterization/samples/PG7")
    letdowns = samp_resp.json()["colorant"]["letdowns"]

    # 1. Valid two-constant calculation
    resp_two = client.post("/api/characterization/calculate", json={
        "base_id": 1,
        "letdowns": letdowns,
        "k1": 0.04,
        "k2": 0.60,
        "use_two_constant": True
    })
    assert resp_two.status_code == 200
    data_two = resp_two.json()
    assert data_two["passed_validation"] is True
    assert data_two["mean_delta_e00"] < 0.30

    # 2. Valid single-constant calculation
    resp_single = client.post("/api/characterization/calculate", json={
        "base_id": 1,
        "letdowns": letdowns,
        "use_two_constant": False
    })
    assert resp_single.status_code == 200
    assert "Single-Constant" in resp_single.json()["model_type"]

    # 3. Custom 31-point base reflectance without base_id
    custom_base_r = [0.85] * 31
    resp_custom_base = client.post("/api/characterization/calculate", json={
        "base_reflectance": custom_base_r,
        "letdowns": letdowns
    })
    assert resp_custom_base.status_code == 200

    # 4. Error: empty letdowns
    resp_empty = client.post("/api/characterization/calculate", json={
        "base_id": 1,
        "letdowns": []
    })
    assert resp_empty.status_code == 400

    # 5. Error: non-existent base_id and no custom reflectance
    resp_bad_base = client.post("/api/characterization/calculate", json={
        "base_id": 99999,
        "letdowns": letdowns
    })
    assert resp_bad_base.status_code == 400


def test_api_characterization_save_workflow():
    """Verify calculating, then saving characterization into SQLite DB and listing it."""
    samp_resp = client.get("/api/characterization/samples/PB15")
    colorant = samp_resp.json()["colorant"]
    letdowns = colorant["letdowns"]

    # Calculate
    calc_resp = client.post("/api/characterization/calculate", json={
        "base_id": 1,
        "letdowns": letdowns,
        "use_two_constant": True
    })
    assert calc_resp.status_code == 200
    calc_data = calc_resp.json()

    # Save
    import time
    test_code = f"PB15-TEST-{time.time_ns()}"
    save_payload = {
        "name": f"Test Characterized Blue {test_code}",
        "code": test_code,
        "color_hex": "#0033aa",
        "density": 1.25,
        "base_id": 1,
        "k1": 0.04,
        "k2": 0.60,
        "instrument": "X-Rite RM400 Test Rig",
        "letdowns": letdowns,
        "calculation_results": calc_data
    }
    save_resp = client.post("/api/characterization/save", json=save_payload)
    assert save_resp.status_code == 200
    save_result = save_resp.json()
    assert save_result["success"] is True
    new_paste_id = save_result["paste_id"]
    assert new_paste_id > 0

    # Verify newly saved paste is retrievable via /api/pastes
    pastes_resp = client.get("/api/pastes")
    assert pastes_resp.status_code == 200
    all_pastes = pastes_resp.json()
    found = any(p["id"] == new_paste_id for p in all_pastes)
    assert found is True

    # Error case: save with missing calculation matrices
    bad_save = client.post("/api/characterization/save", json={
        "name": "Corrupted Paste",
        "code": "CORRUPT",
        "density": 1.0,
        "base_id": 1,
        "letdowns": letdowns,
        "calculation_results": {}
    })
    assert bad_save.status_code == 400


def test_api_import_rm400_multipart_and_raw_text():
    """Verify /api/characterization/import-rm400 via raw_text and multipart file upload."""
    csv_text = generate_sample_rm400_csv("PG7")

    # 1. Via raw_text Form parameter
    resp_text = client.post("/api/characterization/import-rm400", data={"raw_text": csv_text})
    assert resp_text.status_code == 200
    assert len(resp_text.json()["samples"]) == 7

    # 2. Via multipart File upload
    csv_bytes = csv_text.encode("utf-8")
    files = {"file": ("test_rm400.csv", io.BytesIO(csv_bytes), "text/csv")}
    resp_file = client.post("/api/characterization/import-rm400", files=files)
    assert resp_file.status_code == 200
    assert len(resp_file.json()["samples"]) == 7

    # 3. Missing both file and raw_text -> 400
    resp_bad = client.post("/api/characterization/import-rm400")
    assert resp_bad.status_code == 400


def test_loocv_validation_and_tolerance_gate():
    """Verify LOOCV out-of-sample prediction and ToleranceProfile gate check."""
    datasets = get_industrial_sample_datasets()
    base_r = datasets["base_a"]["reflectance"]
    letdowns = datasets["colorants"]["PG7"]["letdowns"]  # 6 letdowns

    # 1. Full 6 letdowns -> LOOCV should be evaluated
    char_full = characterize_letdown_series(base_r, letdowns, use_two_constant=True)
    assert "loocv" in char_full
    assert char_full["loocv"]["status"] == "LOOCV_EVALUATED"
    assert char_full["loocv"]["samples_count"] == 6
    assert isinstance(char_full["loocv"]["mean_delta_e00"], float)
    assert char_full["loocv"]["mean_delta_e00"] <= 0.50
    assert len(char_full["loocv"]["errors"]) == 6

    # Verify quality gate includes LOOCV check
    qg = char_full["characterization_gate"]
    loocv_check = next((c for c in qg["checks"] if c["metric"] == "loocv_mean_delta_e00"), None)
    assert loocv_check is not None
    assert loocv_check["status"] == "PASS"
    assert loocv_check["limit"] == 0.50

    # 2. Subset with 3 letdowns -> LOOCV skipped due to n < 4 degrees-of-freedom constraint
    char_short = characterize_letdown_series(base_r, letdowns[:3], use_two_constant=True)
    assert char_short["loocv"]["status"] == "LOOCV_SKIPPED_INSUFFICIENT_LETDOWNS"
    assert char_short["loocv"]["samples_count"] == 3
    assert char_short["loocv"]["mean_delta_e00"] is None


def test_dual_metric_jacobian_condition():
    """Verify Jacobian diagnostics provides both scaled and raw condition numbers."""
    datasets = get_industrial_sample_datasets()
    base_r = datasets["base_a"]["reflectance"]
    letdowns = datasets["colorants"]["PG7"]["letdowns"]

    char = characterize_letdown_series(base_r, letdowns, use_two_constant=True)
    assert "jacobian_diagnostics" in char
    diag = char["jacobian_diagnostics"]
    assert "scaled_condition_number" in diag
    assert "raw_condition_number" in diag
    assert "status" in diag
    assert char["jacobian_condition_number"] == diag["scaled_condition_number"]
    assert diag["status"] in ("WELL_CONDITIONED", "MODERATELY_ILL_CONDITIONED", "SEVERELY_ILL_CONDITIONED")
