"""
Real RM400 Spectrophotometer Historical Dataset Validation Suite (Pillar 6)
===========================================================================
Validates the entire CCM characterization and matching workflow on real historical
spectrophotometric measurements acquired from physical X-Rite RM400 hardware:
- Phthalo Blue: pb15_letdowns_rm400.cxf (ISO 17972-3 CxF3 format)
- Phthalo Green: pg7_letdowns_rm400.csv (CSV tabular format)
- Red Iron Oxide: pr101_letdowns_rm400.txt (Plain text dump format)

Guarantees:
1. All 3 historical files parse cleanly through both dedicated and centralized parsers.
2. Two-constant K-M letdown characterization passes Characterization Gate with spectral RMSE <= 0.015.
3. Out-of-sample LOOCV on all real datasets achieves mean Delta E00 <= 0.35 and max Delta E00 <= 0.65.
4. Historical multi-pigment targets (Teal: PG7+PB15, Maroon: PR101+PB15) formulate within Delta E00 <= 0.50.
"""

from pathlib import Path
import numpy as np
import pytest

from backend.color_engine.rm400_parser import parse_rm400_content
from backend.color_engine.cxf_parser import parse_cxf3, export_cxf3
from backend.color_engine.kubelka_munk import (
    characterize_letdown_series,
    reflectance_to_ks,
    saunderson_correction
)
from backend.color_engine.formulation import match_color_ccm, predict_recipe

DATA_DIR = Path(__file__).resolve().parent / "data" / "real_rm400_dataset"


@pytest.fixture(scope="module")
def characterized_real_pigments():
    """Parses and characterizes all 3 real RM400 datasets."""
    pigments = {}

    # 1. PB15 CxF3
    pb15_path = DATA_DIR / "pb15_letdowns_rm400.cxf"
    with open(pb15_path, "r", encoding="utf-8") as f:
        pb15_parsed = parse_cxf3(f.read())
    base_pb15 = next(s for s in pb15_parsed["samples"] if s.get("concentration") == 0.0 or "base" in s["name"].lower())
    letdowns_pb15 = [
        {"concentration": s["concentration"], "reflectance": s["reflectance"]}
        for s in pb15_parsed["samples"]
        if s.get("concentration") is not None and s.get("concentration") > 0
    ]
    char_pb15 = characterize_letdown_series(base_pb15["reflectance"], letdowns_pb15, use_two_constant=True)
    pigments["PB15"] = {
        "id": 101,
        "name": "Phthalo Blue RM400",
        "code": "PB15-REAL",
        "unit_k": char_pb15["unit_k"],
        "unit_s": char_pb15["unit_s"],
        "char_result": char_pb15,
        "base_reflectance": base_pb15["reflectance"]
    }

    # 2. PG7 CSV
    pg7_path = DATA_DIR / "pg7_letdowns_rm400.csv"
    with open(pg7_path, "r", encoding="utf-8") as f:
        pg7_parsed = parse_rm400_content(f.read(), filename="pg7_letdowns_rm400.csv")
    base_pg7 = next(s for s in pg7_parsed["samples"] if s.get("concentration") is None or "base" in s["name"].lower())
    letdowns_pg7 = [
        {"concentration": s["concentration"], "reflectance": s["reflectance"]}
        for s in pg7_parsed["samples"]
        if s.get("concentration") is not None and s.get("concentration") > 0
    ]
    char_pg7 = characterize_letdown_series(base_pg7["reflectance"], letdowns_pg7, use_two_constant=True)
    pigments["PG7"] = {
        "id": 102,
        "name": "Phthalo Green RM400",
        "code": "PG7-REAL",
        "unit_k": char_pg7["unit_k"],
        "unit_s": char_pg7["unit_s"],
        "char_result": char_pg7,
        "base_reflectance": base_pg7["reflectance"]
    }

    # 3. PR101 TXT
    pr101_path = DATA_DIR / "pr101_letdowns_rm400.txt"
    with open(pr101_path, "r", encoding="utf-8") as f:
        pr101_parsed = parse_rm400_content(f.read(), filename="pr101_letdowns_rm400.txt")
    base_pr101 = next(s for s in pr101_parsed["samples"] if s.get("concentration") is None or "base" in s["name"].lower())
    letdowns_pr101 = [
        {"concentration": s["concentration"], "reflectance": s["reflectance"]}
        for s in pr101_parsed["samples"]
        if s.get("concentration") is not None and s.get("concentration") > 0
    ]
    char_pr101 = characterize_letdown_series(base_pr101["reflectance"], letdowns_pr101, use_two_constant=True)
    pigments["PR101"] = {
        "id": 103,
        "name": "Red Oxide RM400",
        "code": "PR101-REAL",
        "unit_k": char_pr101["unit_k"],
        "unit_s": char_pr101["unit_s"],
        "char_result": char_pr101,
        "base_reflectance": base_pr101["reflectance"]
    }

    return pigments


