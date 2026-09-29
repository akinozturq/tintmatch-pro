"""
TintMatch PRO — Release Candidate Screening Recall & Accuracy Audit Harness
=============================================================================
Mathematically quantifies candidate screening recall and colorimetric fidelity
against the unrestricted full-library reference solution across 5 critical industrial regimes:
1. Lightening Targets (high scattering demand, R_target > R_base)
2. Dark / High-Chroma Targets (high positive absorption demand)
3. Neutral / Gray Targets (multi-primary chromatic cancellation)
4. Ultra-Pastel Targets (sub-0.1% micro-dispense tinting)
5. Metameric Targets (cross-illuminant D65/A/F11 stability)

Metrics Reported:
- Candidate Recall (% of optimal pigments present in screened candidate pool)
- Selected-Pigment Recall (Jaccard similarity of final recipe pastes)
- Worst Delta E00 Degradation (max(0, Delta E_screened - Delta E_full))
- Mean Delta E00 Degradation
- Full-Space vs Screened Speedup Ratio
"""

import time
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple
import numpy as np

from ..constants import N_WAVELENGTHS
from ..formulation import match_color_ccm, predict_recipe
from ..benchmarks.benchmark_slsqp_library import solve_full_library_slsqp
from ...database.db import get_db_connection


def categorize_target(target_r: List[float] | np.ndarray, base_r: np.ndarray, meta: Dict[str, Any] | None = None) -> str:
    """
    Classifies a colorimetric target into one of the 5 industrial validation categories:
    1. Lightening (R_target > R_base, scattering demand)
    2. Dark (low reflectance, high positive absorption)
    3. Neutral (flat spectrum, low chroma variance)
    4. Ultra-Pastel (high reflectance, micro-dispense tinting)
    5. Metameric (multi-illuminant metameric breakdown)
    """
    t_r = np.asarray(target_r, dtype=float)
    b_r = np.asarray(base_r, dtype=float)
    meta = meta or {}

    target_id = meta.get("id", "").upper()
    name = meta.get("name", "").upper()
    target_type = str(meta.get("type", "")).upper()

    # Explicit metadata classification
    if "METAMER" in target_id or "METAMER" in name or target_type == "METAMER":
        return "Metameric"

    diff_r = t_r - b_r
    mean_target = float(np.mean(t_r))

    # 1. Lightening: target reflectance notably exceeds base reflectance
    if np.any(diff_r > 0.05) or np.mean(diff_r) > 0.02 or "LIGHT" in target_id or "LIGHT" in name or target_type == "LIGHTENING":
        return "Lightening"

    # 2. Ultra-Pastel: high overall reflectance (mean_R > 0.50)
    if mean_target > 0.50 or "PASTEL" in target_id or "PASTEL" in name or "FAINT" in target_id or "POWDER" in target_id or "WHISPER" in name:
        return "Ultra-Pastel"

    # 3. Dark: low overall reflectance (mean_R < 0.20)
    if mean_target < 0.20 or "BLACK" in name or "DARK" in name or "OCEAN" in name or "JET" in target_id or "ESPRESSO" in name:
        return "Dark"

    # 4. Neutral / Gray: low spectral variance (flat curve)
    chroma_var = float(np.std(t_r))
    if chroma_var < 0.04 or "GREY" in name or "GRAY" in name or "SLATE" in name or "CHARCOAL" in name:
        return "Neutral"

    return "Dark" if mean_target < 0.30 else "Neutral"


