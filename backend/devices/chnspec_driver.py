"""
CHNSpec DS-36D Benchtop Spectrophotometer Native Driver
======================================================
PythonNET interface to CHNSpec ConnectedMeasure.dll.
Communicates via USB CDC Virtual COM port (STMicroelectronics VID:PID 0483:5740).
Acquires 43-channel spectral reflectance [360..780 nm @ 10 nm] in SCI or SCE mode,
and normalizes to the canonical 31-channel [400..700 nm @ 10 nm] grid using
monotonic PCHIP interpolation (normalize_spectrum).
Includes robust simulation/mock fallback when physical hardware is disconnected.
"""

import os
import sys
import time
import logging
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger("tintmatch.devices.chnspec")

# Normalization & Colorimetry
from ..color_engine.spectrum_normalizer import normalize_spectrum
from ..color_engine.colorimetry import reflectance_to_lab, reflectance_to_hex
from ..color_engine.constants import WAVELENGTHS

# 43 channels from 360 nm to 780 nm with 10 nm step
CHNSPEC_RAW_WAVELENGTHS = list(range(360, 781, 10))

DEFAULT_DLL_SEARCH_DIRS = [
    os.environ.get("CHNSPEC_DLL_DIR", ""),
    r"C:\Users\renkmerkezi\Desktop\C#_蓝牙+USB接口文档_20250314\English\Dll",
    str(Path(__file__).parent / "chnspec_dll"),
    str(Path(__file__).parent),
]


