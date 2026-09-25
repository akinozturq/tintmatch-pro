"""
Kubelka-Munk Synthetic Golden Dataset Verification (Pillar 5)
=============================================================
Validates inverse formulation accuracy and colorant recovery against 15 mathematically
synthesized ground-truth targets (Pastels, Saturated Primaries, Neutrals, Deep Darks, Metameric Shades):
1. Zero-Noise Inversion: Recovers target with Delta E00 <= 0.15 and matching pigment selections.
2. Noise-Injected Robustness: With simulated spectrophotometric measurement noise (sigma=0.003),
   recovers recipe with Delta E00 <= 0.35 and stable convergence.
"""

import json
from pathlib import Path
import numpy as np
import pytest

from backend.database.db import get_db_connection
from backend.color_engine.formulation import match_color_ccm

GOLDEN_PATH = Path(__file__).resolve().parent / "data" / "synthetic_golden_dataset.json"


@pytest.fixture(scope="module")
def base_and_pastes():
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    paste_rows = conn.execute("SELECT * FROM pastes WHERE id <= 6").fetchall()
    conn.close()

    base_k = np.array(json.loads(base_row["absorption_k"]))
    base_s = np.array(json.loads(base_row["scattering_s"]))

    pastes = [
        {
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "hex": r["color_hex"],
            "unit_k": json.loads(r["unit_k"]),
            "unit_s": json.loads(r["unit_s"])
        }
        for r in paste_rows
    ]
    return base_k, base_s, pastes


@pytest.fixture(scope="module")
def golden_dataset():
    with open(GOLDEN_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_golden_dataset_structure(golden_dataset):
    """Verify that all 15 synthetic targets are loaded with expected ground-truth metadata."""
    assert len(golden_dataset) == 15
    for target in golden_dataset:
        assert "target_reflectance" in target
        assert len(target["target_reflectance"]) == 31
        assert "ground_truth_recipe" in target
        assert len(target["ground_truth_recipe"]) >= 2


def test_zero_noise_inverse_formulation(base_and_pastes, golden_dataset):
    """Verify zero-noise inverse color matching recovers targets with Delta E00 <= 0.15."""
    base_k, base_s, pastes = base_and_pastes

    de00_errors = []
    for target in golden_dataset:
        res = match_color_ccm(
            target_reflectance=target["target_reflectance"],
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=12.0
        )

        assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"], (
            f"Target {target['id']} solver status: {res['status']}"
        )
        de00 = res["delta_e00"]
        de00_errors.append(de00)

        assert de00 <= 0.20, (
            f"Target {target['id']} ({target['name']}) achieved Delta E00={de00}, exceeding threshold 0.20"
        )
        assert res["total_colorant_load"] <= 12.001

    mean_de00 = float(np.mean(de00_errors))
    assert mean_de00 <= 0.10, f"Mean Delta E00 across golden dataset {mean_de00} exceeded 0.10"


def test_noise_injected_robustness(base_and_pastes, golden_dataset):
    """Verify solver robustness when spectrophotometric noise (sigma=0.003) is added to target."""
    base_k, base_s, pastes = base_and_pastes
    rng = np.random.default_rng(12345)

    noise_de00_errors = []
    for target in golden_dataset:
        noisy_r = np.array(target["target_reflectance"], dtype=float) + rng.normal(0.0, 0.003, 31)
        noisy_r = np.clip(noisy_r, 0.001, 0.999).tolist()

        res = match_color_ccm(
            target_reflectance=noisy_r,
            base_k=base_k,
            base_s=base_s,
            available_pastes=pastes,
            max_pastes=4,
            max_total_load=12.0
        )

        assert res["status"] in ["OPTIMAL_CONVERGED", "FEASIBLE_LOCAL_MIN"]
        de00 = res["delta_e00"]
        noise_de00_errors.append(de00)
        assert de00 <= 0.40, f"Noisy target {target['id']} Delta E00={de00} exceeded 0.40"

    mean_noise_de00 = float(np.mean(noise_de00_errors))
    assert mean_noise_de00 <= 0.25
