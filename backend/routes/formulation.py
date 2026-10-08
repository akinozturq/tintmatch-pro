"""
Formulation and Computer Color Matching (CCM) API Router
========================================================
Handles live simulation of recipe sliders, instant digital color swatch updates,
metamerism calculation, and automated color matching.
"""

import hashlib
import json
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..database.db import get_db_connection
from ..color_engine.constants import WAVELENGTHS
from ..color_engine.formulation import predict_recipe, match_color_ccm
from ..color_engine.colorimetry import reflectance_to_lab, reflectance_to_hex
from ..color_engine.profiles import STANDARD_OPTIMIZATION_PROFILES
from ..color_engine.constraints import FormulationConstraints

router = APIRouter(prefix="/api/formulation", tags=["formulation"])


class RecipePasteInput(BaseModel):
    id: int | str
    name: str = "Colorant"
    concentration: float = Field(0.0, description="Concentration percentage in recipe")
    unit_k: list[float] | None = None
    unit_s: list[float] | None = None


class PredictRecipeRequest(BaseModel):
    base_id: int = Field(1, json_schema_extra={"example": 1})
    pastes: list[RecipePasteInput]
    k1: float = Field(0.04, json_schema_extra={"example": 0.04})
    k2: float = Field(0.60, json_schema_extra={"example": 0.60})
    target_reflectance: list[float] | None = Field(None, description="Optional 31-point target spectrum")
    thickness: float = Field(100.0, json_schema_extra={"example": 100.0})
    forward_model: str = Field("opaque_infinite", description="Optical forward model: 'opaque_infinite' or 'finite_film'")
    substrate_rg: float = Field(0.82, description="Substrate reflectance Rg for finite film model")


class MatchTargetRequest(BaseModel):
    target_reflectance: list[float] = Field(..., description="31-point target spectral reflectance (400-700 nm)")
    base_id: int = Field(1, json_schema_extra={"example": 1})
    geometry: str | None = Field(None, description="Target optical geometry (e.g. '45°/0°', 'd/8°'). Mismatched bases/pastes are strictly rejected.")
    measurement_mode: str | None = Field(None, description="Target optical measurement mode ('SCI', 'SCE', 'SPEX')")
    optical_system: str | None = Field("bootstrap_v1", description="Optical bootstrap system identifier")
    paste_ids: list[int] | None = Field(None, description="Candidate paste IDs; if None, all library pastes are used")
    max_pastes: int = Field(4, json_schema_extra={"example": 4})
    max_total_load: float = Field(12.0, json_schema_extra={"example": 12.0})
    min_total_load: float = Field(0.0, description="Minimum allowed total colorant load (wt%)")
    min_dispense_threshold: float = Field(0.0, description="Minimum dispenser thresholding below which paste is pruned (wt%)")
    individual_bounds: dict[str, tuple[float, float]] | None = Field(None, description="Optional paste-specific [min, max] concentration bounds")
    group_bounds: dict[str, float] | None = Field(None, description="Optional chemical group upper limits (e.g. {'organic_yellow': 4.0})")
    pigment_groups: dict[str, list[str]] | None = Field(None, description="Mapping of chemical group names to paste IDs")
    enable_multistart: bool = Field(False, description="Enable multi-start SLSQP local optimization / multi-start search")
    num_starts: int = Field(3, description="Number of multi-start candidate points")
    k1: float = Field(0.04, json_schema_extra={"example": 0.04})
    k2: float = Field(0.60, json_schema_extra={"example": 0.60})
    profile_id: str | None = Field(None, description="Preferred profile: 'color_match', 'light_stability', 'economy'")
    forward_model: str = Field("opaque_infinite", description="Optical forward model: 'opaque_infinite' or 'finite_film'")
    film_thickness_um: float = Field(100.0, description="Film thickness in microns for finite-film matching")
    substrate_rg: float = Field(0.82, description="Substrate reflectance Rg for finite-film matching")
    batch_size_g: float = Field(1000.0, description="Target total batch size in grams (100g to 5000kg)")
    scale_resolution_g: float = Field(0.01, description="Scale resolution in grams (default 0.01g)")
    target_tolerance_de: float | None = Field(None, description="Custom CIEDE2000 commercial tolerance")


