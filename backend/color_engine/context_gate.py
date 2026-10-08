"""
Context Gate Module
===================
Authoritative gate validating optical geometry, measurement mode, optical system,
and characterization quality status before color matching optimization.
"""
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Tuple


@dataclass(frozen=True)
class FormulationContext:
    geometry: str                          # e.g. '45°/0°', 'd/8°'
    measurement_mode: str = "SCI"          # e.g. 'SCI', 'SCE', 'SPEX'
    base_id: int = 1
    optical_system: str = "bootstrap_v1"
    illuminant: str = "D65"
    observer: str = "10"
    allow_simulation: bool = False


def select_eligible_pastes(
    context: FormulationContext,
    paste_rows: List[Dict[str, Any]],
    base_row: Optional[Dict[str, Any]] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Evaluates candidate pastes against optical context and quality constraints.

    Returns:
        (eligible_pastes, excluded_pastes)
        where excluded_pastes contains each rejected paste augmented with 'exclusion_reason'.
    """
    eligible = []
    excluded = []

    target_geo = context.geometry.strip().lower()
    target_mode = context.measurement_mode.strip().upper()
    target_opt_sys = context.optical_system.strip().lower()

    for p in paste_rows:
        paste_dict = dict(p)
        p_geo = (paste_dict.get("geometry") or "").strip().lower()
        p_mode = (paste_dict.get("measurement_mode") or "SCI").strip().upper()
        p_opt_sys = (paste_dict.get("optical_system") or "bootstrap_v1").strip().lower()
        p_status = (paste_dict.get("status") or ("ACTIVE" if paste_dict.get("passed_validation", 1) else "REJECTED")).strip().upper()
        p_passed_val = bool(paste_dict.get("passed_validation", 1))

        reason = None

        # 1. Quality validation check (auto-reject failed characterizations)
        if p_status == "REJECTED" or not p_passed_val:
            reason = "REJECTED_QUALITY_GATE: Paste failed characterization validation"
        # 2. Geometry isolation
        elif p_geo != target_geo:
            reason = f"GEOMETRY_MISMATCH: paste '{p_geo}' != target '{target_geo}'"
        # 3. Measurement mode isolation (e.g. SCI vs SCE)
        elif p_mode != target_mode:
            reason = f"MODE_MISMATCH: paste '{p_mode}' != target '{target_mode}'"
        # 4. Optical system bootstrap isolation
        elif p_opt_sys != target_opt_sys:
            reason = f"OPTICAL_SYSTEM_MISMATCH: paste '{p_opt_sys}' != context '{target_opt_sys}'"
        # 5. Simulation flag check
        elif p_status == "SIMULATION" and not context.allow_simulation:
            reason = "SIMULATION_PASTE_NOT_PERMITTED_IN_PRODUCTION"

        if reason:
            paste_dict["exclusion_reason"] = reason
            excluded.append(paste_dict)
        else:
            eligible.append(paste_dict)

    return eligible, excluded
