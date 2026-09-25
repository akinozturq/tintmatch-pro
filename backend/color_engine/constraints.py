"""
TintMatch PRO - Formulation Constraint Engine 2.0
=================================================
Manages physical, dispensing, chemical, and economic constraints for CCM formulation:
1. Total pigment paste load limits (sum(c_i) <= max_total_load)
2. Minimum total load limits
3. Individual pigment min/max bounds
4. Chemical group bounds (e.g. UV resistance limits on organic pigments)
5. Minimum dispenser thresholding (e.g. gravimetric valve dispensing limit: 0.02%)
6. Constraint slack and feasibility evaluation
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import numpy as np


@dataclass
class FormulationConstraints:
    """Configuration dataclass for formulation optimization boundaries."""
    max_total_load: float = 12.0          # Maximum total colorant load (wt%)
    min_total_load: float = 0.0           # Minimum total colorant load (wt%)
    individual_bounds: Dict[str, Tuple[float, float]] = field(default_factory=dict)
    group_bounds: Dict[str, float] = field(default_factory=dict)       # group_name -> max_sum
    pigment_groups: Dict[str, List[str]] = field(default_factory=dict) # group_name -> [pigment_ids]
    min_dispense_threshold: float = 0.0   # Default 0.0 (no pruning unless explicitly set)
    enforce_simplex_sum: bool = False     # If True, enforces sum(c) <= 100.0


class ConstraintEngine:
    """
    Translates FormulationConstraints into SciPy SLSQP constraint dictionaries,
    variable bounds, and provides post-processing and slack diagnostics.
    """

    def __init__(self, constraints: Optional[FormulationConstraints] = None):
        self.constraints = constraints or FormulationConstraints()

    def build_scipy_bounds(
        self,
        pigment_keys: List[str],
        default_upper_bound: float = 10.0
    ) -> List[Tuple[float, float]]:
        """
        Builds variable lower and upper bounds for each pigment.
        Returns list of (lower, upper) tuples for scipy.optimize.minimize.
        """
        bounds = []
        for key in pigment_keys:
            if key in self.constraints.individual_bounds:
                lb, ub = self.constraints.individual_bounds[key]
                bounds.append((max(0.0, float(lb)), max(0.0, float(ub))))
            else:
                bounds.append((0.0, float(default_upper_bound)))
        return bounds

    def build_scipy_constraints(self, pigment_keys: List[str]) -> List[Dict[str, Any]]:
        """
        Builds inequality constraint dictionaries (g(c) >= 0) for SLSQP.
        """
        scipy_constraints: List[Dict[str, Any]] = []

        # 1. Total Load Constraint: max_total_load - sum(c_i) >= 0
        max_load = self.constraints.max_total_load

        def total_load_upper(c: np.ndarray) -> float:
            return float(max_load - np.sum(c))

        scipy_constraints.append({
            "type": "ineq",
            "fun": total_load_upper
        })

        # 2. Min Total Load Constraint (if specified): sum(c_i) - min_total_load >= 0
        min_load = self.constraints.min_total_load
        if min_load > 0.0:
            def total_load_lower(c: np.ndarray) -> float:
                return float(np.sum(c) - min_load)

            scipy_constraints.append({
                "type": "ineq",
                "fun": total_load_lower
            })

        # 3. Simplex Sum (sum(c_i) <= 100.0)
        if self.constraints.enforce_simplex_sum:
            def simplex_bound(c: np.ndarray) -> float:
                return float(100.0 - np.sum(c))

            scipy_constraints.append({
                "type": "ineq",
                "fun": simplex_bound
            })

        # 4. Group Bounds (e.g. organic UV stability limit)
        for group_name, group_limit in self.constraints.group_bounds.items():
            member_ids = set(self.constraints.pigment_groups.get(group_name, []))
            member_indices = [i for i, key in enumerate(pigment_keys) if key in member_ids]

            if member_indices:
                # Capture indices and limit in closure
                def make_group_constraint(indices: List[int], limit: float):
                    return lambda c: float(limit - np.sum(c[indices]))

                scipy_constraints.append({
                    "type": "ineq",
                    "fun": make_group_constraint(member_indices, float(group_limit))
                })

        return scipy_constraints

    def post_process_solution(
        self,
        concentrations: np.ndarray,
        pigment_keys: List[str]
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Prunes sub-threshold pigment amounts that fall below minimum dispense limits (e.g. 0.02%).
        Returns cleaned concentrations array and list of audit warnings/notes.
        """
        processed = np.array(concentrations, dtype=float, copy=True)
        # Ensure non-negativity
        processed = np.maximum(processed, 0.0)
        warnings: List[str] = []

        threshold = self.constraints.min_dispense_threshold
        if threshold > 0.0:
            for idx, c in enumerate(processed):
                if 0.0 < c < threshold:
                    key = pigment_keys[idx] if idx < len(pigment_keys) else f"Pigment #{idx}"
                    warnings.append(
                        f"Pigment '{key}' concentration ({c:.4f}%) was below minimum dispense "
                        f"threshold ({threshold:.4f}%) and was pruned to 0.0000%."
                    )
                    processed[idx] = 0.0

        return processed, warnings

    def evaluate_constraint_slack(
        self,
        concentrations: np.ndarray,
        pigment_keys: List[str]
    ) -> Dict[str, Any]:
        """
        Computes remaining capacity (slack) and feasibility across all configured constraints.
        Slack > 0 means within constraint. Slack < 0 means violation.
        """
        concs = np.asarray(concentrations, dtype=float)
        total_load = float(np.sum(concs))
        total_slack = float(self.constraints.max_total_load - total_load)

        group_slacks = {}
        for group_name, group_limit in self.constraints.group_bounds.items():
            member_ids = set(self.constraints.pigment_groups.get(group_name, []))
            member_indices = [i for i, key in enumerate(pigment_keys) if key in member_ids]
            if member_indices:
                grp_sum = float(np.sum(concs[member_indices]))
                group_slacks[group_name] = {
                    "used": round(grp_sum, 4),
                    "limit": round(float(group_limit), 4),
                    "slack": round(float(group_limit - grp_sum), 4),
                    "violated": grp_sum > group_limit + 1e-5
                }

        is_feasible = total_slack >= -1e-5 and all(
            not g["violated"] for g in group_slacks.values()
        )

        return {
            "total_load": round(total_load, 4),
            "max_total_load": round(float(self.constraints.max_total_load), 4),
            "total_slack": round(total_slack, 4),
            "group_slacks": group_slacks,
            "is_feasible": is_feasible
        }