class SaveRecipeRequest(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Hospitality Sage Green"})
    base_id: int = Field(1, json_schema_extra={"example": 1})
    pastes: list[dict]
    predicted_reflectance: list[float]
    lab: dict
    hex_color: str
    delta_e00: float | None = None
    contrast_ratio: float | None = None
    profile_id: str | None = Field("color_match", json_schema_extra={"example": "color_match"})
    calculation_hash: str | None = None
    calculation_id: str | None = None
    engine_version: str | None = None
    geometry: str | None = Field(None, description="Optical geometry of formulation (e.g. '45°/0°', 'd/8°')")
    characterization_version: int | str | None = Field(None, description="Characterization version or session ID")
    active_characterization_ids: list[int] | None = Field(None, description="Exact characterization IDs used for pastes")
    quality_gate: dict | None = None
    k1: float = 0.04
    k2: float = 0.60
    composite_mi: float | None = None
    total_load: float | None = None
    target_reflectance: list[float] | None = None
    tolerance_profile_id: str | None = None
    max_pastes: int | None = None
    max_total_load: float | None = None
    min_total_load: float | None = None
    individual_bounds: dict[str, tuple[float, float]] | None = None
    group_bounds: dict[str, float] | None = None
    pigment_groups: dict[str, list[str]] | None = None
    min_dispense_threshold: float | None = None
    enable_multistart: bool | None = None
    num_starts: int | None = None
    batch_size_g: float | None = Field(1000.0, description="Formulation batch size in grams")
    scale_resolution_g: float | None = Field(0.01, description="Scale resolution in grams")
    input_hash: str | None = None
    output_hash: str | None = None
    recipe_confidence: dict | None = None
    operator_notes: str | None = None


class AddAttemptRequest(BaseModel):
    pastes: list[dict]
    predicted_reflectance: list[float] | None = None
    delta_e00: float | None = None
    composite_mi: float | None = None
    total_load: float | None = None
    calculation_id: str | None = None
    k1: float = 0.04
    k2: float = 0.60
    profile_id: str = "color_match"
    target_reflectance: list[float] | None = None
    tolerance_profile_id: str | None = None
    max_pastes: int | None = None
    max_total_load: float | None = None
    batch_size_g: float | None = 1000.0
    scale_resolution_g: float | None = 0.01
    actual_dispensed: list[dict] | None = None
    operator_notes: str | None = None


class RecordDrawdownMeasurementRequest(BaseModel):
    measured_reflectance: list[float] = Field(..., description="31-point spectral reflectance measured on physical drawdown")
    sample_name: str | None = Field(None, description="Drawdown sample label")
    actual_dispensed: list[dict] | None = Field(None, description="Actual weighed paste amounts in grams: [{'id': 1, 'amount_g': 12.42}, ...]")
    batch_size_g: float = Field(1000.0, description="Actual batch size in grams")
    target_reflectance: list[float] | None = Field(None, description="31-point target spectral curve (ground truth for acceptance)")
    is_simulation: bool = Field(False, description="Whether this measurement is synthetic simulation (cannot create Golden Batch)")
    tolerance_profile_id: str | None = Field(None, description="Optional tolerance profile override: 'industrial', 'strict_lab', 'commercial'")
    k1: float = 0.04
    k2: float = 0.60
    operator_notes: str | None = None


class AddBackCorrectionRequest(BaseModel):
    tank_mass_kg: float = Field(..., description="Current batch mass in tank (kg)", gt=0)
    current_pastes: list[RecipePasteInput] = Field(..., description="Current pigment concentrations or amounts in tank")
    target_reflectance: list[float] = Field(..., description="31-point target spectral curve")
    base_id: int = Field(1, description="Base paint ID")
    current_reflectance: list[float] | None = Field(None, description="Optional measured reflectance of off-shade batch")
    max_addition_pct: float = Field(25.0, description="Max allowed addition as % of tank mass")
    allow_base_addition: bool = Field(True, description="Allow base addition for dilution/lightening")
    k1: float = Field(0.04)
    k2: float = Field(0.60)
    tolerance_profile_id: str | None = Field("industrial", description="Acceptance tolerance profile: 'strict_lab', 'industrial', 'commercial'")
    geometry: str | None = Field(None, description="Optical geometry: 'd/8°', '45°/0°'")
    measurement_mode: str | None = Field(None, description="Measurement mode: 'SCI', 'SCE'")
    optical_system: str | None = Field(None, description="Optical system: 'bootstrap_v1'")


@router.post("/predict")
def simulate_recipe(req: PredictRecipeRequest):
    """
    Live prediction engine: calculates composite K and S, internal reflectance,
    surface reflectance via inverse Saunderson, Lab, sRGB swatch, and metamerism.
    """
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = ?", (req.base_id,)).fetchone()
    if not base_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Base paint not found")

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    # Load paste spectra if not provided in payload
    pastes_data = []
    for p in req.pastes:
        u_k = p.unit_k
        u_s = p.unit_s
        p_name = p.name

        if (u_k is None or u_s is None) and isinstance(p.id, int):
            paste_row = conn.execute("SELECT * FROM pastes WHERE id = ?", (p.id,)).fetchone()
            if paste_row:
                u_k = json.loads(paste_row["unit_k"])
                u_s = json.loads(paste_row["unit_s"])
                p_name = paste_row["name"]

        if u_k is not None and u_s is not None:
            pastes_data.append({
                "id": p.id,
                "name": p_name,
                "concentration": p.concentration,
                "unit_k": u_k,
                "unit_s": u_s
            })

    conn.close()

    result = predict_recipe(
        base_k=base_k,
        base_s=base_s,
        pastes=pastes_data,
        k1=req.k1,
        k2=req.k2,
        target_reflectance=req.target_reflectance,
        thickness=req.thickness,
        forward_model=req.forward_model,
        substrate_rg=req.substrate_rg
    )

    return result


@router.post("/match")
def match_color(req: MatchTargetRequest):
    """
    Automated Computer Color Matching (CCM) solver:
    Identifies the optimal blend of up to 4 colorant pastes to match the target spectrum.
    Enforces strict optical geometry and context compatibility (no cross-geometry mixing).
    """
    if len(req.target_reflectance) != 31:
        raise HTTPException(status_code=400, detail="Target reflectance must have 31 spectral points (400-700 nm).")

    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = ?", (req.base_id,)).fetchone()
    if not base_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Base paint not found")

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    # Enforce optical context / geometry and measurement mode
    base_geo = (base_row["geometry"] if "geometry" in base_row.keys() and base_row["geometry"] else "45°/0°").strip()
    target_geo = req.geometry.strip() if req.geometry else base_geo

    if req.geometry and req.geometry.strip().lower() != base_geo.lower():
        conn.close()
        raise HTTPException(
            status_code=400,
            detail=f"Context Mismatch: Target optical geometry '{req.geometry}' does not match base paint geometry '{base_geo}'. Cross-geometry formulation is prohibited."
        )

    base_mode = (base_row["measurement_mode"] if "measurement_mode" in base_row.keys() and base_row["measurement_mode"] else "SCI").strip().upper()
    target_mode = (req.measurement_mode or base_mode).strip().upper()

    if req.measurement_mode and req.measurement_mode.strip().upper() != base_mode:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail=f"Context Mismatch: Target optical mode '{req.measurement_mode}' does not match base paint mode '{base_mode}'. Cross-mode formulation is prohibited."
        )

    # Fetch candidate pastes with letdowns_json from characterizations
    query = """
        SELECT p.*, c.letdowns_json
        FROM pastes p
        LEFT JOIN characterizations c ON p.active_characterization_id = c.id
    """
    if req.paste_ids:
        placeholders = ",".join("?" for _ in req.paste_ids)
        paste_rows = conn.execute(
            f"{query} WHERE p.id IN ({placeholders})",
            (*req.paste_ids,)
        ).fetchall()
    else:
        paste_rows = conn.execute(query).fetchall()

    conn.close()

    # Apply Context Gate: geometry, measurement mode, optical system, quality status
    from ..color_engine.context_gate import FormulationContext, select_eligible_pastes

    ctx = FormulationContext(
        geometry=target_geo,
        measurement_mode=target_mode,
        base_id=req.base_id,
        optical_system=req.optical_system or "bootstrap_v1"
    )
    eligible_rows, excluded_rows = select_eligible_pastes(ctx, [dict(r) for r in paste_rows], dict(base_row))

    if not eligible_rows:
        reasons_summary = ", ".join(f"[{p.get('code', p.get('name'))}: {p.get('exclusion_reason')}]" for p in excluded_rows[:5])
        raise HTTPException(
            status_code=400,
            detail=f"No characterized colorant pastes found matching optical geometry '{target_geo}'. Cross-geometry formulation is prohibited. Excluded: {reasons_summary}"
        )

    available_pastes = []
    for r_dict in eligible_rows:
        max_c = 10.0
        if r_dict.get("letdowns_json"):
            try:
                lts = json.loads(r_dict["letdowns_json"])
                concs = [float(x.get("concentration", 0)) for x in lts if "concentration" in x]
                if concs:
                    max_c = max(concs)
            except Exception:
                pass

        available_pastes.append({
            "id": r_dict["id"],
            "name": r_dict["name"],
            "code": r_dict["code"],
            "hex": r_dict["color_hex"],
            "geometry": r_dict.get("geometry", target_geo),
            "measurement_mode": r_dict.get("measurement_mode", target_mode),
            "characterization_version": r_dict.get("characterization_version", 1),
            "active_characterization_id": r_dict.get("active_characterization_id"),
            "max_characterized_conc": max_c,
            "unit_k": json.loads(r_dict["unit_k"]),
            "unit_s": json.loads(r_dict["unit_s"])
        })

    try:
        constraints_config = FormulationConstraints(
            max_total_load=req.max_total_load,
            min_total_load=req.min_total_load,
            individual_bounds=req.individual_bounds or {},
            group_bounds=req.group_bounds or {},
            pigment_groups=req.pigment_groups or {},
            min_dispense_threshold=req.min_dispense_threshold,
            batch_size_g=req.batch_size_g,
            scale_resolution_g=req.scale_resolution_g
        )
        match_result = match_color_ccm(
            target_reflectance=req.target_reflectance,
            base_k=base_k,
            base_s=base_s,
            available_pastes=available_pastes,
            max_pastes=req.max_pastes,
            max_total_load=req.max_total_load,
            k1=req.k1,
            k2=req.k2,
            profile_id=req.profile_id,
            constraints=constraints_config,
            enable_multistart=req.enable_multistart,
            num_starts=req.num_starts,
            forward_model=req.forward_model,
            film_thickness_um=req.film_thickness_um,
            substrate_rg=req.substrate_rg,
            batch_size_g=req.batch_size_g,
            scale_resolution_g=req.scale_resolution_g
        )
        match_result["geometry"] = target_geo
        match_result["measurement_mode"] = target_mode
        match_result["excluded_pastes"] = [
            {"id": p["id"], "name": p["name"], "code": p.get("code"), "reason": p.get("exclusion_reason")}
            for p in excluded_rows
        ]

        from ..color_engine.hashing import compute_formulation_input_hash, compute_recipe_output_hash
        from ..color_engine.recipe_confidence import evaluate_recipe_confidence

        inp_hash = compute_formulation_input_hash(
            target_reflectance=req.target_reflectance,
            base_k=base_k,
            base_s=base_s,
            available_pastes=available_pastes,
            max_pastes=req.max_pastes,
            max_total_load=req.max_total_load,
            k1=req.k1,
            k2=req.k2,
            profile_id=req.profile_id,
            min_total_load=req.min_total_load,
            individual_bounds=req.individual_bounds,
            group_bounds=req.group_bounds,
            pigment_groups=req.pigment_groups,
            min_dispense_threshold=req.min_dispense_threshold,
            enable_multistart=req.enable_multistart,
            num_starts=req.num_starts,
            batch_size_g=req.batch_size_g,
            scale_resolution_g=req.scale_resolution_g,
            geometry=target_geo,
            measurement_mode=target_mode,
            optical_system=req.optical_system or "bootstrap_v1"
        )
        out_hash = compute_recipe_output_hash(
            matched_pastes=match_result.get("matched_pastes", []),
            delta_e00=match_result.get("delta_e00", 99.0),
            total_load=match_result.get("total_colorant_load", 0.0),
            batch_size_g=req.batch_size_g,
            scale_resolution_g=req.scale_resolution_g,
            base_amount_g=match_result.get("base_amount_g")
        )
        conf = evaluate_recipe_confidence(
            recipe=match_result,
            base_info=dict(base_row),
            tolerance_de00=req.target_tolerance_de or 0.30
        )

        match_result["input_hash"] = inp_hash
        match_result["output_hash"] = out_hash
        match_result["calculation_hash"] = out_hash
        match_result["recipe_confidence"] = conf
        match_result["batch_size_g"] = req.batch_size_g
        match_result["scale_resolution_g"] = req.scale_resolution_g

        for r_key, r_sub in match_result.get("recipes", {}).items():
            if isinstance(r_sub, dict):
                r_sub["recipe_confidence"] = evaluate_recipe_confidence(
                    recipe=r_sub,
                    base_info=dict(base_row),
                    tolerance_de00=req.target_tolerance_de or 0.30
                )
                r_sub["input_hash"] = inp_hash
                r_sub["output_hash"] = compute_recipe_output_hash(
                    matched_pastes=r_sub.get("matched_pastes", []),
                    delta_e00=r_sub.get("delta_e00", 99.0),
                    total_load=r_sub.get("total_load", 0.0),
                    batch_size_g=req.batch_size_g,
                    scale_resolution_g=req.scale_resolution_g,
                    base_amount_g=r_sub.get("base_amount_g")
                )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Color matching solver error: {str(e)}")

    return match_result


