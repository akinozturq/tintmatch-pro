"""
Instruments API Router
======================
Endpoints for interacting with spectrophotometers, specifically the X-Rite RM400.
Handles connection, calibration, physical acquisition, and spectral normalization.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..devices.rm400_driver import rm400_driver
from ..database.db import get_db_connection

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


class CalibrateRequest(BaseModel):
    step: str = Field("White", description="Calibration step to execute ('White', 'Black')")


class MeasureRequest(BaseModel):
    sample_name: str | None = Field("Lab Sample", description="Sample identification")
    save_to_archive: bool = Field(True, description="Whether to record measurement in measurements table")


@router.get("")
def list_instruments():
    """Returns all registered spectrophotometers."""
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM instruments ORDER BY id ASC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


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
        import json
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
        INSERT INTO measurements (instrument_id, operator, sample_name, raw_content, parsed_json)
        VALUES (1, 'RM400 Operator', ?, ?, ?)
        """, (
            req.sample_name or "Lab Sample",
            json.dumps(meas["reflectance"]),
            json.dumps(meas)
        ))
        conn.commit()
        meas["measurement_id"] = cur.lastrowid
        conn.close()

    return meas
