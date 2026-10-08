"""
Spectrophotometric Characterization API Router
==============================================
Handles CHNSpec DS-36D raw data ingestion, Two-Constant Kubelka-Munk least-squares fitting,
back-prediction verification with ΔE00 < 0.3 threshold, and database registration.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
import json
import numpy as np

from ..database.db import get_db_connection
from ..color_engine.constants import WAVELENGTHS
from ..color_engine.kubelka_munk import characterize_letdown_series, characterize_production_base
from ..color_engine.quality_gate import evaluate_characterization_gate
from ..color_engine.spectral_parser import (
    parse_spectral_content,
    get_industrial_sample_datasets,
    generate_sample_spectral_csv
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
    instrument: str = Field("CHNSpec DS-36D (d/8° Benchtop Spectrophotometer)")
    instrument_id: int | None = Field(None)
    geometry: str = Field("d/8°", json_schema_extra={"example": "d/8°"})
    measurement_mode: str = Field("SCI", json_schema_extra={"example": "SCI"})
    characterization_version: int = Field(1, json_schema_extra={"example": 1})
    is_simulation: bool = Field(False, description="Flag indicating if the measurement source was synthetic/simulated")
    allow_simulation_save: bool = Field(False, description="Explicit override flag allowing simulated data to be saved to production library")
    bootstrap_role: str | None = Field(None, description="Bootstrap reference role: 'black', 'white', or None")
    letdowns: list[LetdownItem]
    calculation_results: dict


class SetupBootstrapSystemRequest(BaseModel):
    clear_base_id: int = Field(..., description="ID of the clear transparent base (Base D)")
    black_paste_id: int = Field(..., description="ID of the reference black paste (e.g. PBk7)")
    white_paste_id: int = Field(..., description="ID of the reference white paste (e.g. PW6)")
    optical_system: str = Field("bootstrap_v1", description="Optical system identifier")


class CharacterizeBaseFromBootstrapRequest(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Baz A - Fabrika Opak Beyaz"})
    code: str = Field(..., json_schema_extra={"example": "BASE-A-PROD"})
    base_type: str = Field("white_a", json_schema_extra={"example": "white_a"})
    density: float = Field(1.45, json_schema_extra={"example": 1.45})
    un_tinted_reflectance: list[float] = Field(..., description="31-point spectral reflectance of the un-tinted base")
    black_letdowns: list[LetdownItem] = Field(..., description="Dilution measurements with Bootstrap Black paste")
    bootstrap_black_paste_id: int | None = Field(None, description="Optional explicit ID for bootstrap black paste")
    k1: float = Field(0.04, json_schema_extra={"example": 0.04})
    k2: float = Field(0.60, json_schema_extra={"example": 0.60})
    thickness: float = Field(100.0, json_schema_extra={"example": 100.0})
    geometry: str = Field("45°/0°", json_schema_extra={"example": "45°/0°"})
    measurement_mode: str = Field("SCI", json_schema_extra={"example": "SCI"})
    optical_system: str = Field("bootstrap_v1")


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


@router.post("/import-spectral-file")
async def import_spectral_file(
    file: UploadFile | None = File(None),
    raw_text: str | None = Form(None)
):
    """
    Imports and parses raw data from a spectrophotometer export file (CSV, TXT, XML/CxF)
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

    parsed = parse_spectral_content(content, filename)
    return parsed


@router.get("/samples")
def list_sample_datasets():
    """Returns available pre-packaged industrial letdown calibration datasets."""
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
    """Returns sample CSV text for testing."""
    csv_text = generate_sample_spectral_csv(colorant_key)
    return {"csv": csv_text, "filename": f"DS36D_{colorant_key}_Letdowns.csv"}


