"""
Spectral Grid Normalizer and Interpolator Module
================================================
Provides centralized, shape-preserving spectral normalization for spectrophotometer data.
Guarantees:
- Strict PCHIP interpolation (no Runge overshoot: R > 1.0 or R < 0.0)
- Monotonicity preservation
- Boundary clamping to physical reflectance limits [0.0, 1.0]
- Zero silent truncation (raises explicit error when ambiguous wavelength data is provided)
"""

import numpy as np
from scipy.interpolate import PchipInterpolator
from .constants import WAVELENGTHS, N_WAVELENGTHS


def normalize_spectrum(
    reflectances: list[float] | np.ndarray,
    wavelengths: list[float] | np.ndarray | None = None,
    target_grid: np.ndarray = WAVELENGTHS,
    allow_extrapolation: bool = False
) -> np.ndarray:
    """
    Normalizes an arbitrary spectral measurement curve onto the standard 400-700 nm @ 10 nm grid (31 points).

    Args:
        reflectances: Measured reflectance values (fractional 0.0-1.0 or percentage 0-100%).
        wavelengths: Corresponding wavelength values in nm. If None, reflectances must be exactly 31 points.
        target_grid: Target wavelength array (default: 400-700 nm, 10 nm step, 31 points).
        allow_extrapolation: If False (default), raises ValueError when source range does not fully cover target_grid.

    Returns:
        31-point numpy array clamped strictly to [0.0, 1.0].

    Raises:
        ValueError: If array lengths do not match, values are invalid, or source range does not cover target_grid.
    """
    refl = np.asarray(reflectances, dtype=float)
    if len(refl) == 0:
        raise ValueError("Reflectance array cannot be empty.")

    if np.any(np.isnan(refl)) or np.any(np.isinf(refl)):
        raise ValueError("Reflectance spectrum contains NaN or infinite values.")

    # 1. When wavelengths are not specified
    if wavelengths is None:
        if len(refl) == len(target_grid):
            # Scale check (percentage vs fractional)
            if np.max(refl) > 1.5:
                refl = refl / 100.0
            return np.clip(refl, 0.0, 1.0)
        else:
            raise ValueError(
                f"Spectral curve has {len(refl)} points, but standard grid expects {len(target_grid)} points. "
                "Explicit wavelength coordinate array must be provided for interpolation."
            )

    wls = np.asarray(wavelengths, dtype=float)
    if len(wls) != len(refl):
        raise ValueError(f"Wavelengths length ({len(wls)}) does not match reflectances length ({len(refl)}).")

    if np.any(np.isnan(wls)) or np.any(np.isinf(wls)):
        raise ValueError("Wavelength array contains NaN or infinite values.")

    if np.any(wls <= 0):
        raise ValueError("Wavelength values must be strictly positive (> 0 nm).")

    # 2. Deduplicate by computing group mean for identical wavelengths & sort monotonically
    unique_wls = np.unique(wls)
    if len(unique_wls) < len(wls):
        # Aggregate multiple measurements at same wavelength using arithmetic mean
        averaged_refl = np.zeros(len(unique_wls), dtype=float)
        for idx, u_wl in enumerate(unique_wls):
            mask = (wls == u_wl)
            averaged_refl[idx] = np.mean(refl[mask])
        sorted_refl = averaged_refl
    else:
        sort_idx = np.argsort(wls)
        unique_wls = wls[sort_idx]
        sorted_refl = refl[sort_idx]

    # Handle percentage scale (0-100) vs fractional (0-1)
    if np.max(sorted_refl) > 1.5:
        sorted_refl = sorted_refl / 100.0

    # If within target_grid exactly, return clipped directly
    if len(unique_wls) == len(target_grid) and np.allclose(unique_wls, target_grid, atol=1e-2):
        return np.clip(sorted_refl, 0.0, 1.0)

    # Minimum points for PCHIP
    if len(unique_wls) < 2:
        raise ValueError("At least 2 unique wavelength points are required for spectral interpolation.")

    # Strict coverage barrier: Source range must completely cover the target grid unless explicitly permitted
    min_src = float(np.min(unique_wls))
    max_src = float(np.max(unique_wls))
    min_tgt = float(np.min(target_grid))
    max_tgt = float(np.max(target_grid))

    if min_src > min_tgt or max_src < max_tgt:
        if not allow_extrapolation:
            raise ValueError(
                f"Spectral range [{min_src:.1f}..{max_src:.1f} nm] does not fully cover "
                f"the target canonical grid [{min_tgt:.1f}..{max_tgt:.1f} nm]. "
                "Uncontrolled extrapolation is rejected by default to prevent unphysical CCM formulation errors. "
                "Provide measurements covering at least [400..700 nm] or set allow_extrapolation=True."
            )

    # 3. PCHIP Shape-Preserving Hermite Interpolation (prevents Runge oscillations)
    pchip = PchipInterpolator(unique_wls, sorted_refl, extrapolate=allow_extrapolation)
    interpolated = pchip(target_grid)

    # 4. Strict physical reflectance boundaries
    return np.clip(interpolated, 0.0, 1.0)


def validate_spectrum_physicality(
    reflectance: list[float] | np.ndarray,
    tolerance_low: float = -0.05,
    tolerance_high: float = 1.20
) -> dict:
    """
    Validates physical plausibility of a spectral reflectance curve before or after normalization.
    Detects sensor saturation (R > 1.20) or dark reference drift (R < -0.05).

    Returns:
        dict: {
            "is_valid": bool,
            "status": "OK" | "SPECTRUM_OUT_OF_RANGE" | "SENSOR_SATURATION" | "DARK_DRIFT",
            "min_reflectance": float,
            "max_reflectance": float,
            "warnings": list[str]
        }
    """
    refl = np.asarray(reflectance, dtype=float)
    if len(refl) == 0:
        return {
            "is_valid": False,
            "status": "SPECTRUM_OUT_OF_RANGE",
            "min_reflectance": 0.0,
            "max_reflectance": 0.0,
            "warnings": ["Reflectance spectrum is empty."]
        }

    min_v = float(np.min(refl))
    max_v = float(np.max(refl))
    warnings = []
    status = "OK"
    is_valid = True

    if min_v < tolerance_low:
        is_valid = False
        status = "DARK_DRIFT"
        warnings.append(
            f"SEVERE_DARK_NOISE_FLOOR: Severe negative reflectance detected (min: {min_v:.4f}). "
            "Indicates spectrophotometer dark trap calibration drift or zero-level error."
        )
    elif min_v < 0.0:
        warnings.append(
            f"Minor negative reflectance detected (min: {min_v:.4f}). "
            "Will be clamped to 0.0 physically."
        )

    if max_v > tolerance_high:
        is_valid = False
        status = "SENSOR_SATURATION"
        warnings.append(
            f"SEVERE_SENSOR_SATURATION: Severe reflectance overshoot detected (max: {max_v:.4f}). "
            "Indicates spectrophotometer sensor saturation, white tile misalignment, or unscaled percentage data."
        )
    elif max_v > 1.0:
        warnings.append(
            f"Minor reflectance overshoot detected (max: {max_v:.4f}). "
            "Will be clamped to 1.0 physically."
        )

    if not is_valid and status == "OK":
        status = "SPECTRUM_OUT_OF_RANGE"

    return {
        "is_valid": is_valid,
        "is_physically_plausible": is_valid,
        "has_severe_dark_noise": (status == "DARK_DRIFT"),
        "has_severe_saturation": (status == "SENSOR_SATURATION"),
        "status": status,
        "min_reflectance": round(min_v, 4),
        "max_reflectance": round(max_v, 4),
        "warnings": warnings
    }