@router.get("/profiles")
def get_optimization_profiles():
    """Returns standard industrial CCM optimization profiles (Color Match, Light Stability, Economy)."""
    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "forward_model": p.forward_model,
            "film_thickness_um": p.film_thickness_um,
            "substrate_rg": p.substrate_rg,
            "weights": {
                "d65": p.weight_d65,
                "a": p.weight_a,
                "f11": p.weight_f11,
                "metamerism": p.weight_metamerism,
                "load": p.weight_load
            },
            "gate_policy": {
                "limit_d65": p.gate_limit_d65,
                "limit_a": p.gate_limit_a,
                "limit_f11": p.gate_limit_f11,
                "limit_mi": p.gate_limit_mi,
                "limit_load": p.gate_limit_load,
                "load_budget_ratio": p.gate_load_budget_ratio
            }
        }
        for p in STANDARD_OPTIMIZATION_PROFILES
    ]


@router.get("/recipes")
def list_recipes():
    conn = get_db_connection()
    rows = conn.execute("""
    SELECT r.*, b.name as base_name, b.code as base_code
    FROM recipes r
    LEFT JOIN bases b ON r.base_id = b.id
    ORDER BY r.id DESC
    """).fetchall()
    conn.close()

    result = []
    for r in rows:
        row_dict = dict(r)
        result.append({
            "id": row_dict["id"],
            "name": row_dict["name"],
            "base_id": row_dict["base_id"],
            "base_name": row_dict.get("base_name"),
            "pastes": json.loads(row_dict["pastes_json"]),
            "predicted_reflectance": json.loads(row_dict["predicted_reflectance"]),
            "lab": json.loads(row_dict["lab_json"]),
            "hex_color": row_dict["hex_color"],
            "delta_e00": row_dict["delta_e00"],
            "contrast_ratio": row_dict["contrast_ratio"],
            "profile_id": row_dict.get("profile_id", "color_match"),
            "calculation_hash": row_dict.get("calculation_hash"),
            "quality_gate": json.loads(row_dict["quality_gate_json"]) if row_dict.get("quality_gate_json") else None,
            "created_at": row_dict["created_at"]
        })
    return result


