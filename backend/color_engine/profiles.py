"""
TintMatch PRO - Scientific and Optimization Profiles
====================================================
Provides centralized, immutable configuration profiles:
1. ColorScienceProfile: Optical constants, wavelength grids, observer/illuminants, tolerances.
2. OptimizationProfile: Distinct weighting profiles for CCM Solver (Color Match, Light Stability, Economy).
"""

import copy
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Literal
from .saunderson import (
    SaundersonProfile,
    STANDARD_SAUNDERSON_PROFILES,
    DEFAULT_SAUNDERSON_PROFILE
)
from .constraints import FormulationConstraints


ENGINE_VERSION = "2.2.0"


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
    loocv_p95_de00_limit: float = 0.80
    min_r_squared: float = 0.9950
    max_spectral_rmse: float = 0.0150
    opacity_limit: float = 98.0
    composite_mi_limit: float = 0.30


TOLERANCE_STRICT_LAB = ToleranceProfile(
    id="strict_lab",
    name="Strict Laboratory Standard",
    description="High-precision color lab threshold (Mean ΔE00 ≤ 0.30, Max ΔE00 ≤ 0.50, LOOCV Mean ≤ 0.50, LOOCV Max ≤ 1.00, LOOCV p95 ≤ 0.80)",
    mean_de00_limit=0.30,
    single_de00_limit=0.50,
    loocv_de00_limit=0.50,
    loocv_max_de00_limit=1.00,
    loocv_p95_de00_limit=0.80,
    min_r_squared=0.9950,
    max_spectral_rmse=0.0150,
    opacity_limit=98.0,
    composite_mi_limit=0.30
)

TOLERANCE_INDUSTRIAL = ToleranceProfile(
    id="industrial",
    name="Industrial Production Standard",
    description="Standard factory batch acceptance limit (Mean ΔE00 ≤ 0.50, Max ΔE00 ≤ 0.80, LOOCV Mean ≤ 0.80, LOOCV Max ≤ 1.50, LOOCV p95 ≤ 1.20)",
    mean_de00_limit=0.50,
    single_de00_limit=0.80,
    loocv_de00_limit=0.80,
    loocv_max_de00_limit=1.50,
    loocv_p95_de00_limit=1.20,
    min_r_squared=0.9900,
    max_spectral_rmse=0.0250,
    opacity_limit=97.0,
    composite_mi_limit=0.60
)

