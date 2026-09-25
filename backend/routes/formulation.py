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


class MatchTargetRequest(BaseModel):
    target_reflectance: list[float] = Field(..., description="31-point target spectral reflectance (400-700 nm)")
    base_id: int = Field(1, json_schema_extra={"example": 1})
    paste_ids: list[int] | None = Field(None, description="Candidate paste IDs; if None, all library pastes are used")
    max_pastes: int = Field(4, json_schema_extra={"example": 4})
    max_total_load: float = Field(12.0, json_schema_extra={"example": 12.0})
    k1: float = Field(0.04, json_schema_extra={"example": 0.04})
    k2: float = Field(0.60, json_schema_extra={"example": 0.60})
    profile_id: str | None = Field(None, description="Preferred profile: 'color_match', 'light_stability', 'economy'")


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
    quality_gate: dict | None = None
    k1: float = 0.04
    k2: float = 0.60
    composite_mi: float | None = None
    total_load: float | None = None
    target_reflectance: list[float] | None = None
    tolerance_profile_id: str | None = None
    max_pastes: int | None = None
    max_total_load: float | None = None
    operator_notes: str | None = None


class AddAttemptRequest(BaseModel):
    pastes: list[dict]
    predicted_reflectance: list[float] | None = None
    delta_e00: float | None = None
    composite_mi: float | None = None
    total_load: float | None = None
    k1: float = 0.04
    k2: float = 0.60
    profile_id: str = "color_match"
    target_reflectance: list[float] | None = None
    tolerance_profile_id: str | None = None
    max_pastes: int | None = None
    max_total_load: float | None = None
    operator_notes: str | None = None


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
        thickness=req.thickness
    )

    return result


@router.post("/match")
def match_color(req: MatchTargetRequest):
    """
    Automated Computer Color Matching (CCM) solver:
    Identifies the optimal blend of up to 4 colorant pastes to match the target spectrum.
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

    # Fetch candidate pastes
    if req.paste_ids:
        placeholders = ",".join("?" for _ in req.paste_ids)
        paste_rows = conn.execute(f"SELECT * FROM pastes WHERE id IN ({placeholders})", req.paste_ids).fetchall()
    else:
        paste_rows = conn.execute("SELECT * FROM pastes").fetchall()

    conn.close()

    if not paste_rows:
        raise HTTPException(status_code=400, detail="No colorant pastes available for matching.")

    available_pastes = []
    for r in paste_rows:
        available_pastes.append({
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "hex": r["color_hex"],
            "unit_k": json.loads(r["unit_k"]),
            "unit_s": json.loads(r["unit_s"])
        })

    try:
        match_result = match_color_ccm(
            target_reflectance=req.target_reflectance,
            base_k=base_k,
            base_s=base_s,
            available_pastes=available_pastes,
            max_pastes=req.max_pastes,
            max_total_load=req.max_total_load,
            k1=req.k1,
            k2=req.k2,
            profile_id=req.profile_id
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
            "weights": {
                "d65": p.weight_d65,
                "a": p.weight_a,
                "f11": p.weight_f11,
                "metamerism": p.weight_metamerism,
                "load": p.weight_load
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
    algorithm: str = "TintMatch-CCM-2.0-SLSQP",
    target_reflectance: list[float] | None = None,
    tolerance_profile_id: str | None = None,
    max_pastes: int | None = None,
    max_total_load: float | None = None,
    geometry: str = "45°/0°",
    characterization_version: str | None = None,
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

    payload = {
        "algorithm_version": algorithm,
        "base_hash": base_hash,
        "base_id": base_id,
        "geometry": geometry,
        "illuminant": illuminant,
        "observer": observer,
        "pastes": sorted_pastes,
        "profile_id": profile_id or "color_match",
        "saunderson_k1": round(float(k1), 4),
        "saunderson_k2": round(float(k2), 4),
        "total_load": round(float(calc_total_load), 6),
    }

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
        )

    qg_json = json.dumps(req.quality_gate) if req.quality_gate else None
    tot_load = req.total_load or sum(p.get("concentration", 0.0) for p in req.pastes)

    cur.execute("""
    INSERT INTO recipes (name, base_id, pastes_json, predicted_reflectance, lab_json, hex_color, delta_e00, contrast_ratio, calculation_hash, profile_id, quality_gate_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        req.name, req.base_id, json.dumps(req.pastes),
        json.dumps(req.predicted_reflectance), json.dumps(req.lab),
        req.hex_color, req.delta_e00, req.contrast_ratio,
        calc_hash, req.profile_id or "color_match", qg_json
    ))
    new_id = cur.lastrowid

    # Automatically record Attempt #1 in recipe_history
    cur.execute("""
    INSERT INTO recipe_history (recipe_id, attempt_number, pastes_json, predicted_reflectance, delta_e00, composite_mi, total_load, calculation_hash, operator_notes)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id,
        json.dumps(req.pastes),
        json.dumps(req.predicted_reflectance),
        req.delta_e00,
        req.composite_mi,
        tot_load,
        calc_hash,
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
            "pastes": json.loads(row_dict["pastes_json"]) if row_dict["pastes_json"] else [],
            "predicted_reflectance": json.loads(row_dict["predicted_reflectance"]) if row_dict.get("predicted_reflectance") else None,
            "delta_e00": row_dict["delta_e00"],
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

    tot_load = req.total_load or sum(p.get("concentration", 0.0) for p in req.pastes)

    cur = conn.cursor()
    cur.execute("""
    INSERT INTO recipe_history (recipe_id, attempt_number, pastes_json, predicted_reflectance, delta_e00, composite_mi, total_load, calculation_hash, operator_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        recipe_id,
        next_att,
        json.dumps(req.pastes),
        json.dumps(req.predicted_reflectance) if req.predicted_reflectance else None,
        req.delta_e00,
        req.composite_mi,
        tot_load,
        calc_hash,
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


@router.delete("/recipes/{recipe_id}")
def delete_recipe(recipe_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM recipe_history WHERE recipe_id = ?", (recipe_id,))
    cur.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Recipe {recipe_id} and its attempt history deleted."}
