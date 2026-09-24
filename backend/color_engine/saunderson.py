"""
Saunderson Surface Correction Module
====================================
Corrects measured external reflectance (R_m) for specular Fresnel surface reflection (k1)
and internal diffuse back-reflection at the film-air boundary (k2).

Formulas:
- Internal reflectance R_i:
    R_i = (R_m - k1) / (1 - k1 - k2 + k2 * R_m)

- Inverse (Measured R_m from internal R_i):
    R_m = k1 + (1 - k1) * (1 - k2) * R_i / (1 - k2 * R_i)

Default coefficients for glossy industrial coating surfaces:
    k1 = 0.04 (Fresnel surface reflection at normal incidence)
    k2 = 0.60 (Internal diffuse reflectance)
"""

from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class SaundersonProfile:
    """Optical parameters for film surface Fresnel reflection and internal diffuse scattering."""
    id: str
    name: str
    description: str
    k1: float = 0.040   # External Fresnel reflection (n ≈ 1.5)
    k2: float = 0.600   # Internal diffuse back-reflection
    refractive_index: float = 1.50


# Predefined industrial surface optical profiles
SAUNDERSON_GLOSS = SaundersonProfile(
    id="gloss",
    name="Glossy Paint Coating (Standard)",
    description="High-gloss industrial and architectural paint films (n ≈ 1.50, k1=0.04, k2=0.60)",
    k1=0.040,
    k2=0.600,
    refractive_index=1.50
)

SAUNDERSON_SEMI_GLOSS = SaundersonProfile(
    id="semi_gloss",
    name="Semi-Gloss / Satin Coating",
    description="Semi-gloss and satin architectural finishes (k1=0.030, k2=0.550)",
    k1=0.030,
    k2=0.550,
    refractive_index=1.48
)

SAUNDERSON_MATTE = SaundersonProfile(
    id="matte",
    name="Matte / Deep Flat Coating",
    description="Low-sheen, high-PVC matte decorative coatings with micro-roughness (k1=0.015, k2=0.400)",
    k1=0.015,
    k2=0.400,
    refractive_index=1.45
)

SAUNDERSON_COIL = SaundersonProfile(
    id="coil",
    name="Industrial Coil / Polyester Coating",
    description="Stoved polyester/polyurethane coil coatings on metal substrates (k1=0.045, k2=0.620)",
    k1=0.045,
    k2=0.620,
    refractive_index=1.52
)

STANDARD_SAUNDERSON_PROFILES = [
    SAUNDERSON_GLOSS,
    SAUNDERSON_SEMI_GLOSS,
    SAUNDERSON_MATTE,
    SAUNDERSON_COIL
]
DEFAULT_SAUNDERSON_PROFILE = SAUNDERSON_GLOSS


def saunderson_correction(
    r_meas: np.ndarray | list[float] | float,
    k1: float = 0.04,
    k2: float = 0.60,
    internal: bool = True
) -> np.ndarray:
    """
    Transforms measured reflectance R_m to internal reflectance R_i.
    If internal=False, it performs the inverse transformation (R_i to R_m).

    Args:
        r_meas: Measured spectral reflectance array (0.0 to 1.0)
        k1: Surface Fresnel reflection constant (default 0.04)
        k2: Internal reflection constant (default 0.60)
        internal: If True returns R_i; if False returns R_m

    Returns:
        Corrected spectral reflectance array clamped to [0.0, 1.0]
    """
    r_arr = np.asarray(r_meas, dtype=float)

    if not internal:
        return inverse_saunderson(r_arr, k1=k1, k2=k2)

    # Denominator: (1 - k1 - k2 + k2 * R_m)
    denominator = 1.0 - k1 - k2 + k2 * r_arr
    # Prevent divide by zero or extreme singularities
    denominator = np.where(np.abs(denominator) < 1e-9, 1e-9, denominator)

    r_internal = (r_arr - k1) / denominator
    return np.clip(r_internal, 0.0, 0.9999)


def inverse_saunderson(
    r_internal: np.ndarray | list[float] | float,
    k1: float = 0.04,
    k2: float = 0.60
) -> np.ndarray:
    """
    Converts internal reflectance R_i back to measurable surface reflectance R_m.

    Args:
        r_internal: Internal reflectance array (0.0 to 1.0)
        k1: Surface Fresnel reflection constant
        k2: Internal reflection constant

    Returns:
        Predicted measured reflectance array in [0.0, 1.0]
    """
    r_int = np.asarray(r_internal, dtype=float)
    r_int_safe = np.clip(r_int, 0.0, 0.9999)

    denominator = 1.0 - k2 * r_int_safe
    denominator = np.where(np.abs(denominator) < 1e-9, 1e-9, denominator)

    r_meas = k1 + ((1.0 - k1) * (1.0 - k2) * r_int_safe) / denominator
    return np.clip(r_meas, 0.0, 1.0)
