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
    target_grid: np.ndarray = WAVELENGTHS
) -> np.ndarray:
    """
    Normalizes an arbitrary spectral measurement curve onto the standard 400-700 nm @ 10 nm grid (31 points).

    Args:
        reflectances: Measured reflectance values (fractional 0.0-1.0 or percentage 0-100%).
        wavelengths: Corresponding wavelength values in nm. If None, reflectances must be exactly 31 points.
        target_grid: Target wavelength array (default: 400-700 nm, 10 nm step, 31 points).

    Returns:
        31-point numpy array clamped strictly to [0.0, 1.0].

    Raises:
        ValueError: If array lengths do not match or if length is ambiguous without wavelength data.
    """
    refl = np.asarray(reflectances, dtype=float)

    # 1. When wavelengths are not specified
    if wavelengths is None:
        if len(refl) == len(target_grid):
            # Scale check (percentage vs fractional)
            if np.nanmax(refl) > 1.5:
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

    # 2. Deduplicate & sort monotonically
    unique_wls, indices = np.unique(wls, return_index=True)
    sorted_refl = refl[indices]

    # Handle percentage scale (0-100) vs fractional (0-1)
    if np.nanmax(sorted_refl) > 1.5:
        sorted_refl = sorted_refl / 100.0

    # If within target_grid exactly, return clipped directly
    if len(unique_wls) == len(target_grid) and np.allclose(unique_wls, target_grid, atol=1e-2):
        return np.clip(sorted_refl, 0.0, 1.0)

    # Minimum points for PCHIP
    if len(unique_wls) < 2:
        raise ValueError("At least 2 unique wavelength points are required for spectral interpolation.")

    # 3. PCHIP Shape-Preserving Hermite Interpolation (prevents Runge oscillations)
    pchip = PchipInterpolator(unique_wls, sorted_refl, extrapolate=True)
    interpolated = pchip(target_grid)

    # 4. Strict physical reflectance boundaries
    return np.clip(interpolated, 0.0, 1.0)