def compute_canonical_execution_hash(
    base_id: int,
    base_hash: str,
    pastes: list[dict],
    k1: float = 0.04,
    k2: float = 0.60,
    profile_id: str = "color_match",
    total_load: float | None = None,
    illuminant: str = "D65",
    observer: str = "10",
    algorithm: str = "TintMatch-CCM-2.2-SLSQP",
    target_reflectance: list[float] | None = None,
    tolerance_profile_id: str | None = None,
    max_pastes: int | None = None,
    max_total_load: float | None = None,
    min_total_load: float | None = None,
    geometry: str = "45°/0°",
    characterization_version: str | None = None,
    individual_bounds: dict[str, tuple[float, float]] | None = None,
    group_bounds: dict[str, float] | None = None,
    pigment_groups: dict[str, list[str]] | None = None,
    min_dispense_threshold: float | None = None,
    enforce_simplex_sum: bool | None = None,
    enable_multistart: bool | None = None,
    num_starts: int | None = None,
) -> str:
    """Computes a canonical SHA-256 execution context hash capturing all optical, formulation, and solver parameters."""
    def paste_sort_key(p):
        pid = p.get("paste_id") or p.get("id") or 0
        pname = p.get("name") or ""
        return (str(pid), pname)

    sorted_pastes = []
    for p in sorted(pastes, key=paste_sort_key):
        conc = round(float(p.get("concentration", 0.0)), 6)
        sorted_pastes.append({
            "id": p.get("paste_id") or p.get("id"),
            "name": p.get("name"),
            "concentration": conc
        })

    calc_total_load = total_load if total_load is not None else sum(p["concentration"] for p in sorted_pastes)

    # Enrich with optimization profile objective weights
    prof_id = profile_id or "color_match"
    matched_prof = next((p for p in STANDARD_OPTIMIZATION_PROFILES if p.id == prof_id), None)
    profile_weights = None
    if matched_prof:
        profile_weights = {
            "d65": round(float(matched_prof.weight_d65), 4),
            "a": round(float(matched_prof.weight_a), 4),
            "f11": round(float(matched_prof.weight_f11), 4),
            "metamerism": round(float(matched_prof.weight_metamerism), 4),
            "load": round(float(matched_prof.weight_load), 4)
        }

    payload = {
        "algorithm_version": algorithm,
        "base_hash": base_hash,
        "base_id": base_id,
        "geometry": geometry,
        "illuminant": illuminant,
        "observer": observer,
        "pastes": sorted_pastes,
        "profile_id": prof_id,
        "saunderson_k1": round(float(k1), 4),
        "saunderson_k2": round(float(k2), 4),
        "total_load": round(float(calc_total_load), 6),
    }

    if profile_weights:
        payload["profile_weights"] = profile_weights

    if characterization_version:
        payload["characterization_version"] = str(characterization_version)

    if target_reflectance is not None and len(target_reflectance) > 0:
        target_rounded = [round(float(v), 5) for v in target_reflectance]
        payload["target_hash"] = hashlib.sha256(json.dumps(target_rounded).encode()).hexdigest()

    if tolerance_profile_id:
        payload["tolerance_profile_id"] = str(tolerance_profile_id)

    if max_pastes is not None:
        payload["max_pastes"] = int(max_pastes)

    if max_total_load is not None:
        payload["max_total_load"] = round(float(max_total_load), 4)

    if min_total_load is not None and min_total_load > 0.0:
        payload["min_total_load"] = round(float(min_total_load), 4)

    if individual_bounds:
        payload["individual_bounds"] = {
            str(k): [round(float(b[0]), 4), round(float(b[1]), 4)]
            for k, b in sorted(individual_bounds.items())
        }

    if group_bounds:
        payload["group_bounds"] = {
            str(k): round(float(v), 4) for k, v in sorted(group_bounds.items())
        }

    if pigment_groups:
        payload["pigment_groups"] = {
            str(k): sorted([str(item) for item in v]) for k, v in sorted(pigment_groups.items())
        }

    if min_dispense_threshold is not None and min_dispense_threshold > 0.0:
        payload["min_dispense_threshold"] = round(float(min_dispense_threshold), 4)

    if enforce_simplex_sum:
        payload["enforce_simplex_sum"] = True

    if enable_multistart:
        payload["multistart"] = {
            "enabled": True,
            "num_starts": int(num_starts or 3)
        }

    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


