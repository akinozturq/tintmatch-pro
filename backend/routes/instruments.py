"""
Instruments API Router
======================
Endpoints for interacting with laboratory spectrophotometers:
1. CHNSpec DS-36D Benchtop Spectrophotometer (d/8° Integrating Sphere, USB CDC / COM4).
2. X-Rite RM400 Portable Spectrophotometer (45°/0° Directional, 64-bit DLL).
Handles hardware connection, auto-discovery of COM ports, calibration, and spectral acquisition.
"""

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..devices.rm400_driver import rm400_driver
from ..devices.chnspec_driver import chnspec_driver, CHNSpecDriver
from ..color_engine.instrument_comparison import compare_spectral_measurements
from ..database.db import get_db_connection

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


class CalibrateRequest(BaseModel):
    step: str = Field("White", description="Calibration step to execute ('White', 'Black')")


class MeasureRequest(BaseModel):
    sample_name: str | None = Field("Lab Sample", description="Sample identification")
    save_to_archive: bool = Field(True, description="Whether to record measurement in measurements table")


class CHNSpecConnectRequest(BaseModel):
    port: str | None = Field(None, description="Serial port (e.g. 'COM4'). Auto-detected if omitted.")


class CHNSpecCalibrateRequest(BaseModel):
    type: str = Field("White", description="Calibration type ('White' or 'Black')")


class CHNSpecMeasureRequest(BaseModel):
    mode: str = Field("SCI", description="Measurement mode: 'SCI', 'SCE', 'SCI_SCE'")
    sample_name: str | None = Field("Lab Sample", description="Sample identification")
    save_to_archive: bool = Field(True, description="Whether to record measurement in measurements table")


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
    try:
        meas = chnspec_driver.measure(mode=req.mode)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Optionally archive into measurements table
    if req.save_to_archive:
        conn = get_db_connection()
        cur = conn.cursor()
        # Find instrument id for CHNSpec
        inst_row = cur.execute("SELECT id FROM instruments WHERE model LIKE '%DS-36D%' LIMIT 1").fetchone()
        inst_id = inst_row["id"] if inst_row else 2

        spec_inc = 0 if req.mode.upper() == "SCE" else 1
        cur.execute("""
        INSERT INTO measurements (instrument_id, operator, sample_name, raw_content, parsed_json, geometry, measurement_mode, specular_included)
        VALUES (?, 'CHNSpec Operator', ?, ?, ?, 'd/8°', ?, ?)
        """, (
            inst_id,
            req.sample_name or "Lab Sample",
            json.dumps(meas["raw_reflectance"]),
            json.dumps(meas),
            req.mode,
            spec_inc
        ))
        conn.commit()
        meas["measurement_id"] = cur.lastrowid
        conn.close()

    return meas


# =========================================================================
# X-Rite RM400 Spectrophotometer Endpoints
# =========================================================================

@router.get("/rm400/status")
def get_rm400_status():
    """Queries hardware status, driver version, calibration state, and serial number."""
    connected = rm400_driver.is_connected()
    cal = rm400_driver.get_calibration_status()
    version = rm400_driver.get_interface_version()
    serial = rm400_driver.get_serial_number()

    return {
        "instrument": "X-Rite RM400",
        "driver_available": rm400_driver.is_available,
        "is_mock": rm400_driver.is_mock,
        "connection_state": rm400_driver.connection_state,
        "dll_path": rm400_driver.dll_path,
        "interface_version": version,
        "connected": connected,
        "serial_number": serial,
        "calibration": cal
    }


@router.post("/rm400/connect")
def connect_rm400():
    """Attempts to connect to RM400 hardware."""
    success = rm400_driver.connect()
    return {
        "success": success,
        "connected": rm400_driver.is_connected(),
        "is_mock": rm400_driver.is_mock,
        "connection_state": rm400_driver.connection_state,
        "message": "Connected to X-Rite RM400" if success else "Unable to establish connection to RM400."
    }


@router.post("/rm400/disconnect")
def disconnect_rm400():
    """Disconnects from RM400."""
    success = rm400_driver.disconnect()
    return {"success": success, "message": "RM400 disconnected."}


@router.post("/rm400/calibrate")
def calibrate_rm400(req: CalibrateRequest):
    """Executes calibration step on RM400."""
    success = rm400_driver.calibrate(req.step)
    return {
        "success": success,
        "step": req.step,
        "message": f"Calibration step '{req.step}' completed successfully." if success else "Calibration failed."
    }


@router.post("/rm400/measure")
def measure_sample(req: MeasureRequest):
    """Commands RM400 to take a spectral measurement and normalizes it."""
    try:
        meas = rm400_driver.measure()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Optionally archive into measurements table
    if req.save_to_archive:
        conn = get_db_connection()
        cur = conn.cursor()
        inst_row = cur.execute("SELECT id FROM instruments WHERE model LIKE '%RM400%' LIMIT 1").fetchone()
        inst_id = inst_row["id"] if inst_row else 1

        cur.execute("""
        INSERT INTO measurements (instrument_id, operator, sample_name, raw_content, parsed_json, geometry, measurement_mode, specular_included)
        VALUES (?, 'RM400 Operator', ?, ?, ?, '45°/0°', 'SPEX', 0)
        """, (
            inst_id,
            req.sample_name or "Lab Sample",
            json.dumps(meas["reflectance"]),
            json.dumps(meas)
        ))
        conn.commit()
        meas["measurement_id"] = cur.lastrowid
        conn.close()

    return meas


# =========================================================================
# Inter-Instrument Comparison & Empirical Bias Analysis
# =========================================================================

class InstrumentCompareRequest(BaseModel):
    ref_reflectance: list[float] = Field(..., description="Reference 31-point spectral reflectance [400..700 nm]")
    target_reflectance: list[float] = Field(..., description="Target 31-point spectral reflectance [400..700 nm]")
    ref_geometry: str | None = Field("45°/0°", description="Geometry of reference instrument (e.g. '45°/0°')")
    target_geometry: str | None = Field("d/8°", description="Geometry of target instrument (e.g. 'd/8°')")
    ref_name: str | None = Field("X-Rite RM400 (45°/0°)", description="Reference instrument name")
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
