"""
Base Paints API Router
======================
Handles CRUD for Base Paints (Opaque White A, Medium B, Deep C, Transparent D)
and calculates contrast ratio / opacity hiding.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import json
import numpy as np

from ..database.db import get_db_connection
from ..color_engine.constants import WAVELENGTHS
from ..color_engine.saunderson import saunderson_correction
from ..color_engine.kubelka_munk import (
    reflectance_to_ks,
    calculate_opacity_contrast_ratio,
    forward_two_constant_km
)
from ..color_engine.colorimetry import reflectance_to_hex, reflectance_to_lab

router = APIRouter(prefix="/api/bases", tags=["bases"])


class BaseCreate(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Base A - Opaque White"})
    code: str = Field(..., json_schema_extra={"example": "BASE-A-WHITE"})
    base_type: str = Field("white_a", json_schema_extra={"example": "white_a"})  # white_a, medium_b, deep_c, transparent_d
    density: float = Field(1.45, json_schema_extra={"example": 1.45})
    reflectance: list[float] = Field(..., description="31-point spectral reflectance (400-700 nm)")
    k1: float = Field(0.04, json_schema_extra={"example": 0.04})
    k2: float = Field(0.60, json_schema_extra={"example": 0.60})
    thickness: float = Field(100.0, json_schema_extra={"example": 100.0})


@router.get("")
def list_bases():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM bases ORDER BY id ASC").fetchall()
    conn.close()

    result = []
    for r in rows:
        refl = json.loads(r["reflectance"])
        lab = reflectance_to_lab(refl, illuminant="D65", observer="10")
        hex_c = reflectance_to_hex(refl)
        result.append({
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "base_type": r["base_type"],
            "density": r["density"],
            "contrast_ratio": r["contrast_ratio"],
            "is_opaque": bool(r["is_opaque"]),
            "reflectance": refl,
            "absorption_k": json.loads(r["absorption_k"]),
            "scattering_s": json.loads(r["scattering_s"]),
            "hex": hex_c,
            "lab": {
                "L": round(lab[0], 2),
                "a": round(lab[1], 2),
                "b": round(lab[2], 2)
            },
            "created_at": r["created_at"]
        })
    return result


@router.get("/{base_id}")
def get_base(base_id: int):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM bases WHERE id = ?", (base_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Base not found")

    refl = json.loads(row["reflectance"])
    lab = reflectance_to_lab(refl, illuminant="D65", observer="10")
    return {
        "id": row["id"],
        "name": row["name"],
        "code": row["code"],
        "base_type": row["base_type"],
        "density": row["density"],
        "contrast_ratio": row["contrast_ratio"],
        "is_opaque": bool(row["is_opaque"]),
        "reflectance": refl,
        "absorption_k": json.loads(row["absorption_k"]),
        "scattering_s": json.loads(row["scattering_s"]),
        "hex": reflectance_to_hex(refl),
        "lab": {
            "L": round(lab[0], 2),
            "a": round(lab[1], 2),
            "b": round(lab[2], 2)
        },
        "created_at": row["created_at"]
    }


@router.post("")
def create_base(data: BaseCreate):
    if len(data.reflectance) != 31:
        raise HTTPException(status_code=400, detail="Reflectance must have 31 values for 400-700 nm @ 10 nm.")

    r_arr = np.asarray(data.reflectance, dtype=float)
    if np.max(r_arr) > 1.5:
        r_arr = r_arr / 100.0
    r_arr = np.clip(r_arr, 0.001, 0.999)

    # Compute K and S
    # For White Base A, standard reference S is normalized to 1.0
    # For Transparent D, S is very low (~0.005)
    r_int = saunderson_correction(r_arr, k1=data.k1, k2=data.k2)
    ks = reflectance_to_ks(r_int)

    if data.base_type == "white_a":
        s_base = np.ones(31, dtype=float)
        k_base = ks * s_base
    elif data.base_type == "medium_b":
        s_base = np.full(31, 0.65, dtype=float)
        k_base = ks * s_base
    elif data.base_type == "deep_c":
        s_base = np.full(31, 0.25, dtype=float)
        k_base = ks * s_base
    else:  # transparent_d
        s_base = np.full(31, 0.005, dtype=float)
        k_base = ks * s_base

    # Compute contrast ratio
    cr_info = calculate_opacity_contrast_ratio(k_base, s_base, thickness=data.thickness, k1=data.k1, k2=data.k2)
    luminous_cr = cr_info["luminous_contrast_ratio"]
    is_opaque = luminous_cr >= 98.0

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
        INSERT INTO bases (name, code, base_type, density, contrast_ratio, is_opaque, reflectance, absorption_k, scattering_s)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.name, data.code, data.base_type, data.density, luminous_cr, 1 if is_opaque else 0,
            json.dumps([round(float(v), 5) for v in r_arr]),
            json.dumps([round(float(v), 5) for v in k_base]),
            json.dumps([round(float(v), 5) for v in s_base])
        ))
        conn.commit()
        new_id = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")
    conn.close()

    return {
        "id": new_id,
        "name": data.name,
        "code": data.code,
        "contrast_ratio": luminous_cr,
        "is_opaque": is_opaque,
        "status": cr_info["status"]
    }
