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
    profile_id: str | None = None,
    min_total_load: float = 0.0,
    profile_weights: dict | None = None,
    tolerance_profile_id: str | None = None,
    individual_bounds: dict[str, tuple[float, float]] | None = None,
    group_bounds: dict[str, float] | None = None,
    pigment_groups: dict[str, list[str]] | None = None,
    min_dispense_threshold: float = 0.0,
    enforce_simplex_sum: bool = False,
    enable_multistart: bool = False,
    num_starts: int = 3,
    engine_version: str = "2.2.0",
    batch_size_g: float = 1000.0,
    scale_resolution_g: float = 0.01,
    geometry: str | None = None,
    measurement_mode: str | None = None,
    optical_system: str | None = None
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
        "engine_version": str(engine_version),
        "target_reflectance": r_target_q,
        "base_k": bk_q,
        "base_s": bs_q,
        "pastes": canonical_pastes,
        "max_pastes": int(max_pastes),
        "max_total_load": round(float(max_total_load), 4),
        "min_total_load": round(float(min_total_load), 4) if min_total_load > 0.0 else 0.0,
        "k1": round(float(k1), 4),
        "k2": round(float(k2), 4),
        "profile_id": str(profile_id or "default"),
        "batch_size_g": round(float(batch_size_g), 2),
        "scale_resolution_g": round(float(scale_resolution_g), 4)
    }

    if geometry:
        canonical_dict["geometry"] = str(geometry)
    if measurement_mode:
        canonical_dict["measurement_mode"] = str(measurement_mode)
    if optical_system:
        canonical_dict["optical_system"] = str(optical_system)

    if profile_weights:
        canonical_dict["profile_weights"] = {
            k: round(float(v), 4) for k, v in profile_weights.items()
        }

    if tolerance_profile_id:
        canonical_dict["tolerance_profile_id"] = str(tolerance_profile_id)

    if individual_bounds:
        canonical_dict["individual_bounds"] = {
            str(k): [round(float(b[0]), 4), round(float(b[1]), 4)]
            for k, b in sorted(individual_bounds.items())
        }

    if group_bounds:
        canonical_dict["group_bounds"] = {
            str(k): round(float(v), 4) for k, v in sorted(group_bounds.items())
        }

    if pigment_groups:
        canonical_dict["pigment_groups"] = {
            str(k): sorted([str(item) for item in v]) for k, v in sorted(pigment_groups.items())
        }

    if min_dispense_threshold > 0.0:
        canonical_dict["min_dispense_threshold"] = round(float(min_dispense_threshold), 4)

    if enforce_simplex_sum:
        canonical_dict["enforce_simplex_sum"] = True

    if enable_multistart:
        canonical_dict["multistart"] = {
            "enabled": True,
            "num_starts": int(num_starts)
        }

    raw_json = json.dumps(canonical_dict, sort_keys=True)
    return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()


def compute_recipe_output_hash(
    matched_pastes: list[dict],
    delta_e00: float,
    total_load: float,
    batch_size_g: float | None = None,
    scale_resolution_g: float | None = None,
    base_amount_g: float | None = None
) -> str:
    """
    Computes a deterministic hash of the final formulation recipe including physical rounded amounts.
    """
    sorted_pastes = sorted(
        [
            (
                str(p.get("id")),
                str(p.get("code", "")),
                round(float(p.get("concentration", 0.0)), 4),
                round(float(p.get("amount_g", 0.0)), 2)
            )
            for p in matched_pastes
        ],
        key=lambda x: x[0]
    )

    recipe_dict: dict = {
        "matched_pastes": sorted_pastes,
        "delta_e00": round(float(delta_e00), 3),
        "total_load": round(float(total_load), 4)
    }

    if batch_size_g is not None:
        recipe_dict["batch_size_g"] = round(float(batch_size_g), 2)
    if scale_resolution_g is not None:
        recipe_dict["scale_resolution_g"] = round(float(scale_resolution_g), 4)
    if base_amount_g is not None:
        recipe_dict["base_amount_g"] = round(float(base_amount_g), 2)

    raw_json = json.dumps(recipe_dict, sort_keys=True)
    return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
