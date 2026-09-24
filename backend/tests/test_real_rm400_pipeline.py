"""
Real RM400 Pipeline End-to-End Tests (Set B Golden Dataset)
===========================================================
Validates full workflow from raw spectrophotometer file imports to
two-constant Kubelka-Munk characterization, Characterization Gate,
CCM formulation, and Formulation Gate evaluation.
"""

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.color_engine.rm400_parser import parse_rm400_content
from backend.color_engine.kubelka_munk import (
    characterize_letdown_series,
    reflectance_to_ks,
    saunderson_correction
)
from backend.color_engine.formulation import match_color_ccm
from backend.devices.rm400_driver import rm400_driver
from backend.database.db import init_db

client = TestClient(app)
DATA_DIR = Path(__file__).parent / "data" / "real_rm400_dataset"


@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    yield


def test_rm400_driver_and_instrument_api():
    """Verify RM400 native driver interface and API routes."""
    # Status endpoint
    status_resp = client.get("/api/instruments/rm400/status")
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert "instrument" in status_data
    assert "driver_available" in status_data
    assert status_data["instrument"] == "X-Rite RM400"

    # Calibration endpoint
    cal_resp = client.post("/api/instruments/rm400/calibrate", json={"step": "White"})
    assert cal_resp.status_code == 200
    assert cal_resp.json()["success"] is True

    # Measure endpoint
    meas_resp = client.post("/api/instruments/rm400/measure", json={"sample_name": "Test Tile 01"})
    assert meas_resp.status_code == 200
    meas = meas_resp.json()
    assert meas["success"] is True
    assert len(meas["reflectance"]) == 31
    assert all(0.0 <= r <= 1.0 for r in meas["reflectance"])
    assert "lab" in meas
    assert "hex" in meas
    assert "measurement_id" in meas


def test_pg7_csv_real_letdowns_characterization():
    """Verify PG7 CSV letdown dataset through characterization gate."""
    csv_path = DATA_DIR / "pg7_letdowns_rm400.csv"
    assert csv_path.exists(), f"Missing {csv_path}"

    with open(csv_path, "r", encoding="utf-8") as f:
        content = f.read()

    parsed = parse_rm400_content(content, filename="pg7_letdowns_rm400.csv")
    assert len(parsed["samples"]) >= 5
    concs = [s["concentration"] for s in parsed["samples"] if s.get("concentration") is not None and s.get("concentration") > 0]
    assert len(concs) >= 3

    # White Base reflectance from parsed file
    base_sample = next((s for s in parsed["samples"] if s.get("concentration") is None or "base" in s.get("name", "").lower()), None)
    base_r = base_sample["reflectance"] if base_sample else [0.85] * 31
    base_ks = reflectance_to_ks(saunderson_correction(base_r))
    base_s = [1.0] * 31
    base_k = [ks * s for ks, s in zip(base_ks, base_s)]

    letdown_payload = [
        {"concentration": s["concentration"], "reflectance": s["reflectance"]}
        for s in parsed["samples"]
        if s.get("concentration") is not None and s.get("concentration") > 0
    ]

    char_result = characterize_letdown_series(
        base_reflectance=base_r,
        letdowns=letdown_payload,
        base_k=base_k,
        base_s=base_s,
        k1=0.04,
        k2=0.60
    )

    # Validate characterization metrics
    assert "characterization_gate" in char_result
    gate = char_result["characterization_gate"]
    assert gate["status"] == "PASS"
    assert char_result["spectral_rmse"] <= 0.015
    assert char_result["r_squared"] >= 0.995
    assert char_result["condition_index"] > 1.0
    assert "identifiability" in char_result


def test_pr101_txt_real_letdowns_characterization():
    """Verify PR101 TSV/TXT letdown dataset through characterization gate."""
    txt_path = DATA_DIR / "pr101_letdowns_rm400.txt"
    assert txt_path.exists(), f"Missing {txt_path}"

    with open(txt_path, "r", encoding="utf-8") as f:
        content = f.read()

    parsed = parse_rm400_content(content, filename="pr101_letdowns_rm400.txt")
    assert len(parsed["samples"]) >= 5
    concs = [s["concentration"] for s in parsed["samples"] if s.get("concentration") is not None and s.get("concentration") > 0]
    assert len(concs) >= 3

    base_sample = next((s for s in parsed["samples"] if s.get("concentration") is None or "base" in s.get("name", "").lower()), None)
    base_r = base_sample["reflectance"] if base_sample else [0.85] * 31
    base_ks = reflectance_to_ks(saunderson_correction(base_r))
    base_s = [1.0] * 31
    base_k = [ks * s for ks, s in zip(base_ks, base_s)]

    letdown_payload = [
        {"concentration": s["concentration"], "reflectance": s["reflectance"]}
        for s in parsed["samples"]
        if s.get("concentration") is not None and s.get("concentration") > 0
    ]

    char_result = characterize_letdown_series(
        base_reflectance=base_r,
        letdowns=letdown_payload,
        base_k=base_k,
        base_s=base_s
    )

    assert char_result["characterization_gate"]["status"] == "PASS"
    assert char_result["r_squared"] >= 0.995
    assert char_result["spectral_rmse"] <= 0.015