TOLERANCE_COMMERCIAL = ToleranceProfile(
    id="commercial",
    name="Commercial Tinting Standard",
    description="Store POS tinting machine tolerance (Mean ΔE00 ≤ 0.80, Max ΔE00 ≤ 1.20, LOOCV Mean ≤ 1.20, LOOCV Max ≤ 2.00, LOOCV p95 ≤ 1.60)",
    mean_de00_limit=0.80,
    single_de00_limit=1.20,
    loocv_de00_limit=1.20,
    loocv_max_de00_limit=2.00,
    loocv_p95_de00_limit=1.60,
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
    instrument_model: str = "CHNSpec DS-36D"
    geometry: str = "d/8°"               # 'd/8°', '45°/0°'
    measurement_mode: str = "SCI"        # 'SCI', 'SCE', 'SCI_SCE', 'SPEX'
    specular_included: bool = True
    illuminant: str = "D65"
    observer: str = "10"
    wavelength_grid: tuple[int, ...] = tuple(range(400, 710, 10))
    characterization_version: int = 1
    characterization_id: int | None = None


# Predefined industrial spectrophotometer measurement contexts
MEASUREMENT_DS36D_D8_SCI = MeasurementContext(
    instrument_model="CHNSpec DS-36D",
    geometry="d/8°",
    measurement_mode="SCI",
    specular_included=True,
    illuminant="D65",
    observer="10"
)

MEASUREMENT_DS36D_D8_SCE = MeasurementContext(
    instrument_model="CHNSpec DS-36D",
    geometry="d/8°",
    measurement_mode="SCE",
    specular_included=False,
    illuminant="D65",
    observer="10"
)

MEASUREMENT_GENERIC_45_0 = MeasurementContext(
    instrument_model="Generic 45°/0° Reference",
    geometry="45°/0°",
    measurement_mode="SPEX",
    specular_included=False,
    illuminant="D65",
    observer="10"
)

DEFAULT_MEASUREMENT_CONTEXT = MEASUREMENT_DS36D_D8_SCI


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
    char_loocv_p95_de00_max: float = 0.80
    char_min_r_squared: float = 0.9950
    char_max_spectral_rmse: float = 0.0150
    opacity_hiding_threshold: float = 98.0
    
    # Formulation match targets
    formulation_de00_target: float = 0.50
    max_total_colorant_load: float = 12.0
    tolerance_profile_id: str = "strict_lab"


@dataclass(frozen=True)
class OptimizationProfile:
    """Weighting parameters and profile-specific acceptance policy for CCM Solver."""
    id: str
    name: str
    description: str
    weight_d65: float
    weight_a: float
    weight_f11: float
    weight_metamerism: float
    weight_load: float = 0.005
    # Optical Forward Model Configuration (Infinite-thickness vs Finite-thickness 2-constant K-M)
    forward_model: Literal["opaque_infinite", "finite_film"] = "opaque_infinite"
    film_thickness_um: float = 100.0
    substrate_rg: float = 0.82
    # Profile-based acceptance gate policy criteria:
    gate_limit_d65: float = 0.50
    gate_limit_a: float | None = None
    gate_limit_f11: float | None = None
    gate_limit_mi: float | None = None
    gate_limit_load: float | None = None
    gate_load_budget_ratio: float | None = None


# Default Industrial CCM Profiles
PROFILE_COLOR_MATCH = OptimizationProfile(
    id="color_match",
    name="Recipe A — Color Match",
    description="Optimized for highest colorimetric fidelity under standard D65 daylight.",
    weight_d65=1.00,
    weight_a=0.15,
    weight_f11=0.15,
    weight_metamerism=0.10,
    weight_load=0.005,
    gate_limit_d65=0.50,
    gate_limit_a=None,
    gate_limit_f11=None,
    gate_limit_mi=None,
    gate_limit_load=None
)

PROFILE_LIGHT_STABILITY = OptimizationProfile(
    id="light_stability",
    name="Recipe B — Light Stability",
    description="Penalizes metameric color shift across D65, Tungsten A, and TL84/F11 commercial lighting.",
    weight_d65=1.00,
    weight_a=0.45,
    weight_f11=0.45,
    weight_metamerism=0.75,
    weight_load=0.005,
    gate_limit_d65=0.50,
    gate_limit_a=0.80,       # Strict Illuminant A barrier
    gate_limit_f11=0.80,     # Strict Illuminant F11 / TL84 barrier
    gate_limit_mi=0.50,      # Strict Composite Metamerism barrier
    gate_limit_load=None
)

PROFILE_ECONOMY = OptimizationProfile(
    id="economy",
    name="Recipe C — Economy / Low Load",
    description="Balances acceptable color difference with minimum total pigment paste loading.",
    weight_d65=1.00,
    weight_a=0.20,
    weight_f11=0.20,
    weight_metamerism=0.20,
    weight_load=0.120,
    gate_limit_d65=0.80,     # Commercial acceptable threshold
    gate_limit_a=None,
    gate_limit_f11=None,
    gate_limit_mi=None,
    gate_limit_load=None,
    gate_load_budget_ratio=0.85  # Demands total load <= 85% of max_total_load
)

STANDARD_OPTIMIZATION_PROFILES = [
    PROFILE_COLOR_MATCH,
    PROFILE_LIGHT_STABILITY,
    PROFILE_ECONOMY
]

DEFAULT_SCIENCE_PROFILE = ColorScienceProfile()


@dataclass(frozen=True)
class SolverProfile:
    """Solver algorithmic parameters and multi-start configuration."""
    name: str = "SLSQP"
    max_iterations: int = 250
    ftol: float = 1e-6
    eps: float = 1e-3
    enable_multistart: bool = False
    num_starts: int = 3
    random_seed: int = 42
    candidate_pool_min: int = 12
    combinatorial_subset_max_candidates: int = 20


@dataclass(frozen=True)
class ExecutionContext:
    """
    Central, authoritative Single Source of Truth for all colorimetric, optical,
    measurement, formulation, tolerance, and solver parameters in the CCM Engine.
    Guarantees no floating literals or uncoupled defaults exist in calculation routines.
    """
    science_profile: ColorScienceProfile
    measurement_context: MeasurementContext
    optimization_profile: OptimizationProfile
    tolerance_profile: ToleranceProfile
    constraint_profile: FormulationConstraints
    solver_profile: SolverProfile = SolverProfile()
    provenance: dict = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        science_profile: ColorScienceProfile | None = None,
        measurement_context: MeasurementContext | None = None,
        optimization_profile: OptimizationProfile | None = None,
        tolerance_profile: ToleranceProfile | None = None,
        constraint_profile: FormulationConstraints | None = None,
        solver_profile: SolverProfile | None = None,
        geometry: str | None = None,
        instrument_model: str | None = None,
        measurement_mode: str | None = None,
        k1: float | None = None,
        k2: float | None = None,
        observer: str | None = None,
        reference_illuminant: str | None = None,
        test_illuminants: tuple[str, ...] | None = None,
        forward_model: str | None = None,
        film_thickness_um: float | None = None,
        substrate_rg: float | None = None,
        max_total_load: float | None = None,
        max_pastes: int | None = None,
        min_total_load: float | None = None,
        min_dispense_threshold: float | None = None,
        enable_multistart: bool | None = None,
        num_starts: int | None = None,
        provenance: dict | None = None,
    ) -> "ExecutionContext":
        """
        Factory method constructing a fully resolved, authoritative ExecutionContext.
        Seamlessly resolves instrument geometries, optical models, constraints, and solver flags.
        """
        # 1. Resolve science profile
        sci = science_profile or DEFAULT_SCIENCE_PROFILE
        sci_kwargs = {}
        if k1 is not None:
            sci_kwargs["saunderson_k1"] = float(k1)
        if k2 is not None:
            sci_kwargs["saunderson_k2"] = float(k2)
        if observer is not None:
            sci_kwargs["observer"] = observer
        if reference_illuminant is not None:
            sci_kwargs["reference_illuminant"] = reference_illuminant
        if test_illuminants is not None:
            sci_kwargs["test_illuminants"] = tuple(test_illuminants)
        if film_thickness_um is not None:
            sci_kwargs["default_film_thickness_um"] = float(film_thickness_um)
        if substrate_rg is not None:
            sci_kwargs["substrate_white_rg"] = float(substrate_rg)
        if sci_kwargs:
            sci = replace(sci, **sci_kwargs)

        # 2. Resolve measurement context (Instrument & Geometry awareness)
        if measurement_context is not None:
            meas = measurement_context
        elif instrument_model == "CHNSpec DS-36D" or geometry == "d/8°" or instrument_model is None:
            meas = MEASUREMENT_DS36D_D8_SCI if measurement_mode != "SCE" else MEASUREMENT_DS36D_D8_SCE
        else:
            meas = MEASUREMENT_GENERIC_45_0

        meas_kwargs = {}
        if geometry is not None:
            meas_kwargs["geometry"] = geometry
            if geometry == "45°/0°":
                meas_kwargs["specular_included"] = False
                meas_kwargs["measurement_mode"] = "SPEX"
        if instrument_model is not None:
            meas_kwargs["instrument_model"] = instrument_model
        if measurement_mode is not None:
            meas_kwargs["measurement_mode"] = measurement_mode
            if measurement_mode in ("SCI", "SCI_SCE"):
                meas_kwargs["specular_included"] = True
            elif measurement_mode in ("SCE", "SPEX"):
                meas_kwargs["specular_included"] = False
        meas_kwargs["illuminant"] = sci.reference_illuminant
        meas_kwargs["observer"] = sci.observer
        meas = replace(meas, **meas_kwargs)

        # 3. Resolve optimization profile
        opt = optimization_profile or PROFILE_COLOR_MATCH
        opt_kwargs = {}
        if forward_model is not None:
            opt_kwargs["forward_model"] = forward_model
        if film_thickness_um is not None:
            opt_kwargs["film_thickness_um"] = float(film_thickness_um)
        if substrate_rg is not None:
            opt_kwargs["substrate_rg"] = float(substrate_rg)
        if opt_kwargs:
            opt = replace(opt, **opt_kwargs)

        # 4. Resolve tolerance profile
        tol = tolerance_profile or DEFAULT_TOLERANCE_PROFILE

        # 5. Resolve constraints profile
        if constraint_profile is not None:
            const = copy.deepcopy(constraint_profile)
            if max_pastes is not None and const.max_pastes is None:
                const.max_pastes = int(max_pastes)
        else:
            const = FormulationConstraints()
            if max_total_load is not None:
                const.max_total_load = float(max_total_load)
            if max_pastes is not None:
                const.max_pastes = int(max_pastes)
            if min_total_load is not None:
                const.min_total_load = float(min_total_load)
            if min_dispense_threshold is not None:
                const.min_dispense_threshold = float(min_dispense_threshold)

        # 6. Resolve solver profile
        solv = solver_profile or SolverProfile()
        solv_kwargs = {}
        if enable_multistart is not None:
            solv_kwargs["enable_multistart"] = bool(enable_multistart)
        if num_starts is not None:
            solv_kwargs["num_starts"] = int(num_starts)
        if solv_kwargs:
            solv = replace(solv, **solv_kwargs)

        # 7. Provenance metadata
        prov = provenance.copy() if provenance else {}
        if "engine_version" not in prov:
            prov["engine_version"] = ENGINE_VERSION
        if "created_at" not in prov:
            prov["created_at"] = datetime.now(timezone.utc).isoformat()

        return cls(
            science_profile=sci,
            measurement_context=meas,
            optimization_profile=opt,
            tolerance_profile=tol,
            constraint_profile=const,
            solver_profile=solv,
            provenance=prov
        )

    def to_dict(self) -> dict:
        return {
            "science_profile": {
                "name": self.science_profile.name,
                "observer": self.science_profile.observer,
                "reference_illuminant": self.science_profile.reference_illuminant,
                "test_illuminants": list(self.science_profile.test_illuminants),
                "saunderson_k1": self.science_profile.saunderson_k1,
                "saunderson_k2": self.science_profile.saunderson_k2,
                "default_film_thickness_um": self.science_profile.default_film_thickness_um,
                "substrate_black_rg": self.science_profile.substrate_black_rg,
                "substrate_white_rg": self.science_profile.substrate_white_rg,
            },
            "measurement_context": {
                "instrument_model": self.measurement_context.instrument_model,
                "geometry": self.measurement_context.geometry,
                "measurement_mode": self.measurement_context.measurement_mode,
                "specular_included": self.measurement_context.specular_included,
                "illuminant": self.measurement_context.illuminant,
                "observer": self.measurement_context.observer,
            },
            "optimization_profile": {
                "id": self.optimization_profile.id,
                "name": self.optimization_profile.name,
                "forward_model": self.optimization_profile.forward_model,
                "film_thickness_um": self.optimization_profile.film_thickness_um,
                "substrate_rg": self.optimization_profile.substrate_rg,
            },
            "tolerance_profile": {
                "id": self.tolerance_profile.id,
                "name": self.tolerance_profile.name,
            },
            "constraint_profile": {
                "max_total_load": self.constraint_profile.max_total_load,
                "min_total_load": self.constraint_profile.min_total_load,
                "max_pastes": self.constraint_profile.max_pastes,
                "min_dispense_threshold": self.constraint_profile.min_dispense_threshold,
            },
            "solver_profile": {
                "name": self.solver_profile.name,
                "max_iterations": self.solver_profile.max_iterations,
                "enable_multistart": self.solver_profile.enable_multistart,
                "num_starts": self.solver_profile.num_starts,
            },
            "provenance": self.provenance
        }