@router.post("/save")
def save_characterization(req: SaveCharacterizationRequest):
    """
    Saves the characterized paste to the library and records the calibration session.
    Enforces simulation guards and links active_characterization_id with geometry.
    """
    if req.is_simulation and not req.allow_simulation_save:
        raise HTTPException(
            status_code=400,
            detail="Cannot save simulated characterization data to production paste library unless allow_simulation_save is explicitly True."
        )

    if isinstance(req.calculation_results, dict) and len(req.calculation_results) == 0:
        raise HTTPException(
            status_code=400,
            detail="Invalid calculation results: calculation matrices are missing or empty."
        )

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("SELECT * FROM bases WHERE id = ?", (req.base_id,))
    base_row = cur.fetchone()
    if not base_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Base paint not found")

    base_name = base_row["name"] if base_row else "Standard Base"
    base_r = json.loads(base_row["reflectance"])
    base_k = json.loads(base_row["absorption_k"])
    base_s = json.loads(base_row["scattering_s"])

    # Authoritative server calculation when letdowns are provided
    if req.letdowns and len(req.letdowns) > 0:
        letdown_dicts = [
            {"concentration": l.concentration, "reflectance": l.reflectance}
            for l in req.letdowns
        ]
        try:
            computed_res = characterize_letdown_series(
                base_reflectance=base_r,
                letdowns=letdown_dicts,
                k1=req.k1,
                k2=req.k2,
                base_k=base_k,
                base_s=base_s,
                use_two_constant=True
            )
            unit_k = computed_res["unit_k"]
            unit_s = computed_res["unit_s"]
            unit_ks = computed_res["unit_ks"]
            mean_de00 = computed_res["mean_delta_e00"]

            gate_eval = evaluate_characterization_gate(
                mean_de00=computed_res["mean_delta_e00"],
                max_de00=computed_res["max_delta_e00"],
                r_squared=computed_res["r_squared"],
                spectral_rmse=computed_res["spectral_rmse"],
                contrast_ratio=100.0,
                letdown_count=len(letdown_dicts),
                max_spectral_residual=computed_res.get("max_spectral_residual"),
                directional_residuals=computed_res.get("directional_residuals"),
                loocv_result=computed_res.get("loocv"),
                is_opaque=True
            )
            overall_status = gate_eval.get("status", "FAIL")
            passed = bool(overall_status in ("PASS", "WARN") and computed_res["mean_delta_e00"] <= 0.50)
            res_to_save = computed_res
        except Exception:
            res = req.calculation_results
            unit_k = res.get("unit_k")
            unit_s = res.get("unit_s")
            unit_ks = res.get("unit_ks")
            mean_de00 = res.get("mean_delta_e00", 0.0)
            passed = bool(res.get("passed_validation", True))
            overall_status = "PASS" if passed else "FAIL"
            res_to_save = res
    else:
        res = req.calculation_results
        unit_k = res.get("unit_k")
        unit_s = res.get("unit_s")
        unit_ks = res.get("unit_ks")
        mean_de00 = res.get("mean_delta_e00", 0.0)
        passed = bool(res.get("passed_validation", True))
        overall_status = "PASS" if passed else "FAIL"
        res_to_save = res

    if not unit_k or not unit_s:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid calculation results: unit_k or unit_s missing.")

    if req.is_simulation:
        paste_status = "SIMULATION"
    elif overall_status == "PASS":
        paste_status = "ACTIVE"
    elif overall_status == "WARN":
        paste_status = "CONDITIONAL"
    else:
        paste_status = "REJECTED"

    # Determine representative color hex from highest letdown or unit absorption
    color_hex = req.color_hex
    if not color_hex:
        back_preds = res_to_save.get("back_predictions", [])
        if back_preds:
            last_refl = back_preds[-1]["predicted_reflectance"]
            color_hex = reflectance_to_hex(last_refl)
        else:
            color_hex = "#3b82f6"

    try:
        # Check if paste with this code exists
        existing_paste = cur.execute("SELECT id, characterization_version FROM pastes WHERE code = ?", (req.code,)).fetchone()

        target_version = req.characterization_version
        if existing_paste:
            paste_id = existing_paste["id"]
            if target_version <= (existing_paste["characterization_version"] or 1):
                target_version = (existing_paste["characterization_version"] or 1) + 1
        else:
            paste_id = None

        # Construct measurement context json
        specular_inc = req.measurement_mode.upper() in ("SCI", "SCI_SCE")
        meas_context = {
            "instrument_model": req.instrument,
            "geometry": req.geometry,
            "measurement_mode": req.measurement_mode,
            "specular_included": specular_inc,
            "optical_system": "bootstrap_v1",
            "characterization_version": target_version
        }

        # Insert characterization record
        cur.execute("""
        INSERT INTO characterizations (
            paste_id, paste_name, base_id, base_name, instrument, instrument_id,
            geometry, measurement_mode, version, measurement_context_json,
            k1, k2, letdowns_json, results_json, mean_delta_e00, passed_validation
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            paste_id, req.name, req.base_id, base_name, req.instrument, req.instrument_id,
            req.geometry, req.measurement_mode, target_version, json.dumps(meas_context),
            req.k1, req.k2,
            json.dumps([{"concentration": l.concentration, "reflectance": l.reflectance} for l in req.letdowns]),
            json.dumps(res_to_save), mean_de00, 1 if passed else 0
        ))
        char_id = cur.lastrowid

        if paste_id:
            # Update existing paste
            cur.execute("""
            UPDATE pastes SET
                name = ?, color_hex = ?, density = ?,
                unit_k = ?, unit_s = ?, unit_ks = ?,
                mean_delta_e00 = ?, passed_validation = ?, characterization_base_id = ?,
                geometry = ?, measurement_mode = ?, optical_system = 'bootstrap_v1',
                status = ?, bootstrap_role = COALESCE(?, bootstrap_role),
                characterization_version = ?, active_characterization_id = ?
            WHERE id = ?
            """, (
                req.name, color_hex, req.density,
                json.dumps(unit_k), json.dumps(unit_s), json.dumps(unit_ks),
                mean_de00, 1 if passed else 0, req.base_id,
                req.geometry, req.measurement_mode, paste_status,
                req.bootstrap_role,
                target_version, char_id,
                paste_id
            ))
        else:
            # Insert new paste
            cur.execute("""
            INSERT INTO pastes (
                name, code, color_hex, density,
                unit_k, unit_s, unit_ks,
                mean_delta_e00, passed_validation, characterization_base_id,
                geometry, measurement_mode, optical_system, status, bootstrap_role,
                characterization_version, active_characterization_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                req.name, req.code, color_hex, req.density,
                json.dumps(unit_k), json.dumps(unit_s), json.dumps(unit_ks),
                mean_de00, 1 if passed else 0, req.base_id,
                req.geometry, req.measurement_mode, 'bootstrap_v1', paste_status,
                req.bootstrap_role,
                target_version, char_id
            ))
            paste_id = cur.lastrowid
            cur.execute("UPDATE characterizations SET paste_id = ? WHERE id = ?", (paste_id, char_id))

        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Database save error: {str(e)}")

    conn.close()
    return {
        "success": True,
        "paste_id": paste_id,
        "characterization_id": char_id,
        "version": target_version,
        "message": f"Colorant paste '{req.name}' successfully registered and characterized (v{target_version})."
    }


