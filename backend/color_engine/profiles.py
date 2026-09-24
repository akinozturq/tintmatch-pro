"""
TintMatch PRO - Scientific and Optimization Profiles
====================================================
Provides centralized, immutable configuration profiles:
1. ColorScienceProfile: Optical constants, wavelength grids, observer/illuminants, tolerances.
2. OptimizationProfile: Distinct weighting profiles for CCM Solver (Color Match, Light Stability, Economy).
"""

from dataclasses import dataclass
from typing import Literal


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
    default_film_thickness_um: float = 100.0
    substrate_black_rg: float = 0.04
    substrate_white_rg: float = 0.82
    
    # Quality Gate Acceptance Limits (ISO 18314 conformance)
    char_mean_de00_max: float = 0.30
    char_single_de00_max: float = 0.50
    char_min_r_squared: float = 0.9950
    char_max_spectral_rmse: float = 0.0150
    opacity_hiding_threshold: float = 98.0
    
    # Formulation match targets
    formulation_de00_target: float = 0.50
    max_total_colorant_load: float = 12.0


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
