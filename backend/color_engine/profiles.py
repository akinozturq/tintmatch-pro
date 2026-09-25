"""
TintMatch PRO - Scientific and Optimization Profiles
====================================================
Provides centralized, immutable configuration profiles:
1. ColorScienceProfile: Optical constants, wavelength grids, observer/illuminants, tolerances.
2. OptimizationProfile: Distinct weighting profiles for CCM Solver (Color Match, Light Stability, Economy).
"""

from dataclasses import dataclass
from typing import Literal
from .saunderson import (
    SaundersonProfile,
    STANDARD_SAUNDERSON_PROFILES,
    DEFAULT_SAUNDERSON_PROFILE
)


@dataclass(frozen=True)
class ToleranceProfile:
    """Acceptance tolerance criteria distinguishing corporate/plant standards from ISO calculations."""
    id: str
    name: str
    description: str
    mean_de00_limit: float = 0.30
    single_de00_limit: float = 0.50
    loocv_de00_limit: float = 0.50
    loocv_max_de00_limit: float = 1.00
    min_r_squared: float = 0.9950
    max_spectral_rmse: float = 0.0150
    opacity_limit: float = 98.0
    composite_mi_limit: float = 0.30


TOLERANCE_STRICT_LAB = ToleranceProfile(
    id="strict_lab",
    name="Strict Laboratory Standard",
    description="High-precision color lab threshold (Mean ΔE00 ≤ 0.30, Max ΔE00 ≤ 0.50, LOOCV Mean ≤ 0.50, LOOCV Max ≤ 1.00)",
    mean_de00_limit=0.30,
    single_de00_limit=0.50,
    loocv_de00_limit=0.50,
    loocv_max_de00_limit=1.00,
    min_r_squared=0.9950,
    max_spectral_rmse=0.0150,
    opacity_limit=98.0,
    composite_mi_limit=0.30
)

TOLERANCE_INDUSTRIAL = ToleranceProfile(
    id="industrial",
    name="Industrial Production Standard",
    description="Standard factory batch acceptance limit (Mean ΔE00 ≤ 0.50, Max ΔE00 ≤ 0.80, LOOCV Mean ≤ 0.80, LOOCV Max ≤ 1.50)",
    mean_de00_limit=0.50,
    single_de00_limit=0.80,
    loocv_de00_limit=0.80,
    loocv_max_de00_limit=1.50,
    min_r_squared=0.9900,
    max_spectral_rmse=0.0250,
    opacity_limit=97.0,
    composite_mi_limit=0.60
)

TOLERANCE_COMMERCIAL = ToleranceProfile(
    id="commercial",
    name="Commercial Tinting Standard",
    description="Store POS tinting machine tolerance (Mean ΔE00 ≤ 0.80, Max ΔE00 ≤ 1.20, LOOCV Mean ≤ 1.20, LOOCV Max ≤ 2.00)",
    mean_de00_limit=0.80,
    single_de00_limit=1.20,
    loocv_de00_limit=1.20,
    loocv_max_de00_limit=2.00,
    min_r_squared=0.9850,
    max_spectral_rmse=0.0350,
    opacity_limit=96.0,
    composite_mi_limit=0.90
)

STANDARD_TOLERANCE_PROFILES = [
    TOLERANCE_STRICT_LAB,
    TOLERANCE_INDUSTRIAL,
    TOLERANCE_COMMERCIAL
]
DEFAULT_TOLERANCE_PROFILE = TOLERANCE_STRICT_LAB


@dataclass(frozen=True)
class MeasurementContext:
    """
    Central immutable optical measurement and characterization context.
    Prevents cross-geometry or cross-mode invalid optical combinations in CCM.
    """
    instrument_model: str = "X-Rite RM400"
    geometry: str = "45°/0°"             # '45°/0°', 'd/8°'
    measurement_mode: str = "SPEX"       # 'SPEX', 'SCI', 'SCE', 'SCI_SCE'
    specular_included: bool = False
    illuminant: str = "D65"
    observer: str = "10"
    wavelength_grid: tuple[int, ...] = tuple(range(400, 710, 10))
    characterization_version: int = 1
    characterization_id: int | None = None


@dataclass(frozen=True)
class ColorScienceProfile:
    """Immutable scientific parameters and laboratory acceptance limits."""
    name: str = "Standard Industrial Paint Profile"
    wavelength_start: int = 400
    wavelength_end: int = 700
    wavelength_step: int = 10
    
    # CIE Standards
    observer: Literal["10", "2"] = "10"
    reference_illuminant: str = "D65"
    test_illuminants: tuple[str, ...] = ("A", "F11", "F2")
    
    # Surface & Film Optics (Fresnel & Kubelka-Munk)
    saunderson_k1: float = 0.040   # External Fresnel reflection (n ≈ 1.5)
    saunderson_k2: float = 0.600   # Internal diffuse scattering reflection
    saunderson_profile_id: str = "gloss"
    default_film_thickness_um: float = 100.0
    substrate_black_rg: float = 0.04
    substrate_white_rg: float = 0.82
    
    # Quality Gate Acceptance Limits (ISO 18314 conformance)
    char_mean_de00_max: float = 0.30
    char_single_de00_max: float = 0.50
    char_loocv_de00_max: float = 0.50
    char_loocv_max_de00_max: float = 1.00
    char_min_r_squared: float = 0.9950
    char_max_spectral_rmse: float = 0.0150
    opacity_hiding_threshold: float = 98.0
    
    # Formulation match targets
    formulation_de00_target: float = 0.50
    max_total_colorant_load: float = 12.0
    tolerance_profile_id: str = "strict_lab"


@dataclass(frozen=True)
class OptimizationProfile:
    """Weighting parameters for multi-illuminant CCM loss function."""
    id: str
    name: str
    description: str
    weight_d65: float
    weight_a: float
    weight_f11: float
    weight_metamerism: float
    weight_load: float


# Default Industrial CCM Profiles
PROFILE_COLOR_MATCH = OptimizationProfile(
    id="color_match",
    name="Recipe A — Color Match",
    description="Optimized for highest colorimetric fidelity under standard D65 daylight.",
    weight_d65=1.00,
    weight_a=0.15,
    weight_f11=0.15,
    weight_metamerism=0.10,
    weight_load=0.005
)

PROFILE_LIGHT_STABILITY = OptimizationProfile(
    id="light_stability",
    name="Recipe B — Light Stability",
    description="Penalizes metameric color shift across D65, Tungsten A, and TL84/F11 commercial lighting.",
    weight_d65=1.00,
    weight_a=0.45,
    weight_f11=0.45,
    weight_metamerism=0.75,
    weight_load=0.005
)

PROFILE_ECONOMY = OptimizationProfile(
    id="economy",
    name="Recipe C — Economy / Low Load",
    description="Balances acceptable color difference with minimum total pigment paste loading.",
    weight_d65=1.00,
    weight_a=0.20,
    weight_f11=0.20,
    weight_metamerism=0.20,
    weight_load=0.120
)

STANDARD_OPTIMIZATION_PROFILES = [
    PROFILE_COLOR_MATCH,
    PROFILE_LIGHT_STABILITY,
    PROFILE_ECONOMY
]

DEFAULT_SCIENCE_PROFILE = ColorScienceProfile()