def run_candidate_recall_audit(
    targets: List[Dict[str, Any]],
    base_k: np.ndarray,
    base_s: np.ndarray,
    available_pastes: List[Dict[str, Any]],
    max_pastes: int = 4,
    max_total_load: float = 12.0
) -> Dict[str, Any]:
    """
    Executes head-to-head evaluation between Full-Library Reference and Screened Production Solutions.
    """
    default_base_ks = base_k / np.maximum(base_s, 1e-6)
    default_base_r = (1.0 + default_base_ks - np.sqrt(np.maximum(default_base_ks * (default_base_ks + 2.0), 0.0)))

    results = []
    category_buckets: Dict[str, List[Dict[str, Any]]] = {
        "Lightening": [],
        "Dark": [],
        "Neutral": [],
        "Ultra-Pastel": [],
        "Metameric": []
    }

    t0_all = time.perf_counter()

    for item in targets:
        target_r = item["target_reflectance"]
        cur_base_k = np.asarray(item["base_k"], dtype=float) if "base_k" in item else base_k
        cur_base_s = np.asarray(item["base_s"], dtype=float) if "base_s" in item else base_s
        cur_base_ks = cur_base_k / np.maximum(cur_base_s, 1e-6)
        cur_base_r = (1.0 + cur_base_ks - np.sqrt(np.maximum(cur_base_ks * (cur_base_ks + 2.0), 0.0)))
        cat = categorize_target(target_r, cur_base_r, item)

        # 1. Full-Library Reference Solve
        t_ref0 = time.perf_counter()
        full_res = solve_full_library_slsqp(
            target_reflectance=target_r,
            base_k=cur_base_k,
            base_s=cur_base_s,
            available_pastes=available_pastes,
            max_pastes=max_pastes,
            max_total_load=max_total_load
        )
        t_ref_ms = (time.perf_counter() - t_ref0) * 1000.0

        # 2. Screened Production Solve
        t_scr0 = time.perf_counter()
        screened_res = match_color_ccm(
            target_reflectance=target_r,
            base_k=cur_base_k,
            base_s=cur_base_s,
            available_pastes=available_pastes,
            max_pastes=max_pastes,
            max_total_load=max_total_load
        )
        t_scr_ms = (time.perf_counter() - t_scr0) * 1000.0

        screened_rec = screened_res["recipes"]["recipe_a"]
        screened_cands = set(screened_res.get("screened_candidate_ids", []))
        full_chosen = set(full_res.get("selected_paste_ids", []))
        screened_chosen = set(p["id"] for p in screened_rec.get("matched_pastes", []))

        # Metric 1: Candidate Recall (did screened pool contain all reference colorants?)
        if full_chosen:
            recall_ratio = len(full_chosen.intersection(screened_cands)) / len(full_chosen)
            full_contained = full_chosen.issubset(screened_cands)
        else:
            recall_ratio = 1.0
            full_contained = True

        # Metric 2: Selected Pigment Agreement (Jaccard similarity)
        union_chosen = full_chosen.union(screened_chosen)
        jaccard = len(full_chosen.intersection(screened_chosen)) / max(len(union_chosen), 1)

        # Metric 3: Delta E Degradation
        de_full = full_res["delta_e00"]
        de_screened = screened_rec["delta_e00"]
        de_degradation = max(0.0, round(float(de_screened - de_full), 4))

        record = {
            "id": item.get("id", "TARGET"),
            "name": item.get("name", "Unnamed"),
            "category": cat,
            "full_chosen": list(full_chosen),
            "screened_chosen": list(screened_chosen),
            "screened_pool": list(screened_cands),
            "candidate_recall": recall_ratio,
            "candidate_full_contained": full_contained,
            "selected_jaccard": jaccard,
            "delta_e_full": de_full,
            "delta_e_screened": de_screened,
            "delta_e_degradation": de_degradation,
            "runtime_full_ms": t_ref_ms,
            "runtime_screened_ms": t_scr_ms,
            "speedup": round(t_ref_ms / max(t_scr_ms, 0.1), 2)
        }
        results.append(record)
        category_buckets[cat].append(record)

    total_time_s = time.perf_counter() - t0_all

    # Aggregate Statistics
    overall_recall = float(np.mean([r["candidate_recall"] for r in results])) * 100.0
    overall_contained_pct = float(np.mean([1.0 if r["candidate_full_contained"] else 0.0 for r in results])) * 100.0
    overall_jaccard = float(np.mean([r["selected_jaccard"] for r in results])) * 100.0
    degradations = [r["delta_e_degradation"] for r in results]
    mean_de_degr = float(np.mean(degradations))
    worst_de_degr = float(np.max(degradations)) if degradations else 0.0
    overall_speedup = float(np.mean([r["speedup"] for r in results]))

    # Category Breakdown
    cat_summary = {}
    for cat, items in category_buckets.items():
        if items:
            c_rec = float(np.mean([r["candidate_recall"] for r in items])) * 100.0
            c_jacc = float(np.mean([r["selected_jaccard"] for r in items])) * 100.0
            c_worst = float(np.max([r["delta_e_degradation"] for r in items]))
            c_pass = c_rec >= 95.0 and c_worst <= 0.05
            cat_summary[cat] = {
                "count": len(items),
                "candidate_recall": round(c_rec, 1),
                "selected_recall": round(c_jacc, 1),
                "worst_delta_e_degr": round(c_worst, 4),
                "status": "PASS" if c_pass else "WARN"
            }
        else:
            cat_summary[cat] = {
                "count": 0,
                "candidate_recall": 100.0,
                "selected_recall": 100.0,
                "worst_delta_e_degr": 0.0,
                "status": "N/A"
            }

    return {
        "summary": {
            "total_targets": len(results),
            "candidate_recall_pct": round(overall_recall, 1),
            "candidate_fully_contained_pct": round(overall_contained_pct, 1),
            "selected_jaccard_pct": round(overall_jaccard, 1),
            "mean_delta_e_degradation": round(mean_de_degr, 4),
            "worst_delta_e_degradation": round(worst_de_degr, 4),
            "average_speedup": round(overall_speedup, 2),
            "audit_runtime_seconds": round(total_time_s, 2),
            "max_pastes": max_pastes
        },
        "category_breakdown": cat_summary,
        "details": results
    }


