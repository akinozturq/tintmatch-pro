"""
TintMatch PRO - FastAPI End-to-End Integration Tests
====================================================
Tests all REST endpoints, file upload parsing, characterization calculation,
formulation prediction, and report generation.
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["spectral_channels"] == 31


def test_list_bases():
    response = client.get("/api/bases")
    assert response.status_code == 200
    bases = response.json()
    assert len(bases) >= 4
    # Ensure Base A is opaque
    base_a = next(b for b in bases if b["code"] == "BASE-A")
    assert base_a["contrast_ratio"] >= 98.0
    assert base_a["is_opaque"] is True


def test_list_pastes():
    response = client.get("/api/pastes")
    assert response.status_code == 200
    pastes = response.json()
    assert len(pastes) >= 6
    # Check that all pre-characterized pastes pass validation
    for p in pastes:
        assert p["passed_validation"] is True
        assert p["mean_delta_e00"] < 0.30


def test_characterization_samples_and_calculate():
    # 1. Fetch sample dataset
    samp_resp = client.get("/api/characterization/samples/PG7")
    assert samp_resp.status_code == 200
    samp_data = samp_resp.json()
    letdowns = samp_data["colorant"]["letdowns"]
    assert len(letdowns) == 6

    # 2. Run characterization calculation
    calc_payload = {
        "base_id": 1,
        "letdowns": letdowns,
        "k1": 0.04,
        "k2": 0.60,
        "use_two_constant": True
    }
    calc_resp = client.post("/api/characterization/calculate", json=calc_payload)
    assert calc_resp.status_code == 200
    calc_data = calc_resp.json()

    assert calc_data["passed_validation"] is True
    assert calc_data["mean_delta_e00"] < 0.30
    assert len(calc_data["unit_k"]) == 31
    assert len(calc_data["unit_s"]) == 31


def test_rm400_import_endpoint():
    csv_content = "# X-Rite RM400 Export\nWavelength;PG7_1%\n" + "\n".join(f"{400+i*10};{(0.1+i*0.01):.4f}" for i in range(31))
    resp = client.post("/api/characterization/import-rm400", data={"raw_text": csv_content})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["samples"]) >= 1
    assert len(data["samples"][0]["reflectance"]) == 31


def test_formulation_predict():
    payload = {
        "base_id": 1,
        "pastes": [
            {"id": 1, "name": "Phthalo Green", "concentration": 2.0},
            {"id": 5, "name": "Bismuth Yellow", "concentration": 1.5}
        ],
        "k1": 0.04,
        "k2": 0.60
    }
    resp = client.post("/api/formulation/predict", json=payload)
    assert resp.status_code == 200
    sim = resp.json()
    assert len(sim["reflectance"]) == 31
    assert "hex" in sim
    assert sim["hex"].startswith("#")
    assert "lab" in sim
    assert "contrast_ratio" in sim


def test_iso18314_report_and_csv():
    # JSON report
    resp = client.get("/api/reports/characterization/1/iso18314")
    assert resp.status_code == 200
    rep = resp.json()
    assert "report_id" in rep
    assert "ISO 18314" in rep["standard"]
    assert rep["validation_statistics"]["passed"] is True

    # CSV matrix download
    csv_resp = client.get("/api/reports/characterization/1/csv")
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers.get("content-type", "")
    assert "Wavelength_nm" in csv_resp.text