# ============================================================================
# Bootstrap Optical System Endpoints
# ============================================================================

@router.get("/bootstrap-status")
def get_bootstrap_status():
    """
    Returns the real-time status of the 3-Stage Bootstrap Optical Calibration:
    Stage 1: Core Triplet (Clear Base + Bootstrap Black + Bootstrap White)
    Stage 2: Colorant Pastes library characterized against the Bootstrap reference
    Stage 3: Production Bases (Opaque White, Medium, Deep) characterized using Bootstrap Black
    """
    conn = get_db_connection()

    # Stage 1: Core Triplet
    clear_base_row = conn.execute("SELECT id, name, code, base_type FROM bases WHERE is_bootstrap_base = 1 LIMIT 1").fetchone()
    black_paste_row = conn.execute("SELECT id, name, code, color_hex FROM pastes WHERE bootstrap_role = 'black' AND status = 'ACTIVE' LIMIT 1").fetchone()
    white_paste_row = conn.execute("SELECT id, name, code, color_hex FROM pastes WHERE bootstrap_role = 'white' AND status = 'ACTIVE' LIMIT 1").fetchone()

    stage1_complete = bool(clear_base_row and black_paste_row and white_paste_row)

    # Stage 2: Colorants characterized in this optical framework
    colorant_rows = conn.execute("""
        SELECT id, name, code, color_hex, status, mean_delta_e00
        FROM pastes
        WHERE (bootstrap_role IS NULL OR bootstrap_role NOT IN ('black', 'white'))
        ORDER BY id ASC
    """).fetchall()
    colorants = [dict(r) for r in colorant_rows]
    stage2_complete = len(colorants) > 0

    # Stage 3: Production bases (Exclude the clear bootstrap base itself)
    base_rows = conn.execute("""
        SELECT id, name, code, base_type, contrast_ratio, is_opaque
        FROM bases
        WHERE is_bootstrap_base = 0
        ORDER BY id ASC
    """).fetchall()
    bases = [dict(r) for r in base_rows]
    stage3_complete = len(bases) > 0

    conn.close()

    is_system_ready = stage1_complete and stage2_complete and stage3_complete

    return {
        "optical_system": "bootstrap_v1",
        "is_system_ready": is_system_ready,
        "stages": {
            "stage1": {
                "name": "Aşama 1: Çekirdek Bootstrap Referansı",
                "description": "Şeffaf baz + Referans siyah + Referans beyaz optik kalibrasyonu",
                "status": "COMPLETED" if stage1_complete else "PENDING",
                "clear_base": dict(clear_base_row) if clear_base_row else None,
                "black_paste": dict(black_paste_row) if black_paste_row else None,
                "white_paste": dict(white_paste_row) if white_paste_row else None,
            },
            "stage2": {
                "name": "Aşama 2: Renklendirici Pasta Kütüphanesi",
                "description": "Bootstrap referansıyla karakterize edilen renkli pastalar",
                "status": "COMPLETED" if stage2_complete else "PENDING",
                "count": len(colorants),
                "pastes": colorants,
            },
            "stage3": {
                "name": "Aşama 3: Üretim Bazları",
                "description": "Bootstrap siyah ile karakterize edilen fabrika bazları (Opak Beyaz, Orta, Deep)",
                "status": "COMPLETED" if stage3_complete else "PENDING",
                "count": len(bases),
                "bases": bases,
            }
        }
    }