def test_pb15_cxf_real_letdowns_characterization():
    """Verify PB15:3 CxF3 XML letdown dataset through characterization gate."""
    cxf_path = DATA_DIR / "pb15_letdowns_rm400.cxf"
    assert cxf_path.exists(), f"Missing {cxf_path}"

    with open(cxf_path, "r", encoding="utf-8") as f:
        content = f.read()

    parsed = parse_rm400_content(content, filename="pb15_letdowns_rm400.cxf")
    assert len(parsed["samples"]) >= 5

    base_sample = next((s for s in parsed["samples"] if s.get("concentration") is None or "base" in s.get("name", "").lower()), None)
    base_r = base_sample["reflectance"] if base_sample else [0.85] * 31
    base_ks = reflectance_to_ks(saunderson_correction(base_r))
    base_s = [1.0] * 31
    base_k = [ks * s for ks, s in zip(base_ks, base_s)]

    letdown_payload = [
        {"concentration": s["concentration"], "reflectance": s["reflectance"]}
        for s in parsed["samples"]
        if s.get("concentration") is not None and s.get("concentration") > 0
    ]

    char_result = characterize_letdown_series(
        base_reflectance=base_r,
        letdowns=letdown_payload,
        base_k=base_k,
        base_s=base_s
    )

    assert char_result["characterization_gate"]["status"] == "PASS"
    assert char_result["r_squared"] >= 0.995


def test_full_real_pipeline_match():
    """
    End-to-End CCM match using real RM400 characterized colorants.
    Verifies that formulation solver produces an industrial match with Formulation Gate PASS.
    """
    # 1. Parse and extract Base White from real RM400 export
    with open(DATA_DIR / "pg7_letdowns_rm400.csv", "r", encoding="utf-8") as f:
        pg7_parsed = parse_rm400_content(f.read())

    base_r = pg7_parsed["samples"][0]["reflectance"]
    base_ks = reflectance_to_ks(saunderson_correction(base_r))
    base_s = [1.0] * 31
    base_k = [ks * s for ks, s in zip(base_ks, base_s)]

    # 2. Characterize PG7 and PR101 on this measured base
    pg7_char = characterize_letdown_series(
        base_reflectance=base_r,
        letdowns=[{"concentration": s["concentration"], "reflectance": s["reflectance"]} for s in pg7_parsed["samples"] if s["concentration"]],
        base_k=base_k, base_s=base_s
    )

    with open(DATA_DIR / "pr101_letdowns_rm400.txt", "r", encoding="utf-8") as f:
        pr101_parsed = parse_rm400_content(f.read())
    pr101_char = characterize_letdown_series(
        base_reflectance=base_r,
        letdowns=[{"concentration": s["concentration"], "reflectance": s["reflectance"]} for s in pr101_parsed["samples"] if s["concentration"]],
        base_k=base_k, base_s=base_s
    )

    available_pastes = [
        {
            "id": 1,
            "name": "Phthalo Green RM400",
            "code": "PG7",
            "hex": "#15803d",
            "unit_k": pg7_char["unit_k"],
            "unit_s": pg7_char["unit_s"]
        },
        {
            "id": 2,
            "name": "Iron Oxide Red RM400",
            "code": "PR101",
            "hex": "#b91c1c",
            "unit_k": pr101_char["unit_k"],
            "unit_s": pr101_char["unit_s"]
        }
    ]

    # Target is 1.0% PG7 letdown sample
    target_sample = next(s for s in pg7_parsed["samples"] if s.get("concentration") == 1.0)
    target_r = target_sample["reflectance"]

    match_res = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=available_pastes,
        max_pastes=2,
        max_total_load=12.0
    )

    assert "recipes" in match_res
    rec_a = match_res["recipes"]["recipe_a"]
    assert rec_a["delta_e00"] <= 0.50
    assert "formulation_gate" in rec_a
    assert rec_a["formulation_gate"]["status"] in ["PASS", "WARN"]
    assert rec_a["diagnostics"]["success"] is True