@router.post("/recipes")
def save_recipe(req: SaveRecipeRequest):
    conn = get_db_connection()
    cur = conn.cursor()

    # Look up base to compute base_hash
    base_row = conn.execute("SELECT * FROM bases WHERE id = ?", (req.base_id,)).fetchone()
    base_hash = hashlib.sha256(f"{base_row['absorption_k']}:{base_row['scattering_s']}".encode()).hexdigest() if base_row else "default_base"

    # Compute canonical SHA-256 execution context hash
    calc_hash = req.calculation_hash
    recipe_geo = req.geometry or "45°/0°"
    char_ver = int(req.characterization_version or 1)

    # Authoritative characterization IDs lookup from DB
    char_ids = []
    for p in req.pastes:
        pid = p.get("paste_id") or p.get("id")
        p_row = conn.execute("SELECT active_characterization_id FROM pastes WHERE id = ?", (pid,)).fetchone()
        if p_row and p_row["active_characterization_id"]:
            char_ids.append(p_row["active_characterization_id"])
        elif p.get("active_characterization_id"):
            char_ids.append(p.get("active_characterization_id"))
        else:
            char_ids.append(None)
    char_ids_json = json.dumps(char_ids)

    if not calc_hash:
        calc_hash = compute_canonical_execution_hash(
            base_id=req.base_id,
            base_hash=base_hash,
            pastes=req.pastes,
            k1=req.k1,
            k2=req.k2,
            profile_id=req.profile_id or "color_match",
            total_load=req.total_load,
            target_reflectance=req.target_reflectance,
            tolerance_profile_id=req.tolerance_profile_id,
            max_pastes=req.max_pastes,
            max_total_load=req.max_total_load,
            min_total_load=req.min_total_load,
            geometry=recipe_geo,
            characterization_version=char_ver,
            individual_bounds=req.individual_bounds,
            group_bounds=req.group_bounds,
            pigment_groups=req.pigment_groups,
            min_dispense_threshold=req.min_dispense_threshold,
            enable_multistart=req.enable_multistart,
            num_starts=req.num_starts
        )

    qg_json = json.dumps(req.quality_gate) if req.quality_gate else None
    tot_load = req.total_load or sum(p.get("concentration", 0.0) for p in req.pastes)
    batch_size = req.batch_size_g or 1000.0
    scale_res = req.scale_resolution_g or 0.01
    inp_hash = req.input_hash
    out_hash = req.output_hash or calc_hash
    conf_json = json.dumps(req.recipe_confidence) if req.recipe_confidence else None
    target_refl_json = json.dumps(req.target_reflectance) if req.target_reflectance else None
    tol_prof_id = req.tolerance_profile_id or "industrial"

    cur.execute("""
    INSERT INTO recipes (
        name, base_id, pastes_json, predicted_reflectance, target_reflectance, lab_json, hex_color, delta_e00,
        contrast_ratio, calculation_hash, calculation_id, engine_version, profile_id,
        quality_gate_json, geometry, characterization_version, characterization_ids_json,
        input_hash, output_hash, batch_size_g, scale_resolution_g, recipe_confidence_json, tolerance_profile_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        req.name, req.base_id, json.dumps(req.pastes),
        json.dumps(req.predicted_reflectance), target_refl_json, json.dumps(req.lab),
        req.hex_color, req.delta_e00, req.contrast_ratio,
        calc_hash, req.calculation_id, req.engine_version or "2.2.0",
        req.profile_id or "color_match", qg_json,
        recipe_geo, char_ver, char_ids_json,
        inp_hash, out_hash, batch_size, scale_res, conf_json, tol_prof_id
    ))
    new_id = cur.lastrowid

    # Automatically record Attempt #1 in recipe_history
    cur.execute("""
    INSERT INTO recipe_history (
        recipe_id, attempt_number, pastes_json, predicted_reflectance, target_reflectance, delta_e00,
        composite_mi, total_load, calculation_hash, calculation_id, geometry,
        characterization_ids_json, batch_size_g, scale_resolution_g, tolerance_profile_id, operator_notes
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id,
        json.dumps(req.pastes),
        json.dumps(req.predicted_reflectance),
        target_refl_json,
        req.delta_e00,
        req.composite_mi,
        tot_load,
        calc_hash,
        req.calculation_id,
        recipe_geo,
        char_ids_json,
        batch_size,
        scale_res,
        tol_prof_id,
        req.operator_notes or "Initial formulation match (Attempt #1)"
    ))

    conn.commit()
    conn.close()

    return {
        "success": True,
        "id": new_id,
        "calculation_hash": calc_hash,
        "attempt_number": 1,
        "message": f"Recipe '{req.name}' saved with canonical SHA-256 hash and attempt #1 recorded."
    }


@router.get("/recipes/{recipe_id}/attempts")
def get_recipe_attempts(recipe_id: int):
    """Fetches all formulation trial attempts for a given recipe."""
    conn = get_db_connection()
    recipe = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if not recipe:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Recipe {recipe_id} not found.")

    rows = conn.execute("""
        SELECT * FROM recipe_history 
        WHERE recipe_id = ? 
        ORDER BY attempt_number ASC
    """, (recipe_id,)).fetchall()
    conn.close()

    attempts = []
    for r in rows:
        row_dict = dict(r)
        attempts.append({
            "id": row_dict["id"],
            "recipe_id": row_dict["recipe_id"],
            "attempt_number": row_dict["attempt_number"],
            "pastes": json.loads(row_dict["pastes_json"]) if row_dict.get("pastes_json") else [],
            "predicted_reflectance": json.loads(row_dict["predicted_reflectance"]) if row_dict.get("predicted_reflectance") else None,
            "target_reflectance": json.loads(row_dict["target_reflectance"]) if row_dict.get("target_reflectance") else None,
            "measured_reflectance": json.loads(row_dict["measured_reflectance"]) if row_dict.get("measured_reflectance") else None,
            "measured_lab": json.loads(row_dict["measured_lab_json"]) if row_dict.get("measured_lab_json") else None,
            "actual_dispensed": json.loads(row_dict["actual_dispensed_json"]) if row_dict.get("actual_dispensed_json") else None,
            "batch_size_g": row_dict.get("batch_size_g"),
            "scale_resolution_g": row_dict.get("scale_resolution_g"),
            "delta_e00": row_dict["delta_e00"],
            "de00_target_vs_measured": row_dict.get("de00_target_vs_measured"),
            "de00_target_vs_predicted": row_dict.get("de00_target_vs_predicted"),
            "de00_predicted_vs_measured": row_dict.get("de00_predicted_vs_measured"),
            "outcome": row_dict.get("outcome", "PENDING"),
            "is_simulation": bool(row_dict.get("is_simulation", 0)),
            "is_golden_batch": bool(row_dict.get("is_golden_batch", 0)),
            "tolerance_profile_id": row_dict.get("tolerance_profile_id", "industrial"),
            "addback_suggestion": json.loads(row_dict["addback_suggestion_json"]) if row_dict.get("addback_suggestion_json") else None,
            "composite_mi": row_dict.get("composite_mi"),
            "total_load": row_dict.get("total_load"),
            "calculation_hash": row_dict.get("calculation_hash"),
            "operator_notes": row_dict.get("operator_notes"),
            "created_at": row_dict["created_at"]
        })
    return {"recipe_id": recipe_id, "recipe_name": recipe["name"], "attempts": attempts}