def format_recall_audit_report(audit_result: Dict[str, Any]) -> str:
    """
    Renders an industrial release quality report for candidate screening recall.
    """
    summary = audit_result["summary"]
    cats = audit_result["category_breakdown"]

    lines = [
        "=" * 88,
        "         TINTMATCH PRO — RELEASE CANDIDATE RECALL & SPECTRAL ACCURACY AUDIT",
        "=" * 88,
        f"Evaluated Targets: {summary['total_targets']} Industrial Target Profiles | Max Pastes Limit: K={summary['max_pastes']}",
        f"Benchmark Runtime: {summary['audit_runtime_seconds']}s | Average Acceleration: {summary['average_speedup']}x",
        "-" * 88,
        "Summary Metrics across Full Industrial Color Space:",
        f"  * Candidate Recall @ K={summary['max_pastes']}       : {summary['candidate_recall_pct']}% (Full Contained: {summary['candidate_fully_contained_pct']}%)",
        f"  * Selected Pigment Jaccard : {summary['selected_jaccard_pct']}%",
        f"  * Mean Delta E00 Degradation: {summary['mean_delta_e_degradation']:.4f} dE00",
        f"  * Worst Delta E00 Degradation: {summary['worst_delta_e_degradation']:.4f} dE00  (Industrial Tolerance: <= 0.050)",
        "-" * 88,
        f"{'Category':<16} | {'Count':<6} | {'Candidate Recall':<18} | {'Selected Jaccard':<18} | {'Worst dE00':<12} | {'Status'}",
        "-" * 88,
    ]

    for cat_name, data in cats.items():
        lines.append(
            f"{cat_name:<16} | {data['count']:<6} | {data['candidate_recall']:>15.1f}% | {data['selected_recall']:>15.1f}% | {data['worst_delta_e_degr']:>10.4f} | {data['status']}"
        )

    lines.append("=" * 88)
    return "\n".join(lines)


if __name__ == "__main__":
    conn = get_db_connection()
    base1_row = conn.execute("SELECT * FROM bases WHERE id = 1").fetchone()
    base4_row = conn.execute("SELECT * FROM bases WHERE id = 4").fetchone()
    # Filter distinct industrial colorants (excluding synthetic characterization artifacts)
    paste_rows = [
        r for r in conn.execute("SELECT * FROM pastes").fetchall()
        if not r["code"].startswith("PB15-TEST") and not r["code"].startswith("PB15-T") and not r["code"].startswith("PROV-")
    ]
    conn.close()

    base_k = np.array(json.loads(base1_row["absorption_k"]))
    base_s = np.array(json.loads(base1_row["scattering_s"]))

    base4_k = np.array(json.loads(base4_row["absorption_k"])) if base4_row else base_k
    base4_s = np.array(json.loads(base4_row["scattering_s"])) if base4_row else base_s

    pastes = [
        {
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "hex": r["color_hex"],
            "unit_k": json.loads(r["unit_k"]),
            "unit_s": json.loads(r["unit_s"])
        }
        for r in paste_rows
    ]

    # Ensure white scattering colorant PW6 is present for comprehensive lightening testing
    if not any("WHITE" in p["name"].upper() or "PW6" in p.get("code", "").upper() for p in pastes):
        pastes.append({
            "id": 999,
            "name": "Titanium Dioxide White",
            "code": "PW6",
            "hex": "#ffffff",
            "unit_k": [0.005] * N_WAVELENGTHS,
            "unit_s": [1.50] * N_WAVELENGTHS
        })

    data_dir = Path(__file__).resolve().parents[2] / "tests" / "data"
    all_targets = []

    # 1. Load blind test targets (includes Metameric, Ultra-Pastel, and High-Stress regimes)
    blind_path = data_dir / "blind_targets_dataset.json"
    blind_targets = []
    if blind_path.exists():
        with open(blind_path, "r", encoding="utf-8") as f:
            blind_targets = json.load(f)
            all_targets.extend(blind_targets)

    # 2. Load industrial regression targets
    reg_path = data_dir / "regression_targets.json"
    if reg_path.exists():
        with open(reg_path, "r", encoding="utf-8") as f:
            all_targets.extend(json.load(f))

    # 3. Compile genuine Lightening targets (demanding high scattering on Clear Base D)
    if blind_targets and base4_row:
        pastel_sources = [t for t in blind_targets if "FAINT" in t["id"] or "POWDER" in t["id"] or "BLUSH" in t["id"]]
        for pt in pastel_sources:
            all_targets.append({
                "id": f"{pt['id']}_CLEAR_BASE_LIGHTENING",
                "name": f"{pt['name']} (Lightening on Clear Base)",
                "type": "lightening",
                "target_reflectance": pt["target_reflectance"],
                "base_k": base4_k.tolist(),
                "base_s": base4_s.tolist()
            })

    print(f"Running Candidate Screening Recall & Accuracy Audit across {len(all_targets)} targets...")
    report_data = run_candidate_recall_audit(all_targets, base_k, base_s, pastes, max_pastes=4)
    print(format_recall_audit_report(report_data))