class CHNSpecDriver:
    """Hardware driver for CHNSpec DS-36D spectrophotometer."""

    def __init__(self, dll_dir: Optional[str] = None):
        self.dll_dir = None
        self._is_mock = False
        self._dev = None
        self._lock = threading.Lock()
        self._connected = False
        self._current_port = None
        self._clr_initialized = False

        self._meas_event = threading.Event()
        self._meas_result: List[List[float]] = []
        self._meas_success = False

        self._cal_event = threading.Event()
        self._cal_success = False

        # Attempt to load ConnectedMeasure.dll via PythonNET
        candidate_dirs = [dll_dir] if dll_dir else DEFAULT_DLL_SEARCH_DIRS
        for d in candidate_dirs:
            if d and os.path.exists(d):
                dll_path = os.path.join(d, "ConnectedMeasure.dll")
                if os.path.exists(dll_path):
                    try:
                        self._init_pythonnet(d)
                        self.dll_dir = d
                        break
                    except Exception as e:
                        logger.warning(f"Failed to initialize PythonNET with {dll_path}: {e}")
                        continue

        if not self._clr_initialized:
            logger.info("CHNSpec driver operating in simulated (MOCK) mode.")
            self._is_mock = True

    def _init_pythonnet(self, dll_dir: str):
        """Initializes pythonnet and binds ConnectedMeasure types."""
        if dll_dir not in sys.path:
            sys.path.append(dll_dir)

        import clr
        clr.AddReference("ConnectedMeasure")
        import System
        from System.Collections.Generic import List as CSharpList
        from ConnectedMeasure import DeviceMethod, ConnectMethod, Measure_Mode

        self._DeviceMethod = DeviceMethod
        self._ConnectMethod = ConnectMethod
        self._Measure_Mode = Measure_Mode
        self._System = System
        self._CSharpList = CSharpList

        # Instantiate device
        self._dev = self._DeviceMethod()
        self._dev.ConnectType = self._ConnectMethod.usb

        # Connect status delegate
        def on_status_change(status: bool):
            self._connected = bool(status)
            if self._dev:
                self._dev.IsConnected = status

        self._dev.ConnectStatusCallback = self._System.Action[bool](on_status_change)

        # Static Measurement Callback
        def on_device_measure(ok: bool, spectral_infos):
            self._meas_success = bool(ok)
            self._meas_result = []
            if ok and spectral_infos:
                for arr in spectral_infos:
                    self._meas_result.append(list(arr))
            self._meas_event.set()

        T_meas = self._System.Action[
            self._System.Boolean,
            self._CSharpList[self._System.Array[self._System.Single]]
        ]
        self._DeviceMethod.DeviceMeasureCallback = T_meas(on_device_measure)

        # Static Calibration Callback
        def on_device_calibration(ok: bool):
            self._cal_success = bool(ok)
            self._cal_event.set()

        T_cal = self._System.Action[self._System.Boolean]
        self._DeviceMethod.DeviceCalibrationCallback = T_cal(on_device_calibration)

        self._clr_initialized = True

    @property
    def is_mock(self) -> bool:
        """Returns True if the driver is operating in mock/simulation mode."""
        return self._is_mock

    @staticmethod
    def list_ports() -> List[Dict[str, Any]]:
        """Enumerates available serial ports, highlighting potential spectrophotometer devices."""
        ports = []
        try:
            import serial.tools.list_ports
            for p in serial.tools.list_ports.comports():
                is_chnspec = False
                desc = p.description or ""
                # STMicroelectronics CDC (VID 0483, PID 5740) or explicit name
                if p.vid == 0x0483 and p.pid == 0x5740:
                    is_chnspec = True
                elif "STMicroelectronics" in desc or "Virtual COM Port" in desc:
                    is_chnspec = True

                ports.append({
                    "port": p.device,
                    "description": desc,
                    "hardware_id": p.hwid,
                    "vid": f"{p.vid:04X}" if p.vid is not None else None,
                    "pid": f"{p.pid:04X}" if p.pid is not None else None,
                    "is_recommended": is_chnspec
                })
        except ImportError:
            # Fallback if pyserial list_ports not available
            ports.append({"port": "COM4", "description": "Default CHNSpec Port", "is_recommended": True})
        return ports

    def auto_detect_port(self) -> Optional[str]:
        """Auto-detects the active port of CHNSpec DS-36D."""
        ports = self.list_ports()
        for p in ports:
            if p.get("is_recommended"):
                return p["port"]
        # If no explicit STMicroelectronics VID found, return COM4 if available
        for p in ports:
            if p["port"] == "COM4":
                return "COM4"
        return ports[0]["port"] if ports else None

    def connect(self, port: Optional[str] = None) -> bool:
        """Connects to the CHNSpec DS-36D on the specified port (or auto-detected)."""
        with self._lock:
            if self._is_mock:
                self._connected = True
                self._current_port = port or "COM4 (Mock)"
                return True

            target_port = port or self.auto_detect_port() or "COM4"
            try:
                self._dev.ConnectedId = target_port
                self._dev.ConnectType = self._ConnectMethod.usb
                ok = bool(self._dev.connect())
                if ok:
                    self._connected = True
                    self._current_port = target_port
                    logger.info(f"Connected to CHNSpec DS-36D on {target_port}")
                    return True
                else:
                    logger.warning(f"Failed to connect to CHNSpec on {target_port}")
                    self._connected = False
                    return False
            except Exception as e:
                logger.error(f"Error connecting to CHNSpec on {target_port}: {e}")
                self._connected = False
                return False

    def disconnect(self) -> bool:
        """Disconnects the instrument."""
        with self._lock:
            if self._is_mock:
                self._connected = False
                self._current_port = None
                return True

            try:
                if self._dev:
                    self._dev.close()
                self._connected = False
                self._current_port = None
                return True
            except Exception as e:
                logger.error(f"Error disconnecting CHNSpec: {e}")
                self._connected = False
                return False

    def is_connected(self) -> bool:
        """Returns True if the instrument is actively connected."""
        if self._is_mock:
            return self._connected
        return self._connected and (self._dev is not None and getattr(self._dev, "IsConnected", False))

    def white_calibrate(self, timeout_sec: float = 12.0) -> Dict[str, Any]:
        """Triggers physical white calibration on the instrument."""
        with self._lock:
            if self._is_mock:
                time.sleep(0.5)
                return {"success": True, "type": "White", "message": "White calibration completed (Mock)"}

            if not self.is_connected():
                raise ConnectionError("Instrument is not connected.")

            self._cal_event.clear()
            self._cal_success = False

            try:
                self._dev.White()
            except Exception as e:
                raise RuntimeError(f"White calibration trigger failed: {e}")

            finished = self._cal_event.wait(timeout=timeout_sec)
            if not finished:
                raise TimeoutError("White calibration timed out waiting for device response.")

            return {
                "success": self._cal_success,
                "type": "White",
                "message": "White calibration successful" if self._cal_success else "White calibration failed"
            }

    def black_calibrate(self, timeout_sec: float = 12.0) -> Dict[str, Any]:
        """Triggers physical black cavity calibration on the instrument."""
        with self._lock:
            if self._is_mock:
                time.sleep(0.5)
                return {"success": True, "type": "Black", "message": "Black calibration completed (Mock)"}

            if not self.is_connected():
                raise ConnectionError("Instrument is not connected.")

            self._cal_event.clear()
            self._cal_success = False

            try:
                self._dev.Black()
            except Exception as e:
                raise RuntimeError(f"Black calibration trigger failed: {e}")

            finished = self._cal_event.wait(timeout=timeout_sec)
            if not finished:
                raise TimeoutError("Black calibration timed out waiting for device response.")

            return {
                "success": self._cal_success,
                "type": "Black",
                "message": "Black calibration successful" if self._cal_success else "Black calibration failed"
            }

    def measure(self, mode: str = "SCI", timeout_sec: float = 12.0) -> Dict[str, Any]:
        """
        Triggers a measurement sweep (SCI or SCE).
        Returns normalized 31-channel reflectance [400..700 nm @ 10 nm], Lab coordinates, and Hex.
        """
        norm_mode = mode.upper().strip()
        if norm_mode not in ("SCI", "SCE", "SCI_SCE"):
            norm_mode = "SCI"

        with self._lock:
            if self._is_mock:
                raw_curve = self._generate_simulated_spectrum(raw_43=True)
                raw_wls = CHNSPEC_RAW_WAVELENGTHS
                normalized_spectrum = [round(float(v), 5) for v in normalize_spectrum(raw_curve, raw_wls)]
                is_mock_flag = True
            else:
                if not self.is_connected():
                    # Attempt auto-connect
                    if not self.connect():
                        raise ConnectionError("CHNSpec DS-36D is not connected and could not be auto-connected.")

                self._meas_event.clear()
                self._meas_result = []
                self._meas_success = False

                csharp_mode = self._Measure_Mode.SCI
                if norm_mode == "SCE":
                    csharp_mode = self._Measure_Mode.SCE
                elif norm_mode == "SCI_SCE":
                    csharp_mode = self._Measure_Mode.SCI_SCE

                try:
                    self._dev.Measure(csharp_mode)
                except Exception as e:
                    raise RuntimeError(f"Measure trigger failed on CHNSpec: {e}")

                finished = self._meas_event.wait(timeout=timeout_sec)
                if not finished:
                    raise TimeoutError(f"CHNSpec measurement timed out after {timeout_sec}s.")

                if not self._meas_success or not self._meas_result:
                    raise RuntimeError("CHNSpec measurement completed with error status.")

                # Raw 43-channel float array
                raw_curve = self._meas_result[0]
                raw_wls = CHNSPEC_RAW_WAVELENGTHS
                # Centralized monotonic PCHIP normalizer converts 43 channels -> standard 31 channels [400..700 nm]
                normalized_spectrum = [round(float(v), 5) for v in normalize_spectrum(raw_curve, raw_wls)]
                is_mock_flag = False

            lab = reflectance_to_lab(normalized_spectrum, illuminant="D65", observer="10")
            hex_color = reflectance_to_hex(normalized_spectrum)

            return {
                "success": True,
                "instrument": "CHNSpec DS-36D (d/8°)",
                "mode": norm_mode,
                "port": self._current_port,
                "is_mock": is_mock_flag,
                "wavelengths": [int(w) for w in WAVELENGTHS],
                "reflectance": normalized_spectrum,
                "raw_wavelengths": raw_wls,
                "raw_reflectance": [round(float(v), 4) for v in raw_curve],
                "lab": {
                    "L": round(lab[0], 2),
                    "a": round(lab[1], 2),
                    "b": round(lab[2], 2)
                },
                "hex": hex_color,
                "geometry": "d/8° (SCI/SCE)",
                "timestamp": time.time()
            }

    def get_status(self) -> Dict[str, Any]:
        """Returns comprehensive device status."""
        return {
            "instrument": "CHNSpec DS-36D",
            "connected": self.is_connected(),
            "port": self._current_port,
            "is_mock": self._is_mock,
            "geometry": "d/8° Integrating Sphere",
            "measurement_modes": ["SCI", "SCE"],
            "native_channels": 43,
            "native_range_nm": [360, 780],
            "canonical_channels": 31,
            "canonical_range_nm": [400, 700],
            "available_ports": self.list_ports()
        }

    def _generate_simulated_spectrum(self, raw_43: bool = False) -> List[float]:
        """Generates realistic synthetic reflectance curve for simulation mode."""
        import numpy as np
        wls = np.array(CHNSPEC_RAW_WAVELENGTHS if raw_43 else WAVELENGTHS, dtype=float)
        # Smooth physical reflectance sigmoid
        R = 0.08 + 0.60 / (1.0 + np.exp(-(wls - 520) / 40.0))
        # Add slight natural spectral curve variation
        R += 0.03 * np.sin((wls - 400) / 50.0)
        R = np.clip(R, 0.01, 0.95)
        # Return percentage scale (0..100%) like raw CHNSpec hardware does
        if raw_43:
            return [round(float(v * 100.0), 3) for v in R]
        return [round(float(v), 5) for v in R]


# Global singleton instance
chnspec_driver = CHNSpecDriver()