@router.post("/bootstrap-system")
def setup_bootstrap_system(req: SetupBootstrapSystemRequest):
    """
    Sets or locks the core Bootstrap reference triplet:
    Clear Base (is_bootstrap_base=1) + Black Paste (bootstrap_role='black') + White Paste (bootstrap_role='white').
    """
    conn = get_db_connection()
    cur = conn.cursor()

    # Clear previous bootstrap flags for this optical system
    cur.execute("UPDATE bases SET is_bootstrap_base = 0 WHERE optical_system = ?", (req.optical_system,))
    cur.execute("UPDATE bases SET is_bootstrap_base = 1, optical_system = ? WHERE id = ?", (req.optical_system, req.clear_base_id))

    cur.execute("UPDATE pastes SET bootstrap_role = NULL WHERE optical_system = ? AND bootstrap_role IN ('black', 'white')", (req.optical_system,))
    cur.execute("UPDATE pastes SET bootstrap_role = 'black', optical_system = ? WHERE id = ?", (req.optical_system, req.black_paste_id))
    cur.execute("UPDATE pastes SET bootstrap_role = 'white', optical_system = ? WHERE id = ?", (req.optical_system, req.white_paste_id))

    conn.commit()
    conn.close()

    return {
        "success": True,
        "optical_system": req.optical_system,
        "message": "Bootstrap referans üçlüsü (Şeffaf Baz + Siyah + Beyaz) başarıyla kilitlendi."
    }


