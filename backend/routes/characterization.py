"""
Spectrophotometric Characterization API Router
==============================================
Handles X-Rite RM400 raw data ingestion, Two-Constant Kubelka-Munk least-squares fitting,
back-prediction verification with ΔE00 < 0.3 threshold, and database registration.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
import json
import numpy as np

from ..database.db import get_db_connection
from ..color_engine.constants import WAVELENGTHS
from ..color_engine.kubelka_munk import characterize_letdown_series
from ..color_engine.rm400_parser import (
    parse_rm400_content,
    get_industrial_sample_datasets,
    generate_sample_rm400_csv
)
from ..color_engine.colorimetry import reflectance_to_hex

router = APIRouter(prefix="/api/characterization", tags=["characterization"])


class LetdownItem(BaseModel):
    concentration: float = Field(..., description="Mass concentration percentage (e.g. 0.1, 0.5, 1.0, 2.5, 5.0, 10.0)")
    reflectance: list[float] = Field(..., description="31-point measured reflectance (400-700 nm)")


class CharacterizeRequest(BaseModel):
    base_id: int | None = Field(None, json_schema_extra={"example": 1})
    base_reflectance: list[float] | None = Field(None, description="Optional custom 31-point base reflectance")
    letdowns: list[LetdownItem]
    k1: float = Field(0.04, json_schema_extra={"example": 0.04})
    k2: float = Field(0.60, json_schema_extra={"example": 0.60})
    use_two_constant: bool = Field(True, json_schema_extra={"example": True})


class SaveCharacterizationRequest(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Phthalo Green PG7"})
    code: str = Field(..., json_schema_extra={"example": "PG7"})
    color_hex: str | None = Field(None, json_schema_extra={"example": "#008855"})
    density: float = Field(1.35, json_schema_extra={"example": 1.35})
    base_id: int = Field(1, json_schema_extra={"example": 1})
    k1: float = Field(0.04, json_schema_extra={"example": 0.04})
    k2: float = Field(0.60, json_schema_extra={"example": 0.60})
    instrument: str = Field("X-Rite RM400 (45°/0° Spectrophotometer)")
    letdowns: list[LetdownItem]
    calculation_results: dict


@router.post("/calculate")
def calculate_characterization(req: CharacterizeRequest):
    """
    Executes Two-Constant Kubelka-Munk least-squares optimization across the letdown series.
    Calculates K(λ), S(λ), back-predicts reflectance, and computes CIEDE2000 residuals.
    """
    if len(req.letdowns) == 0:
        raise HTTPException(status_code=400, detail="At least 1 letdown dilution measurement is required.")

    # Retrieve base reflectance
    base_r = None
    base_k = None
    base_s = None

    if req.base_reflectance and len(req.base_reflectance) == 31:
        base_r = req.base_reflectance
    elif req.base_id:
        conn = get_db_connection()
        row = conn.execute("SELECT * FROM bases WHERE id = ?", (req.base_id,)).fetchone()
        conn.close()
        if row:
            base_r = json.loads(row["reflectance"])
            base_k = json.loads(row["absorption_k"])
            base_s = json.loads(row["scattering_s"])

    if base_r is None:
        raise HTTPException(status_code=400, detail="A valid Base Paint (or 31-point base reflectance) is required.")

    letdown_dicts = [
        {"concentration": item.concentration, "reflectance": item.reflectance}
        for item in req.letdowns
    ]

    try:
        results = characterize_letdown_series(
            base_reflectance=base_r,
            letdowns=letdown_dicts,
            k1=req.k1,
            k2=req.k2,
            base_k=base_k,
            base_s=base_s,
            use_two_constant=req.use_two_constant
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Characterization optimization failed: {str(e)}")

    return results


@router.post("/import-rm400")
async def import_rm400_file(
    file: UploadFile | None = File(None),
    raw_text: str | None = Form(None)
):
    """
    Imports and parses raw data from an X-Rite RM400 export file (CSV, TXT, XML/CxF)
    or directly pasted text content.
    """
    content = ""
    filename = ""

    if file:
        filename = file.filename
        bytes_data = await file.read()
        try:
            content = bytes_data.decode("utf-8")
        except UnicodeDecodeError:
            content = bytes_data.decode("latin-1", errors="ignore")
    elif raw_text:
        content = raw_text
    else:
        raise HTTPException(status_code=400, detail="Either file upload or raw_text must be provided.")

    parsed = parse_rm400_content(content, filename)
    return parsed


@router.get("/samples")
def list_sample_datasets():
    """Returns available pre-packaged industrial RM400 letdown calibration datasets."""
    datasets = get_industrial_sample_datasets()
    summary = []
    for key, c in datasets["colorants"].items():
        summary.append({
            "key": key,
            "name": c["name"],
            "code": c["code"],
            "color_hex": c["color_hex"],
            "density": c["density"],
            "letdowns_count": len(c["letdowns"]),
            "concentrations": [item["concentration"] for item in c["letdowns"]]
        })
    return {
        "base": datasets["base_a"],
        "samples": summary
    }


@router.get("/samples/{colorant_key}")
def get_sample_dataset(colorant_key: str):
    """Returns the full 31-point spectral letdowns for a specific sample pigment."""
    datasets = get_industrial_sample_datasets()
    if colorant_key not in datasets["colorants"]:
        raise HTTPException(status_code=404, detail="Sample colorant not found")

    return {
        "base": datasets["base_a"],
        "colorant": datasets["colorants"][colorant_key]
    }


@router.get("/samples/{colorant_key}/csv")
def download_sample_csv(colorant_key: str):
    """Returns sample RM400 CSV text for testing."""
    csv_text = generate_sample_rm400_csv(colorant_key)
    return {"csv": csv_text, "filename": f"RM400_{colorant_key}_Letdowns.csv"}


@router.post("/save")
def save_characterization(req: SaveCharacterizationRequest):
    """
    Saves the characterized paste to the library and records the calibration session.
    """
    res = req.calculation_results
    unit_k = res.get("unit_k")
    unit_s = res.get("unit_s")
    unit_ks = res.get("unit_ks")
    mean_de00 = res.get("mean_delta_e00", 0.0)
    passed = bool(res.get("passed_validation", True))

    if not unit_k or not unit_s:
        raise HTTPException(status_code=400, detail="Invalid calculation results: unit_k or unit_s missing.")

    # Determine representative color hex from highest letdown or unit absorption
    color_hex = req.color_hex
    if not color_hex:
        # Use last letdown predicted reflectance
        back_preds = res.get("back_predictions", [])
        if back_preds:
            last_refl = back_preds[-1]["predicted_reflectance"]
            color_hex = reflectance_to_hex(last_refl)
        else:
            color_hex = "#3b82f6"

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Insert or update paste
        cur.execute("""
        INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, mean_delta_e00, passed_validation, characterization_base_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            req.name, req.code, color_hex, req.density,
            json.dumps(unit_k), json.dumps(unit_s), json.dumps(unit_ks),
            mean_de00, 1 if passed else 0, req.base_id
        ))
        paste_id = cur.lastrowid

        # Insert characterization record
        cur.execute("SELECT name FROM bases WHERE id = ?", (req.base_id,))
        base_row = cur.fetchone()
        base_name = base_row["name"] if base_row else "Standard Base"

        cur.execute("""
        INSERT INTO characterizations (paste_id, paste_name, base_id, base_name, instrument, k1, k2, letdowns_json, results_json, mean_delta_e00, passed_validation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            paste_id, req.name, req.base_id, base_name,
            req.instrument, req.k1, req.k2,
            json.dumps([{"concentration": l.concentration, "reflectance": l.reflectance} for l in req.letdowns]),
            json.dumps(res), mean_de00, 1 if passed else 0
        ))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Database save error: {str(e)}")

    conn.close()
    return {
        "success": True,
        "paste_id": paste_id,
        "message": f"Colorant paste '{req.name}' successfully registered and characterized."
    }
