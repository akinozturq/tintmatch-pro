"""
Formulation and Computer Color Matching (CCM) API Router
========================================================
Handles live simulation of recipe sliders, instant digital color swatch updates,
metamerism calculation, and automated color matching.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import json
import numpy as np

from ..database.db import get_db_connection
from ..color_engine.constants import WAVELENGTHS
from ..color_engine.formulation import predict_recipe, match_color_ccm
from ..color_engine.colorimetry import reflectance_to_lab, reflectance_to_hex

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


class SaveRecipeRequest(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Hospitality Sage Green"})
    base_id: int = Field(1, json_schema_extra={"example": 1})
    pastes: list[dict]
    predicted_reflectance: list[float]
    lab: dict
    hex_color: str
    delta_e00: float | None = None
    contrast_ratio: float | None = None


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
            k2=req.k2
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Color matching solver error: {str(e)}")

    return match_result


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
        result.append({
            "id": r["id"],
            "name": r["name"],
            "base_id": r["base_id"],
            "base_name": r["base_name"],
            "pastes": json.loads(r["pastes_json"]),
            "predicted_reflectance": json.loads(r["predicted_reflectance"]),
            "lab": json.loads(r["lab_json"]),
            "hex_color": r["hex_color"],
            "delta_e00": r["delta_e00"],
            "contrast_ratio": r["contrast_ratio"],
            "created_at": r["created_at"]
        })
    return result


@router.post("/recipes")
def save_recipe(req: SaveRecipeRequest):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    INSERT INTO recipes (name, base_id, pastes_json, predicted_reflectance, lab_json, hex_color, delta_e00, contrast_ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        req.name, req.base_id, json.dumps(req.pastes),
        json.dumps(req.predicted_reflectance), json.dumps(req.lab),
        req.hex_color, req.delta_e00, req.contrast_ratio
    ))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return {"success": True, "id": new_id, "message": f"Recipe '{req.name}' saved."}


@router.delete("/recipes/{recipe_id}")
def delete_recipe(recipe_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Recipe {recipe_id} deleted."}
