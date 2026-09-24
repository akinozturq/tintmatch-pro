"""
Colorant Pastes API Router
==========================
Handles listing, retrieval, and management of characterized colorant pastes.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import json

from ..database.db import get_db_connection
from ..color_engine.constants import WAVELENGTHS

router = APIRouter(prefix="/api/pastes", tags=["pastes"])


class PasteCreate(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Phthalo Green PG7"})
    code: str = Field(..., json_schema_extra={"example": "PG7"})
    color_hex: str = Field(..., json_schema_extra={"example": "#008855"})
    density: float = Field(1.35, json_schema_extra={"example": 1.35})
    unit_k: list[float] = Field(..., description="31-point unit absorption spectrum")
    unit_s: list[float] = Field(..., description="31-point unit scattering spectrum")
    unit_ks: list[float] = Field(..., description="31-point unit K/S spectrum")
    mean_delta_e00: float = Field(0.0, json_schema_extra={"example": 0.18})
    passed_validation: bool = Field(True, json_schema_extra={"example": True})
    characterization_base_id: int | None = Field(None)


@router.get("")
def list_pastes():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM pastes ORDER BY id ASC").fetchall()
    conn.close()

    result = []
    for r in rows:
        result.append({
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "color_hex": r["color_hex"],
            "density": r["density"],
            "unit_k": json.loads(r["unit_k"]),
            "unit_s": json.loads(r["unit_s"]),
            "unit_ks": json.loads(r["unit_ks"]),
            "mean_delta_e00": r["mean_delta_e00"],
            "passed_validation": bool(r["passed_validation"]),
            "characterization_base_id": r["characterization_base_id"],
            "created_at": r["created_at"]
        })
    return result


@router.get("/{paste_id}")
def get_paste(paste_id: int):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM pastes WHERE id = ?", (paste_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Colorant paste not found")

    return {
        "id": row["id"],
        "name": row["name"],
        "code": row["code"],
        "color_hex": row["color_hex"],
        "density": row["density"],
        "unit_k": json.loads(row["unit_k"]),
        "unit_s": json.loads(row["unit_s"]),
        "unit_ks": json.loads(row["unit_ks"]),
        "mean_delta_e00": row["mean_delta_e00"],
        "passed_validation": bool(row["passed_validation"]),
        "characterization_base_id": row["characterization_base_id"],
        "created_at": row["created_at"]
    }


@router.delete("/{paste_id}")
def delete_paste(paste_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM pastes WHERE id = ?", (paste_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Paste {paste_id} deleted."}