@router.post("/recipes/{recipe_id}/attempts")
def add_recipe_attempt(recipe_id: int, req: AddAttemptRequest):
    """Adds a new trial attempt / correction step for an existing recipe."""
    conn = get_db_connection()
    recipe = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if not recipe:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Recipe {recipe_id} not found.")

    base_row = conn.execute("SELECT * FROM bases WHERE id = ?", (recipe["base_id"],)).fetchone()
    base_hash = hashlib.sha256(f"{base_row['absorption_k']}:{base_row['scattering_s']}".encode()).hexdigest() if base_row else "default_base"

    # Compute next attempt number
    max_att = conn.execute("SELECT MAX(attempt_number) as max_att FROM recipe_history WHERE recipe_id = ?", (recipe_id,)).fetchone()
    next_att = (max_att["max_att"] or 0) + 1

    calc_hash = compute_canonical_execution_hash(
        base_id=recipe["base_id"],
        base_hash=base_hash,
        pastes=req.pastes,
        k1=req.k1,
        k2=req.k2,
        profile_id=req.profile_id,
        total_load=req.total_load,
        target_reflectance=req.target_reflectance,
        tolerance_profile_id=req.tolerance_profile_id,
        max_pastes=req.max_pastes,
        max_total_load=req.max_total_load,
    )

    recipe_dict = dict(recipe)
    tot_load = req.total_load or sum(p.get("concentration", 0.0) for p in req.pastes)
    target_refl_json = json.dumps(req.target_reflectance) if req.target_reflectance else recipe_dict.get("target_reflectance")

    cur = conn.cursor()
    cur.execute("""
    INSERT INTO recipe_history (
        recipe_id, attempt_number, pastes_json, predicted_reflectance, target_reflectance,
        delta_e00, composite_mi, total_load, calculation_hash, calculation_id, operator_notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        recipe_id,
        next_att,
        json.dumps(req.pastes),
        json.dumps(req.predicted_reflectance) if req.predicted_reflectance else None,
        target_refl_json,
        req.delta_e00,
        req.composite_mi,
        tot_load,
        calc_hash,
        req.calculation_id,
        req.operator_notes or f"Manual correction attempt #{next_att}"
    ))

    # Update latest in recipes table if predicted reflectance is provided
    if req.predicted_reflectance:
        lab_dict = reflectance_to_lab(req.predicted_reflectance)
        hex_col = reflectance_to_hex(req.predicted_reflectance)
        cur.execute("""
        UPDATE recipes SET 
            pastes_json = ?,
            predicted_reflectance = ?,
            lab_json = ?,
            hex_color = ?,
            delta_e00 = ?,
            calculation_hash = ?
        WHERE id = ?
        """, (
            json.dumps(req.pastes),
            json.dumps(req.predicted_reflectance),
            json.dumps(lab_dict),
            hex_col,
            req.delta_e00,
            calc_hash,
            recipe_id
        ))

    conn.commit()
    new_history_id = cur.lastrowid
    conn.close()

    return {
        "success": True,
        "history_id": new_history_id,
        "attempt_number": next_att,
        "calculation_hash": calc_hash,
        "message": f"Attempt #{next_att} recorded for recipe {recipe_id}."
    }


@router.get("/batches")
def get_factory_batches(limit: int = 50):
    """
    Returns factory batch production history across all recipes for auditing and QA traceability.
    """
    conn = get_db_connection()
    rows = conn.execute("""
    SELECT rh.*, r.name as recipe_name, b.name as base_name, b.code as base_code
    FROM recipe_history rh
    JOIN recipes r ON rh.recipe_id = r.id
    LEFT JOIN bases b ON r.base_id = b.id
    ORDER BY rh.id DESC
    LIMIT ?
    """, (limit,)).fetchall()
    conn.close()

    results = []
    for r in rows:
        row_dict = dict(r)
        results.append({
            "id": row_dict["id"],
            "recipe_id": row_dict["recipe_id"],
            "recipe_name": row_dict["recipe_name"],
            "base_name": row_dict.get("base_name", "Standart Baz"),
            "base_code": row_dict.get("base_code", ""),
            "attempt_number": row_dict["attempt_number"],
            "batch_size_g": row_dict.get("batch_size_g") or 1000.0,
            "scale_resolution_g": row_dict.get("scale_resolution_g") or 0.01,
            "delta_e00": row_dict["delta_e00"],
            "de00_target_vs_measured": row_dict.get("de00_target_vs_measured"),
            "de00_target_vs_predicted": row_dict.get("de00_target_vs_predicted"),
            "de00_predicted_vs_measured": row_dict.get("de00_predicted_vs_measured"),
            "outcome": row_dict.get("outcome", "PENDING"),
            "is_simulation": bool(row_dict.get("is_simulation", 0)),
            "is_golden_batch": bool(row_dict.get("is_golden_batch", 0)),
            "tolerance_profile_id": row_dict.get("tolerance_profile_id", "industrial"),
            "measured_lab": json.loads(row_dict["measured_lab_json"]) if row_dict.get("measured_lab_json") else None,
            "operator_notes": row_dict.get("operator_notes"),
            "created_at": row_dict["created_at"]
        })
    return results


@router.get("/tolerances")
def get_standard_tolerances():
    """Returns standard industrial and laboratory tolerance profiles."""
    from ..color_engine.profiles import STANDARD_TOLERANCE_PROFILES
    return [
        {
            "id": tp.id,
            "name": tp.name,
            "description": tp.description,
            "target_de00_acceptance": tp.target_de00_acceptance,
            "addback_max_de00": tp.addback_max_de00,
            "reject_above_de00": tp.reject_above_de00,
            "model_divergence_warning_de00": tp.model_divergence_warning_de00,
            "mean_de00_limit": tp.mean_de00_limit,
            "single_de00_limit": tp.single_de00_limit,
            "loocv_de00_limit": tp.loocv_de00_limit
        }
        for tp in STANDARD_TOLERANCE_PROFILES
    ]


@router.post("/add-back")
def run_add_back_correction(req: AddBackCorrectionRequest):
    """
    Computes optimal additions (pigment kg and base kg) to bring an off-shade batch to target.
    Enforces plant physical constraints: Delta m_i >= 0, Delta m_base >= 0.
    Applies ContextGate to ensure only eligible colorants are added.
    """
    conn = get_db_connection()
    base_row = conn.execute("SELECT * FROM bases WHERE id = ?", (req.base_id,)).fetchone()
    if not base_row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Base ID {req.base_id} not found.")

    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    # P0-3: Strict ContextGate for add-back colorant pool
    from ..color_engine.context_gate import FormulationContext, select_eligible_pastes
    from ..color_engine.profiles import get_tolerance_profile
    from ..color_engine.addback import calculate_production_addback

    paste_rows = conn.execute("SELECT * FROM pastes").fetchall()
    conn.close()

    base_dict = dict(base_row)
    target_geo = req.geometry or base_dict.get("geometry") or "d/8°"
    target_mode = req.measurement_mode or base_dict.get("measurement_mode") or "SCI"
    target_opt = req.optical_system or base_dict.get("optical_system") or "bootstrap_v1"

    context = FormulationContext(
        geometry=target_geo,
        measurement_mode=target_mode,
        optical_system=target_opt,
        base_id=base_dict["id"],
        allow_simulation=False
    )
    eligible_pastes, _ = select_eligible_pastes(context, paste_rows, base_dict)

    available_pastes = []
    for pr in eligible_pastes:
        available_pastes.append({
            "id": pr["id"],
            "name": pr["name"],
            "code": pr["code"],
            "color_hex": pr["color_hex"],
            "unit_k": json.loads(pr["unit_k"]),
            "unit_s": json.loads(pr["unit_s"]),
        })

    tolerance = get_tolerance_profile(req.tolerance_profile_id)
    curr_pastes_list = [p.model_dump() for p in req.current_pastes]

    try:
        result = calculate_production_addback(
            tank_mass_kg=req.tank_mass_kg,
            current_pastes=curr_pastes_list,
            target_reflectance=req.target_reflectance,
            available_pastes=available_pastes,
            base_k=base_k,
            base_s=base_s,
            current_reflectance=req.current_reflectance,
            max_addition_pct=req.max_addition_pct,
            allow_base_addition=req.allow_base_addition,
            k1=req.k1,
            k2=req.k2,
            tolerance=tolerance
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/recipes/{recipe_id}/attempts/{attempt_number}/result")
def record_drawdown_measurement(recipe_id: int, attempt_number: int, req: RecordDrawdownMeasurementRequest):
    """
    Physical Drawdown Verification (Golden Batch Lifecycle).
    Records actual spectrophotometer measurement of physical paint drawdown,
    compares Target ↔ Measured for true production acceptance,
    computes model discrepancy (Predicted vs Measured),
    evaluates acceptance against centralized ToleranceProfile,
    and automatically calculates add-back correction to the TRUE TARGET.
    """
    conn = get_db_connection()
    recipe = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if not recipe:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Recipe {recipe_id} not found.")

    attempt = conn.execute(
        "SELECT * FROM recipe_history WHERE recipe_id = ? AND attempt_number = ?",
        (recipe_id, attempt_number)
    ).fetchone()
    if not attempt:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Attempt #{attempt_number} not found for recipe {recipe_id}.")

    if len(req.measured_reflectance) != 31:
        conn.close()
        raise HTTPException(status_code=400, detail="Measured reflectance must contain exactly 31 points (400-700 nm @ 10 nm).")

    from ..color_engine.colorimetry import reflectance_to_lab, ciede2000
    from ..color_engine.profiles import get_tolerance_profile

    # 1. Measured Lab
    measured_lab_tuple = reflectance_to_lab(req.measured_reflectance, illuminant="D65", observer="10")
    measured_lab = {
        "L": round(float(measured_lab_tuple[0]), 2),
        "a": round(float(measured_lab_tuple[1]), 2),
        "b": round(float(measured_lab_tuple[2]), 2)
    }

    # 2. Predicted Lab & Model Divergence
    pred_reflectance_raw = attempt["predicted_reflectance"] or recipe["predicted_reflectance"]
    if pred_reflectance_raw:
        pred_r = json.loads(pred_reflectance_raw)
        pred_lab_tuple = reflectance_to_lab(pred_r, illuminant="D65", observer="10")
        de_res_pred = ciede2000(pred_lab_tuple, measured_lab_tuple)
        de00_pred_vs_meas = round(float(de_res_pred["delta_e00"]), 3)
    else:
        pred_r = None
        pred_lab_tuple = None
        de00_pred_vs_meas = 0.0

    recipe_dict = dict(recipe)
    attempt_dict = dict(attempt)

    # 3. P0-1 & P0-2: Retrieve TRUE TARGET REFLECTANCE
    actual_target_r = None
    if req.target_reflectance and len(req.target_reflectance) == 31:
        actual_target_r = req.target_reflectance
    elif attempt_dict.get("target_reflectance"):
        actual_target_r = json.loads(attempt_dict["target_reflectance"])
    elif recipe_dict.get("target_reflectance"):
        actual_target_r = json.loads(recipe_dict["target_reflectance"])

    if actual_target_r:
        target_lab_tuple = reflectance_to_lab(actual_target_r, illuminant="D65", observer="10")
        de_res_target = ciede2000(target_lab_tuple, measured_lab_tuple)
        de00_target_vs_meas = round(float(de_res_target["delta_e00"]), 3)
        de00_target_vs_pred = round(float(ciede2000(target_lab_tuple, pred_lab_tuple)["delta_e00"]), 3) if pred_lab_tuple else 0.0
    else:
        # Fallback if no target was saved
        de00_target_vs_meas = de00_pred_vs_meas
        de00_target_vs_pred = 0.0
        actual_target_r = pred_r or req.measured_reflectance

    # 4. P0-6: Load Centralized Tolerance Profile
    tol_id = req.tolerance_profile_id or recipe_dict.get("tolerance_profile_id") or "industrial"
    tolerance = get_tolerance_profile(tol_id)

    # Primary physical outcome decision is based on de00_target_vs_meas (Target ↔ Measured)!
    primary_de00 = de00_target_vs_meas

    # Model divergence diagnosis
    model_divergence_warning = False
    model_divergence_note = None
    if de00_pred_vs_meas > tolerance.model_divergence_warning_de00:
        model_divergence_warning = True
        model_divergence_note = (
            f"Model sapması yüksek (Tahmin vs Gerçek ΔE00 = {de00_pred_vs_meas:.2f} > {tolerance.model_divergence_warning_de00:.2f}). "
            "Karakterizasyon kalitesi veya terazi tartım hassasiyeti kontrol edilmelidir."
        )

    # P0-5: Check simulation vs real physical measurement
    if primary_de00 <= tolerance.target_de00_acceptance:
        outcome = "ACCEPTED"
        if req.is_simulation:
            outcome_message = f"Simülasyon kabul edildi (Hedef ΔE00 = {primary_de00:.2f} ≤ {tolerance.target_de00_acceptance:.2f}). (Demo / Test Modu)."
        else:
            outcome_message = f"Drawdown kabul edildi (Hedef ΔE00 = {primary_de00:.2f} ≤ {tolerance.target_de00_acceptance:.2f}). Reçete üretim standardına ulaştı (Golden Batch Onaylandı)."
        addback_result = None
    elif primary_de00 <= tolerance.addback_max_de00:
        outcome = "ADDBACK_REQUIRED"
        outcome_message = f"Drawdown düzeltme gerektiriyor (Hedef vs Gerçek ΔE00 = {primary_de00:.2f} > {tolerance.target_de00_acceptance:.2f}). Tanka ilave pasta düzeltmesi hesaplandı."
        try:
            base_row = conn.execute("SELECT * FROM bases WHERE id = ?", (recipe["base_id"],)).fetchone()
            base_dict = dict(base_row) if base_row else {}
            base_k = json.loads(base_dict["absorption_k"])
            base_s = json.loads(base_dict["scattering_s"])

            # P0-3: Strict ContextGate for add-back pool
            from ..color_engine.context_gate import FormulationContext, select_eligible_pastes
            raw_pastes = conn.execute("SELECT * FROM pastes").fetchall()
            geo = recipe_dict.get("geometry") or base_dict.get("geometry") or "d/8°"
            mode = base_dict.get("measurement_mode") or "SCI"
            opt_sys = base_dict.get("optical_system") or "bootstrap_v1"
            ctx = FormulationContext(
                geometry=geo,
                measurement_mode=mode,
                optical_system=opt_sys,
                base_id=base_dict.get("id"),
                allow_simulation=req.is_simulation
            )
            eligible_pastes, _ = select_eligible_pastes(ctx, raw_pastes, base_dict)

            available_pastes = [
                {
                    "id": pr["id"],
                    "name": pr["name"],
                    "code": pr["code"],
                    "color_hex": pr["color_hex"],
                    "unit_k": json.loads(pr["unit_k"]),
                    "unit_s": json.loads(pr["unit_s"])
                }
                for pr in eligible_pastes
            ]

            # P0-4: Ground truth physical starting paste mass in the tank
            recipe_pastes = json.loads(attempt["pastes_json"]) if attempt["pastes_json"] else []
            if req.actual_dispensed and len(req.actual_dispensed) > 0:
                dispensed_map = {
                    str(d.get("id") or d.get("paste_id")): float(d.get("amount_g") or d.get("amount") or 0.0)
                    for d in req.actual_dispensed
                }
                current_pastes = []
                for rp in recipe_pastes:
                    pid = str(rp.get("id") or rp.get("paste_id"))
                    act_amt = dispensed_map.get(
                        pid,
                        float(rp.get("amount_g") or (float(rp.get("concentration", 0.0)) / 100.0) * req.batch_size_g)
                    )
                    current_pastes.append({
                        "id": int(pid) if pid.isdigit() else pid,
                        "name": rp.get("name"),
                        "amount_g": act_amt,
                        "concentration": (act_amt / req.batch_size_g) * 100.0
                    })
            else:
                current_pastes = recipe_pastes

            # P0-2: Target is the TRUE TARGET REFLECTANCE, NOT prediction!
            target_r_for_addback = actual_target_r if actual_target_r is not None else (pred_r or req.measured_reflectance)

            from ..color_engine.addback import calculate_production_addback
            addback_result = calculate_production_addback(
                tank_mass_kg=req.batch_size_g / 1000.0,
                current_pastes=current_pastes,
                target_reflectance=target_r_for_addback,
                available_pastes=available_pastes,
                base_k=base_k,
                base_s=base_s,
                current_reflectance=req.measured_reflectance,
                k1=req.k1,
                k2=req.k2,
                tolerance=tolerance
            )
        except Exception as e:
            addback_result = {"error": f"Düzeltme hesaplanamadı: {str(e)}"}
    else:
        outcome = "REJECTED"
        outcome_message = f"Drawdown reddedildi (Hedef vs Gerçek ΔE00 = {primary_de00:.2f} > {tolerance.reject_above_de00:.2f}). Reçete yeniden formüle edilmelidir."
        addback_result = None

    # P0-5: Golden Batch can ONLY be achieved by real (non-simulation) accepted measurement
    is_golden = bool(outcome == "ACCEPTED" and not req.is_simulation)

    cur = conn.cursor()
    cur.execute("""
    UPDATE recipe_history SET
        measured_reflectance = ?,
        target_reflectance = ?,
        measured_lab_json = ?,
        actual_dispensed_json = ?,
        batch_size_g = ?,
        de00_target_vs_measured = ?,
        de00_target_vs_predicted = ?,
        de00_predicted_vs_measured = ?,
        delta_e00 = ?,
        outcome = ?,
        addback_suggestion_json = ?,
        is_simulation = ?,
        is_golden_batch = ?,
        tolerance_profile_id = ?,
        operator_notes = COALESCE(?, operator_notes)
    WHERE recipe_id = ? AND attempt_number = ?
    """, (
        json.dumps(req.measured_reflectance),
        json.dumps(actual_target_r) if actual_target_r else None,
        json.dumps(measured_lab),
        json.dumps(req.actual_dispensed) if req.actual_dispensed else None,
        req.batch_size_g,
        de00_target_vs_meas,
        de00_target_vs_pred,
        de00_pred_vs_meas,
        de00_target_vs_meas,
        outcome,
        json.dumps(addback_result) if addback_result else None,
        1 if req.is_simulation else 0,
        1 if is_golden else 0,
        tolerance.id,
        req.operator_notes,
        recipe_id,
        attempt_number
    ))
    conn.commit()
    conn.close()

    return {
        "success": True,
        "recipe_id": recipe_id,
        "attempt_number": attempt_number,
        "de00_target_vs_measured": de00_target_vs_meas,
        "de00_target_vs_predicted": de00_target_vs_pred,
        "de00_predicted_vs_measured": de00_pred_vs_meas,
        "outcome": outcome,
        "outcome_message": outcome_message,
        "is_golden_batch": is_golden,
        "is_simulation": req.is_simulation,
        "model_divergence_warning": model_divergence_warning,
        "model_divergence_note": model_divergence_note,
        "tolerance_profile": {
            "id": tolerance.id,
            "target_de00_acceptance": tolerance.target_de00_acceptance,
            "addback_max_de00": tolerance.addback_max_de00,
            "reject_above_de00": tolerance.reject_above_de00,
            "model_divergence_warning_de00": tolerance.model_divergence_warning_de00
        },
        "measured_lab": measured_lab,
        "addback_suggestion": addback_result
    }


@router.delete("/recipes/{recipe_id}")
def delete_recipe(recipe_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM recipe_history WHERE recipe_id = ?", (recipe_id,))
    cur.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Recipe {recipe_id} and its attempt history deleted."}