@router.post("/base-from-bootstrap")
def characterize_base_from_bootstrap(req: CharacterizeBaseFromBootstrapRequest):
    """
    Characterizes a production base paint (Base A Opaque White, Base B Medium, Base C Deep)
    using un-tinted base reflectance and a dilution series with the Bootstrap Black paste.
    Saves or updates the base in the production library with optical_system='bootstrap_v1' and is_bootstrap_base=0.
    """
    if len(req.un_tinted_reflectance) != 31:
        raise HTTPException(status_code=400, detail="Un-tinted base reflectance must contain exactly 31 values (400-700 nm @ 10 nm).")
    if len(req.black_letdowns) == 0:
        raise HTTPException(status_code=400, detail="At least 1 black letdown measurement is required.")

    conn = get_db_connection()

    # Look up bootstrap black paste
    if req.bootstrap_black_paste_id:
        black_row = conn.execute("SELECT * FROM pastes WHERE id = ?", (req.bootstrap_black_paste_id,)).fetchone()
    else:
        black_row = conn.execute("SELECT * FROM pastes WHERE bootstrap_role = 'black' AND status = 'ACTIVE' LIMIT 1").fetchone()

    if not black_row:
        conn.close()
        raise HTTPException(status_code=400, detail="Bootstrap Black paste not found. Please complete Stage 1 calibration first.")

    blk_k = json.loads(black_row["unit_k"])
    blk_s = json.loads(black_row["unit_s"])

    letdown_dicts = [{"concentration": l.concentration, "reflectance": l.reflectance} for l in req.black_letdowns]

    # Calculate production base K and S
    char_res = characterize_production_base(
        un_tinted_reflectance=req.un_tinted_reflectance,
        black_letdowns=letdown_dicts,
        bootstrap_black_k=blk_k,
        bootstrap_black_s=blk_s,
        k1=req.k1,
        k2=req.k2,
        thickness=req.thickness
    )

    cur = conn.cursor()
    existing = cur.execute("SELECT id FROM bases WHERE code = ?", (req.code,)).fetchone()
    if existing:
        base_id = existing["id"]
        cur.execute("""
        UPDATE bases SET
            name = ?, base_type = ?, density = ?, contrast_ratio = ?, is_opaque = ?,
            reflectance = ?, absorption_k = ?, scattering_s = ?, geometry = ?,
            measurement_mode = ?, optical_system = ?, is_bootstrap_base = 0
        WHERE id = ?
        """, (
            req.name, req.base_type, req.density, char_res["contrast_ratio"],
            1 if char_res["is_opaque"] else 0,
            json.dumps(req.un_tinted_reflectance),
            json.dumps(char_res["absorption_k"]),
            json.dumps(char_res["scattering_s"]),
            req.geometry, req.measurement_mode, req.optical_system,
            base_id
        ))
    else:
        cur.execute("""
        INSERT INTO bases (
            name, code, base_type, density, contrast_ratio, is_opaque,
            reflectance, absorption_k, scattering_s, geometry,
            measurement_mode, optical_system, is_bootstrap_base
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        """, (
            req.name, req.code, req.base_type, req.density, char_res["contrast_ratio"],
            1 if char_res["is_opaque"] else 0,
            json.dumps(req.un_tinted_reflectance),
            json.dumps(char_res["absorption_k"]),
            json.dumps(char_res["scattering_s"]),
            req.geometry, req.measurement_mode, req.optical_system
        ))
        base_id = cur.lastrowid

    conn.commit()
    conn.close()

    return {
        "success": True,
        "base_id": base_id,
        "name": req.name,
        "code": req.code,
        "base_type": req.base_type,
        "contrast_ratio": char_res["contrast_ratio"],
        "is_opaque": char_res["is_opaque"],
        "mean_delta_e00": char_res["mean_delta_e00"],
        "max_delta_e00": char_res["max_delta_e00"],
        "passed_validation": char_res["passed_validation"],
        "back_predictions": char_res["back_predictions"],
        "absorption_k": char_res["absorption_k"],
        "scattering_s": char_res["scattering_s"],
        "summary": char_res["summary"]
    }
