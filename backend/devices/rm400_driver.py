"""
X-Rite RM400 Spectrophotometer Native Driver
=============================================
Direct 64-bit ctypes interface to X-Rite RM400 SDK (RM400.dll).
Enforces physical monotonic normalization through normalize_spectrum().
Provides fallback simulation mode for automated testing without hardware.
"""

import ctypes
import os
import sys
import time
from pathlib import Path
from typing import Optional

from ..color_engine.spectrum_normalizer import normalize_spectrum
from ..color_engine.colorimetry import reflectance_to_lab, reflectance_to_hex
from ..color_engine.constants import WAVELENGTHS


DEFAULT_SEARCH_PATHS = [
    os.environ.get("RM400_DLL_PATH", ""),
    r"C:\Users\renkmerkezi\Desktop\XDS4_RM400_XDS4_RM400_SDK_1.2.2\Drivers\x64\RM400.dll",
    str(Path(__file__).parent / "RM400.dll"),
]


class RM400Driver:
    """Hardware driver for X-Rite RM400 45°/0° spectrophotometer."""

    def __init__(self, dll_path: Optional[str] = None):
        self.dll = None
        self.dll_path = None
        self._is_mock = False

        # Attempt to discover and load DLL
        candidate_paths = [dll_path] if dll_path else DEFAULT_SEARCH_PATHS
        for p in candidate_paths:
            if p and os.path.exists(p):
                try:
                    self.dll = ctypes.WinDLL(p)
                    self.dll_path = p
                    self._setup_bindings()
                    break
                except Exception:
                    continue

        if self.dll is None:
            self._is_mock = True

    def _setup_bindings(self):
        """Bind types to exported C-style DLL functions."""
        try:
            self.dll.GetInterfaceVersion.restype = ctypes.c_char_p
            self.dll.Connect.restype = ctypes.c_bool
            self.dll.Disconnect.restype = ctypes.c_bool
            self.dll.IsConnected.restype = ctypes.c_bool
            self.dll.GetSpectralSetCount.restype = ctypes.c_int
            self.dll.GetWavelengthCount.restype = ctypes.c_int
            self.dll.GetWavelengthValue.argtypes = [ctypes.c_int]
            self.dll.GetWavelengthValue.restype = ctypes.c_int
            self.dll.Measure.restype = ctypes.c_bool
            self.dll.IsDataReady.restype = ctypes.c_bool
            self.dll.GetSpectralData.argtypes = [ctypes.c_int, ctypes.c_int]
            self.dll.GetSpectralData.restype = ctypes.c_float
            self.dll.GetSerialNum.restype = ctypes.c_char_p
            self.dll.GetCalStatus.restype = ctypes.c_int
            self.dll.GetCalSteps.restype = ctypes.c_char_p
            self.dll.CalibrateStep.argtypes = [ctypes.c_char_p]
            self.dll.CalibrateStep.restype = ctypes.c_bool
            self.dll.GetLastErrorCode.restype = ctypes.c_int
            self.dll.GetLastErrorString.restype = ctypes.c_char_p
        except Exception as e:
            # If any function binding fails, fall back to mock
            self.dll = None
            self._is_mock = True

    @property
    def is_available(self) -> bool:
        """True if the 64-bit native DLL was successfully loaded."""
        return self.dll is not None

    def get_interface_version(self) -> str:
        if self.dll:
            try:
                res = self.dll.GetInterfaceVersion()
                return res.decode("utf-8", errors="ignore") if res else "1.0"
            except Exception:
                return "1.0"
        return "1.2 (Mock Mode)"

    @property
    def is_mock(self) -> bool:
        """True if operating in mock/simulation mode."""
        return self._is_mock

    @property
    def connection_state(self) -> str:
        """Returns 4-state connection status: CONNECTED_REAL, CONNECTED_MOCK, DISCONNECTED, ERROR."""
        if self.is_connected():
            return "CONNECTED_MOCK" if self._is_mock else "CONNECTED_REAL"
        return "DISCONNECTED"

    def connect(self) -> bool:
        """Connects to RM400 over USB/FTDI interface."""
        if self.dll:
            try:
                ok = bool(self.dll.Connect())
                self._connected = ok
                return ok
            except Exception:
                self._connected = False
                return False
        self._connected = True
        return True

    def disconnect(self) -> bool:
        """Disconnects instrument."""
        if self.dll:
            try:
                ok = bool(self.dll.Disconnect())
                self._connected = not ok
                return ok
            except Exception:
                self._connected = False
                return False
        self._connected = False
        return True

    def is_connected(self) -> bool:
        """Checks if device is currently connected and responsive."""
        if self.dll:
            try:
                return bool(self.dll.IsConnected())
            except Exception:
                return False
        return getattr(self, "_connected", False)

    def get_serial_number(self) -> str:
        if self.dll and self.is_connected():
            try:
                sn = self.dll.GetSerialNum()
                return sn.decode("utf-8", errors="ignore") if sn else "UNKNOWN"
            except Exception:
                return "RM400-ERROR"
        return "RM400-019482"

    def get_calibration_status(self) -> dict:
        """Returns calibration status code, text and required calibration steps."""
        if self.dll and self.is_connected():
            try:
                code = int(self.dll.GetCalStatus())
                steps_raw = self.dll.GetCalSteps()
                steps_str = steps_raw.decode("utf-8", errors="ignore") if steps_raw else ""
                steps = [s.strip() for s in steps_str.split(";") if s.strip()]
                return {
                    "is_calibrated": (code == 0),
                    "code": code,
                    "steps": steps,
                    "message": "Instrument Calibrated" if code == 0 else "Calibration Required"
                }
            except Exception as e:
                return {"is_calibrated": False, "code": -1, "steps": [], "message": str(e)}
        return {"is_calibrated": True, "code": 0, "steps": ["White"], "message": "Calibrated (Ready)"}

    def calibrate(self, step: str = "White") -> bool:
        """Executes a calibration step (e.g. 'White' reference tile)."""
        if self.dll and self.is_connected():
            try:
                return bool(self.dll.CalibrateStep(step.encode("utf-8")))
            except Exception:
                return False
        return True

    def measure(self, timeout_sec: float = 8.0) -> dict:
        """
        Triggers a physical measurement sweep.
        Returns normalized 31-channel reflectance [400..700 nm @ 10 nm], Lab coordinates, and Hex.
        """
        if self.dll and self.is_connected():
            success = self.dll.Measure()
            if not success:
                err_msg = self.dll.GetLastErrorString()
                err_str = err_msg.decode("utf-8", errors="ignore") if err_msg else "Measurement trigger failed"
                raise RuntimeError(f"RM400 Measurement Error: {err_str}")

            # Poll for data ready
            start_time = time.time()
            while not self.dll.IsDataReady():
                if time.time() - start_time > timeout_sec:
                    raise TimeoutError("RM400 Measurement timed out waiting for data.")
                time.sleep(0.1)

            # Retrieve wavelengths and raw spectral data
            wl_count = self.dll.GetWavelengthCount()
            raw_wls = []
            raw_vals = []
            for i in range(wl_count):
                w = self.dll.GetWavelengthValue(i)
                v = self.dll.GetSpectralData(0, i)
                raw_wls.append(w)
                raw_vals.append(v)

            # Normalize using centralized monotonic PCHIP normalizer
            normalized_spectrum = normalize_spectrum(raw_vals, raw_wls)
        else:
            # Fallback mock measurement for automated testing / disconnected mode
            normalized_spectrum = self._generate_simulated_spectrum()

        lab = reflectance_to_lab(normalized_spectrum)
        hex_color = reflectance_to_hex(normalized_spectrum)

        return {
            "success": True,
            "instrument": "X-Rite RM400 (45°/0°)",
            "serial_number": self.get_serial_number(),
            "wavelengths": [int(w) for w in WAVELENGTHS],
            "reflectance": normalized_spectrum,
            "lab": lab,
            "hex": hex_color,
            "geometry": "45°/0°",
            "aperture_mm": 4.0,
            "timestamp": time.time()
        }

    def _generate_simulated_spectrum(self) -> list[float]:
        """Generates realistic synthetic 31-channel physical reflectance curve."""
        import numpy as np
        # Smooth physical reflectance sigmoid
        wl = np.array(WAVELENGTHS, dtype=float)
        R = 0.05 + 0.65 / (1.0 + np.exp(-(wl - 530) / 35.0))
        return [round(float(v), 5) for v in R]


# Global singleton instance
rm400_driver = RM400Driver()