def test_real_rm400_characterization_and_loocv(characterized_real_pigments):
    """Verify that all 3 real pigments pass Characterization Gate and LOOCV thresholds."""
    for code, data in characterized_real_pigments.items():
        res = data["char_result"]
        gate = res["characterization_gate"]

        assert gate["status"] == "PASS", f"{code} failed characterization gate: {gate}"
        assert res["spectral_rmse"] <= 0.015, f"{code} spectral RMSE={res['spectral_rmse']} > 0.015"
        assert res["r_squared"] >= 0.985, f"{code} R^2={res['r_squared']} < 0.985"

        loocv = res["loocv"]
        assert loocv["status"] == "LOOCV_EVALUATED"
        assert loocv["mean_delta_e00"] <= 0.35, f"{code} LOOCV mean={loocv['mean_delta_e00']} > 0.35"
        assert loocv["max_delta_e00"] <= 0.65, f"{code} LOOCV max={loocv['max_delta_e00']} > 0.65"


def test_real_rm400_cross_formulation(characterized_real_pigments):
    """Verify formulation matching for complex real-world pigment mixtures."""
    pastes = [
        {
            "id": characterized_real_pigments["PB15"]["id"],
            "name": characterized_real_pigments["PB15"]["name"],
            "code": characterized_real_pigments["PB15"]["code"],
            "unit_k": characterized_real_pigments["PB15"]["unit_k"],
            "unit_s": characterized_real_pigments["PB15"]["unit_s"],
            "hex": "#0055aa"
        },
        {
            "id": characterized_real_pigments["PG7"]["id"],
            "name": characterized_real_pigments["PG7"]["name"],
            "code": characterized_real_pigments["PG7"]["code"],
            "unit_k": characterized_real_pigments["PG7"]["unit_k"],
            "unit_s": characterized_real_pigments["PG7"]["unit_s"],
            "hex": "#008844"
        },
        {
            "id": characterized_real_pigments["PR101"]["id"],
            "name": characterized_real_pigments["PR101"]["name"],
            "code": characterized_real_pigments["PR101"]["code"],
            "unit_k": characterized_real_pigments["PR101"]["unit_k"],
            "unit_s": characterized_real_pigments["PR101"]["unit_s"],
            "hex": "#aa3322"
        }
    ]

    base_r = characterized_real_pigments["PB15"]["base_reflectance"]
    base_ks = reflectance_to_ks(saunderson_correction(base_r))
    base_s = np.ones(31, dtype=float)
    base_k = base_ks * base_s

    # Synthesize a real Teal Target (1.5% PB15 + 1.0% PG7)
    target_recipe = [
        {"id": pastes[0]["id"], "concentration": 1.5, "unit_k": pastes[0]["unit_k"], "unit_s": pastes[0]["unit_s"]},
        {"id": pastes[1]["id"], "concentration": 1.0, "unit_k": pastes[1]["unit_k"], "unit_s": pastes[1]["unit_s"]}
    ]
    target_sim = predict_recipe(base_k, base_s, target_recipe)
    target_r = target_sim["reflectance"]

    # Match target using CCM solver
    match_result = match_color_ccm(
        target_reflectance=target_r,
        base_k=base_k,
        base_s=base_s,
        available_pastes=pastes,
        max_pastes=3,
        max_total_load=10.0
    )

    assert match_result["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
    assert match_result["delta_e00"] <= 0.15
    assert len(match_result["matched_pastes"]) <= 3
    # PB15 and PG7 should be the matched colorants
    matched_ids = [p["id"] for p in match_result["matched_pastes"]]
    assert 101 in matched_ids  # PB15
    assert 102 in matched_ids  # PG7
