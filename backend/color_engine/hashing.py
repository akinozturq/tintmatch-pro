"""
TintMatch PRO - Canonical Hashing & Provenance Module
=====================================================
Provides deterministic SHA-256 canonical hashing for:
1. CCM formulation inputs (target spectrum, base optics, available colorants, constraints).
2. Computed recipe outputs (matched paste IDs, concentrations, predicted delta E).
3. Spectrophotometer measurement payloads.

Guarantees input-order invariance (order of candidate colorants does not affect hash)
and float quantization tolerance.
"""

import hashlib
import json
import numpy as np


def compute_formulation_input_hash(
    target_reflectance: list[float] | np.ndarray,
    base_k: list[float] | np.ndarray,
    base_s: list[float] | np.ndarray,
    available_pastes: list[dict],
    max_pastes: int = 4,
    max_total_load: float = 12.0,
    k1: float = 0.04,
    k2: float = 0.60,
    profile_id: str | None = None
) -> str:
    """
    Computes a canonical, order-independent SHA-256 hash of formulation input parameters.
    """
    # 1. Quantized target spectrum (5 decimals)
    r_target_q = [round(float(v), 5) for v in target_reflectance]
    bk_q = [round(float(v), 5) for v in base_k]
    bs_q = [round(float(v), 5) for v in base_s]

    # 2. Canonical sorted pastes representation (sorted by id or code)
    canonical_pastes = []
    for p in available_pastes:
        p_id = str(p.get("id", ""))
        p_code = str(p.get("code", ""))
        uk = [round(float(v), 5) for v in p.get("unit_k", [])]
        us = [round(float(v), 5) for v in p.get("unit_s", [])]
        canonical_pastes.append({
            "id": p_id,
            "code": p_code,
            "unit_k": uk,
            "unit_s": us
        })

    # Sort strictly by id then code to guarantee permutation invariance
    canonical_pastes.sort(key=lambda x: (x["id"], x["code"]))

    canonical_dict = {
        "target_reflectance": r_target_q,
        "base_k": bk_q,
        "base_s": bs_q,
        "pastes": canonical_pastes,
        "max_pastes": int(max_pastes),
        "max_total_load": round(float(max_total_load), 4),
        "k1": round(float(k1), 4),
        "k2": round(float(k2), 4),
        "profile_id": str(profile_id or "default")
    }

    raw_json = json.dumps(canonical_dict, sort_keys=True)
    return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()


def compute_recipe_output_hash(
    matched_pastes: list[dict],
    delta_e00: float,
    total_load: float
) -> str:
    """
    Computes a deterministic hash of the final formulation recipe.
    """
    sorted_pastes = sorted(
        [
            (str(p.get("id")), str(p.get("code", "")), round(float(p.get("concentration", 0.0)), 4))
            for p in matched_pastes
        ],
        key=lambda x: x[0]
    )

    recipe_dict = {
        "matched_pastes": sorted_pastes,
        "delta_e00": round(float(delta_e00), 3),
        "total_load": round(float(total_load), 4)
    }

    raw_json = json.dumps(recipe_dict, sort_keys=True)
    return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
