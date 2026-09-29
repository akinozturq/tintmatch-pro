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
from scipy.optimize import minimize


class InfeasibleConstraintSet(ValueError):
    """Raised when formulation constraints are mutually contradictory or impossible to satisfy."""
    pass


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
    max_pastes: Optional[int] = None      # Maximum allowed active pastes in final recipe


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
        concentrations: np.ndarray | List[float],
        pigment_keys: List[str],
        max_pastes: Optional[int] = None,
        check_dispense: bool = True,
        check_max_pastes: bool = True
    ) -> Dict[str, Any]:
        """
        Computes remaining capacity (slack) and feasibility across all configured constraints,
        including max_pastes limit and minimum dispenser valve thresholding.
        Slack >= 0 means within constraint. Slack < 0 means violation.
        """
        concs = np.asarray(concentrations, dtype=float)
        total_load = float(np.sum(concs))
        max_slack = float(self.constraints.max_total_load - total_load)

        # Min total load check
        min_load = self.constraints.min_total_load
        min_slack = float(total_load - min_load) if min_load > 0.0 else 0.0
        min_violated = (min_load > 0.0 and min_slack < -1e-5)

        # Simplex sum check
        simplex_slack = float(100.0 - total_load)
        simplex_violated = (self.constraints.enforce_simplex_sum and simplex_slack < -1e-5)

        # Individual bounds check
        individual_slacks = {}
        individual_violated = False
        for idx, key in enumerate(pigment_keys):
            if idx < len(concs):
                val = float(concs[idx])
                if key in self.constraints.individual_bounds:
                    lb, ub = self.constraints.individual_bounds[key]
                    lb_slack = float(val - lb)
                    ub_slack = float(ub - val)
                    is_viol = lb_slack < -1e-5 or ub_slack < -1e-5
                    if is_viol:
                        individual_violated = True
                    individual_slacks[key] = {
                        "value": round(val, 4),
                        "lb": round(float(lb), 4),
                        "ub": round(float(ub), 4),
                        "lb_slack": round(lb_slack, 4),
                        "ub_slack": round(ub_slack, 4),
                        "violated": is_viol
                    }

        group_slacks = {}
        for group_name, group_limit in self.constraints.group_bounds.items():
            member_ids = set(self.constraints.pigment_groups.get(group_name, []))
            member_indices = [i for i, key in enumerate(pigment_keys) if key in member_ids and i < len(concs)]
            if member_indices:
                grp_sum = float(np.sum(concs[member_indices]))
                group_slacks[group_name] = {
                    "used": round(grp_sum, 4),
                    "limit": round(float(group_limit), 4),
                    "slack": round(float(group_limit - grp_sum), 4),
                    "violated": grp_sum > group_limit + 1e-5
                }

        # Max pastes check: active count exceeds allowed max_pastes limit
        eff_max_pastes = (max_pastes if max_pastes is not None else self.constraints.max_pastes) if check_max_pastes else None
        active_count = int(np.sum(concs > 1e-5)) if len(concs) > 0 else 0
        max_pastes_violated = bool(eff_max_pastes is not None and active_count > eff_max_pastes)

        # Minimum dispense threshold check
        threshold = self.constraints.min_dispense_threshold
        dispense_violated = False
        sub_threshold_pigments: Dict[str, float] = {}
        if check_dispense and threshold > 0.0:
            for idx, c in enumerate(concs):
                if 1e-5 < c < threshold - 1e-5:
                    dispense_violated = True
                    key = pigment_keys[idx] if idx < len(pigment_keys) else f"Pigment #{idx}"
                    sub_threshold_pigments[key] = round(float(c), 4)

        is_feasible = bool(
            max_slack >= -1e-5
            and not min_violated
            and not simplex_violated
            and not individual_violated
            and not dispense_violated
            and not max_pastes_violated
            and all(not g["violated"] for g in group_slacks.values())
            and (bool(np.all(concs >= -1e-5)) if len(concs) > 0 else True)
        )

        return {
            "total_load": round(total_load, 4),
            "max_total_load": round(float(self.constraints.max_total_load), 4),
            "total_slack": round(max_slack, 4),
            "min_total_load": round(float(min_load), 4) if min_load > 0.0 else None,
            "min_total_slack": round(min_slack, 4) if min_load > 0.0 else None,
            "individual_slacks": individual_slacks,
            "group_slacks": group_slacks,
            "active_pastes_count": active_count,
            "max_pastes": eff_max_pastes,
            "max_pastes_violated": max_pastes_violated,
            "min_dispense_threshold": round(float(threshold), 4) if threshold > 0.0 else None,
            "dispense_violated": dispense_violated,
            "sub_threshold_pigments": sub_threshold_pigments,
            "is_feasible": is_feasible
        }

    def validate_solution(
        self,
        concentrations: np.ndarray | List[float],
        pigment_keys: List[str],
        max_pastes: Optional[int] = None,
        check_dispense: bool = True,
        check_max_pastes: bool = True
    ) -> Dict[str, Any]:
        """
        Authoritative validation of an optimization recipe vector against all physical,
        chemical, and dispensing constraints:
        - Non-negativity
        - Maximum total colorant load
        - Minimum total colorant load
        - Chemical group bounds
        - Individual pigment bounds
        - Simplex sum limit
        - Maximum allowed colorant pastes count
        - Minimum gravimetric dispenser threshold
        """
        concs = np.asarray(concentrations, dtype=float)
        slack_info = self.evaluate_constraint_slack(
            concs, pigment_keys, max_pastes=max_pastes, check_dispense=check_dispense, check_max_pastes=check_max_pastes
        )
        violations: List[str] = []

        # 1. Non-negativity
        negative_indices = [i for i, c in enumerate(concs) if c < -1e-5]
        if negative_indices:
            violations.append(f"Unphysical negative concentrations at indices: {negative_indices}")

        # 2. Maximum total load
        if slack_info["total_slack"] < -1e-5:
            violations.append(
                f"Total colorant load ({slack_info['total_load']}%) exceeds max limit ({slack_info['max_total_load']}%) "
                f"by {-slack_info['total_slack']:.4f}%"
            )

        # 3. Minimum total load
        if slack_info.get("min_total_load") is not None and slack_info.get("min_total_slack", 0.0) < -1e-5:
            violations.append(
                f"Total colorant load ({slack_info['total_load']}%) is below min limit ({slack_info['min_total_load']}%)"
            )

        # 4. Group bounds
        for grp_name, g_info in slack_info["group_slacks"].items():
            if g_info["violated"]:
                violations.append(
                    f"Chemical group '{grp_name}' load ({g_info['used']}%) exceeds limit ({g_info['limit']}%)"
                )

        # 5. Individual bounds
        for key, ind_info in slack_info["individual_slacks"].items():
            if ind_info["violated"]:
                violations.append(
                    f"Pigment '{key}' concentration ({ind_info['value']}%) out of bounds [{ind_info['lb']}%, {ind_info['ub']}%]"
                )

        # 6. Simplex sum
        if self.constraints.enforce_simplex_sum and slack_info["total_load"] > 100.0 + 1e-5:
            violations.append(f"Total formulation load ({slack_info['total_load']}%) exceeds simplex limit (100.0%)")

        # 7. Maximum pastes count
        if slack_info.get("max_pastes_violated"):
            violations.append(
                f"Number of active colorant pastes ({slack_info['active_pastes_count']}) exceeds max_pastes limit ({slack_info['max_pastes']})"
            )

        # 8. Minimum dispense threshold
        if slack_info.get("dispense_violated"):
            for p_key, p_val in slack_info.get("sub_threshold_pigments", {}).items():
                violations.append(
                    f"Colorant '{p_key}' concentration ({p_val}%) is below minimum dispense threshold ({slack_info['min_dispense_threshold']}%)"
                )

        return {
            "is_valid": len(violations) == 0,
            "violations": violations,
            "slack_info": slack_info
        }

    def project_to_feasible(
        self,
        concentrations: np.ndarray | List[float],
        pigment_keys: List[str]
    ) -> np.ndarray:
        """
        Projects an arbitrary concentration vector onto the feasible set defined by
        individual bounds, group bounds, simplex sum, and [min_total_load, max_total_load]
        via Euclidean Quadratic Programming (QP): min 0.5 * ||x - x0||^2 subject to constraints.

        Raises InfeasibleConstraintSet if the constraint set is mutually contradictory or empty.
        """
        concs = np.maximum(np.asarray(concentrations, dtype=float, copy=True), 0.0)
        n = len(concs)
        if n == 0:
            if self.constraints.min_total_load > 1e-6:
                raise InfeasibleConstraintSet(
                    f"Empty pigment vector cannot satisfy min_total_load ({self.constraints.min_total_load}%)."
                )
            return np.array([], dtype=float)

        # 0. Fast-path: Check if already strictly valid (continuous feasibility)
        val_check = self.validate_solution(concs, pigment_keys, max_pastes=None, check_dispense=False, check_max_pastes=False)
        if val_check["is_valid"]:
            return concs

        # 1. Structural infeasibility pre-checks
        bounds = self.build_scipy_bounds(pigment_keys, default_upper_bound=self.constraints.max_total_load)
        if len(bounds) < n:
            bounds.extend([(0.0, float(self.constraints.max_total_load))] * (n - len(bounds)))
        active_bounds = bounds[:n]

        sum_lb = sum(b[0] for b in active_bounds)
        sum_ub = sum(b[1] for b in active_bounds)

        if self.constraints.min_total_load > self.constraints.max_total_load + 1e-6:
            raise InfeasibleConstraintSet(
                f"Contradictory total load bounds: min_total_load ({self.constraints.min_total_load}%) > "
                f"max_total_load ({self.constraints.max_total_load}%)."
            )

        if self.constraints.min_total_load > sum_ub + 1e-6:
            raise InfeasibleConstraintSet(
                f"Unsatisfiable constraints: min_total_load ({self.constraints.min_total_load}%) exceeds sum of "
                f"individual upper bounds ({sum_ub:.4f}%)."
            )

        if self.constraints.max_total_load < sum_lb - 1e-6:
            raise InfeasibleConstraintSet(
                f"Unsatisfiable constraints: max_total_load ({self.constraints.max_total_load}%) is below sum of "
                f"individual lower bounds ({sum_lb:.4f}%)."
            )

        for grp_name, grp_limit in self.constraints.group_bounds.items():
            member_ids = set(self.constraints.pigment_groups.get(grp_name, []))
            grp_indices = [i for i, key in enumerate(pigment_keys) if key in member_ids and i < n]
            grp_lb = sum(active_bounds[i][0] for i in grp_indices)
            if grp_lb > grp_limit + 1e-6:
                raise InfeasibleConstraintSet(
                    f"Unsatisfiable constraints: chemical group '{grp_name}' limit ({grp_limit}%) is below "
                    f"sum of member lower bounds ({grp_lb:.4f}%)."
                )

        # 2. Build QP objective and gradient
        x0_target = concs.copy()

        def qp_objective(x: np.ndarray) -> float:
            diff = x - x0_target
            return 0.5 * float(np.dot(diff, diff))

        def qp_gradient(x: np.ndarray) -> np.ndarray:
            return x - x0_target

        scipy_constraints = self.build_scipy_constraints(pigment_keys)

        # 3. Candidate starting points for SLSQP
        # Start A: Clamped x0
        x_init_a = np.array([
            min(max(x0_target[i], active_bounds[i][0]), active_bounds[i][1])
            for i in range(n)
        ], dtype=float)

        tot_a = float(np.sum(x_init_a))
        if tot_a > self.constraints.max_total_load + 1e-6 and tot_a > 1e-6:
            x_init_a = np.clip(x_init_a * (self.constraints.max_total_load / tot_a), [b[0] for b in active_bounds], [b[1] for b in active_bounds])
        elif tot_a < self.constraints.min_total_load - 1e-6 and self.constraints.min_total_load > 0.0:
            deficit = self.constraints.min_total_load - tot_a
            room = np.array([active_bounds[i][1] - x_init_a[i] for i in range(n)], dtype=float)
            room_tot = float(np.sum(room))
            if room_tot > 1e-6:
                x_init_a = np.clip(x_init_a + (deficit * room / room_tot), [b[0] for b in active_bounds], [b[1] for b in active_bounds])

        candidate_starts = [x_init_a]

        # Start B: Centroid / midpoint between bounds
        target_sum = 0.5 * (
            max(self.constraints.min_total_load, sum_lb) +
            min(self.constraints.max_total_load, sum_ub)
        )
        x_mid = np.array([0.5 * (b[0] + min(b[1], self.constraints.max_total_load)) for b in active_bounds], dtype=float)
        tot_mid = float(np.sum(x_mid))
        if tot_mid > 1e-6:
            x_mid = np.clip(x_mid * (target_sum / tot_mid), [b[0] for b in active_bounds], [b[1] for b in active_bounds])
        candidate_starts.append(x_mid)

        best_projected = None
        best_dist = float("inf")

        for st in candidate_starts:
            res = minimize(
                qp_objective,
                st,
                jac=qp_gradient,
                method="SLSQP",
                bounds=active_bounds,
                constraints=scipy_constraints,
                options={"maxiter": 250, "ftol": 1e-7}
            )

            cand = np.clip(res.x, [b[0] for b in active_bounds], [b[1] for b in active_bounds])
            tot_cand = float(np.sum(cand))
            if tot_cand > self.constraints.max_total_load and tot_cand <= self.constraints.max_total_load + 1e-4:
                cand *= (self.constraints.max_total_load / tot_cand)
            elif tot_cand < self.constraints.min_total_load and tot_cand >= self.constraints.min_total_load - 1e-4 and self.constraints.min_total_load > 0.0:
                cand *= (self.constraints.min_total_load / tot_cand)

            val_res = self.validate_solution(cand, pigment_keys, max_pastes=None, check_dispense=False, check_max_pastes=False)
            if val_res["is_valid"]:
                dist = qp_objective(cand)
                if dist < best_dist:
                    best_dist = dist
                    best_projected = cand

        if best_projected is not None:
            return best_projected

        # If neither start resulted in a valid vector, evaluate violations and raise
        final_val = self.validate_solution(cand, pigment_keys, max_pastes=None, check_dispense=False, check_max_pastes=False)
        raise InfeasibleConstraintSet(
            f"Cannot project vector to feasible domain: constraints are mutually contradictory or unsatisfiable. "
            f"Violations: {final_val['violations']}"
        )

