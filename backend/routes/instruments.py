"""
Instruments API Router
======================
Endpoints for interacting with laboratory spectrophotometers:
1. CHNSpec DS-36D Benchtop Spectrophotometer (d/8° Integrating Sphere, USB CDC / COM4).
Handles hardware connection, auto-discovery of COM ports, calibration, and spectral acquisition.
"""

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..devices.chnspec_driver import chnspec_driver, CHNSpecDriver
from ..color_engine.instrument_comparison import compare_spectral_measurements
from ..database.db import get_db_connection

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


class CHNSpecConnectRequest(BaseModel):
    port: str | None = Field(None, description="Serial port (e.g. 'COM4'). Auto-detected if omitted.")


class CHNSpecCalibrateRequest(BaseModel):
    type: str = Field("White", description="Calibration type ('White' or 'Black')")


class CHNSpecMeasureRequest(BaseModel):
    mode: str = Field("SCI", description="Measurement mode: 'SCI', 'SCE', 'SCI_SCE'")
    sample_name: str | None = Field("Lab Sample", description="Sample identification")
    save_to_archive: bool = Field(True, description="Whether to record measurement in measurements table")
    force_measure: bool = Field(False, description="Emergency override to bypass calibration hard-gate (records EXPIRED_FORCED in audit)")


@router.get("")
def list_instruments():
    """Returns all registered spectrophotometers."""
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM instruments ORDER BY id ASC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.get("/ports")
def get_serial_ports():
    """Lists available serial COM ports and highlights spectrophotometers."""
    return {
        "ports": CHNSpecDriver.list_ports(),
        "active_chnspec_port": chnspec_driver._current_port,
        "is_chnspec_connected": chnspec_driver.is_connected()
    }


# =========================================================================
# CHNSpec DS-36D Benchtop Spectrophotometer Endpoints
# =========================================================================

@router.get("/chnspec/status")
def get_chnspec_status():
    """Queries CHNSpec DS-36D hardware status, port, mock state, and geometry."""
    return chnspec_driver.get_status()


@router.post("/chnspec/connect")
def connect_chnspec(req: CHNSpecConnectRequest = CHNSpecConnectRequest()):
    """Connects to CHNSpec DS-36D on COM port (auto-detected if omitted)."""
    success = chnspec_driver.connect(req.port)
    port = chnspec_driver._current_port
    return {
        "success": success,
        "connected": chnspec_driver.is_connected(),
        "connection_state": chnspec_driver.connection_state,
        "port": port,
        "is_mock": chnspec_driver.is_mock,
        "message": f"Connected to CHNSpec DS-36D on {port}" if success else f"Unable to establish connection on {port or 'auto-detect'}."
    }


@router.post("/chnspec/disconnect")
def disconnect_chnspec():
    """Disconnects from CHNSpec DS-36D."""
    success = chnspec_driver.disconnect()
    return {"success": success, "message": "CHNSpec DS-36D disconnected."}


@router.post("/chnspec/calibrate")
def calibrate_chnspec(req: CHNSpecCalibrateRequest):
    """Executes White or Black calibration on CHNSpec DS-36D."""
    cal_type = req.type.strip().capitalize()
    try:
        if cal_type == "Black":
            res = chnspec_driver.black_calibrate()
        else:
            res = chnspec_driver.white_calibrate()
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chnspec/measure")
def measure_chnspec(req: CHNSpecMeasureRequest):
    """Commands CHNSpec DS-36D to take a physical measurement and normalizes to 31 channels."""
    cal_health = chnspec_driver.get_calibration_health()
    cal_status = cal_health.get("status", "VALID")

    if cal_status in ["EXPIRED", "UNCALIBRATED", "CALIBRATION_INVALID"]:
        if not req.force_measure:
            raise HTTPException(
                status_code=428,
                detail={
                    "error_code": "INSTRUMENT_CALIBRATION_EXPIRED",
                    "message": cal_health.get("message", "Instrument calibration expired or uncalibrated. Physical recalibration required before measurement."),
                    "instrument": "CHNSpec DS-36D",
                    "calibration_health": cal_health
                }
            )
        cal_status = f"{cal_status}_FORCED"

    try:
        meas = chnspec_driver.measure(mode=req.mode)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    meas["calibration_health"] = cal_health

    # Optionally archive into measurements table
    if req.save_to_archive:
        conn = get_db_connection()
        cur = conn.cursor()
        # Find instrument id for CHNSpec
        inst_row = cur.execute("SELECT id FROM instruments WHERE model LIKE '%DS-36D%' LIMIT 1").fetchone()
        if not inst_row:
            conn.close()
            raise HTTPException(
                status_code=500,
                detail="CHNSpec DS-36D spectrophotometer is not found in the verified instrument registry. Controlled registration required."
            )
        inst_id = inst_row["id"]

        spec_inc = 0 if req.mode.upper() == "SCE" else 1
        cur.execute("""
        INSERT INTO measurements (instrument_id, operator, sample_name, raw_content, parsed_json, geometry, measurement_mode, specular_included, is_simulation, calibration_status)
        VALUES (?, 'CHNSpec Operator', ?, ?, ?, 'd/8°', ?, ?, ?, ?)
        """, (
            inst_id,
            req.sample_name or "Lab Sample",
            json.dumps(meas["raw_reflectance"]),
            json.dumps(meas),
            req.mode,
            spec_inc,
            1 if meas.get("is_mock", False) else 0,
            cal_status
        ))
        conn.commit()
        meas["measurement_id"] = cur.lastrowid
        conn.close()

    return meas


@router.get("/chnspec/calibration-health")
def get_chnspec_calibration_health():
    """Returns calibration expiry and freshness health status for CHNSpec DS-36D."""
    return chnspec_driver.get_calibration_health()




# =========================================================================
# Inter-Instrument Comparison & Empirical Bias Analysis
# =========================================================================

class InstrumentCompareRequest(BaseModel):
    ref_reflectance: list[float] = Field(..., description="Reference 31-point spectral reflectance [400..700 nm]")
    target_reflectance: list[float] = Field(..., description="Target 31-point spectral reflectance [400..700 nm]")
    ref_geometry: str | None = Field("d/8°", description="Geometry of reference instrument (e.g. 'd/8°')")
    target_geometry: str | None = Field("d/8°", description="Geometry of target instrument (e.g. 'd/8°')")
    ref_name: str | None = Field("Reference Spectrophotometer (d/8°)", description="Reference instrument name")
    target_name: str | None = Field("CHNSpec DS-36D (d/8°)", description="Target instrument name")
    ref_mode: str | None = Field(None, description="Reference mode (e.g. 'SPEX', 'SCI', 'SCE')")
    target_mode: str | None = Field(None, description="Target mode (e.g. 'SCI', 'SCE')")
    illuminant: str = Field("D65", description="CIE Illuminant")
    observer: str = Field("10", description="CIE Standard Observer")


@router.post("/compare")
def compare_spectrophotometers(req: InstrumentCompareRequest):
    """Compares spectra from two spectrophotometers (e.g. 45°/0° vs d/8° SCI/SCE)."""
    try:
        res = compare_spectral_measurements(
            ref_spectrum=req.ref_reflectance,
            target_spectrum=req.target_reflectance,
            ref_meta={"instrument": req.ref_name, "geometry": req.ref_geometry, "mode": req.ref_mode},
            target_meta={"instrument": req.target_name, "geometry": req.target_geometry, "mode": req.target_mode},
            illuminant=req.illuminant,
            observer=req.observer
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
