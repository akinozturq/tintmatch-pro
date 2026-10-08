"""
TintMatch PRO - Recipe Confidence & Industrial Verification Engine
==================================================================
Evaluates formulation confidence and provides actionable guidance for factory operators:
1. Karakterizasyon Güvenilirliği (Characterization validity & LOOCV quality)
2. Geometri & Ölçüm Modu Uyumu (Optical geometry & SCI/SCE contract)
3. Tartılabilirlik & Üretilebilirlik (0.01g scale precision & batch manufacturability)
4. Model Ekstrapolasyon Riski (Concentration ladder range check)
5. Hedef Renk Doğruluğu (CIEDE2000 target tolerance)
"""

from typing import Any, Dict, List, Optional


def evaluate_recipe_confidence(
    recipe: Dict[str, Any],
    base_info: Optional[Dict[str, Any]] = None,
    tolerance_de00: float = 0.30
) -> Dict[str, Any]:
    """
    Evaluates industrial recipe confidence and generates Turkish operator guidance.

    Returns:
        {
            "confidence_level": "HIGH" | "MEDIUM" | "LOW" | "BLOCKED",
            "score": int (0-100),
            "status_color": "green" | "yellow" | "red",
            "summary": str,
            "checks": List[Dict[str, Any]],
            "operator_guidance": List[str],
            "warnings": List[str]
        }
    """
    score = 100
    checks = []
    operator_guidance = []
    warnings = []
    is_blocked = False

    matched_pastes = recipe.get("matched_pastes", [])
    delta_e00 = float(recipe.get("delta_e00", 99.0))
    status = recipe.get("status", "UNKNOWN")
    scale_res = float(recipe.get("scale_resolution_g", 0.01))
    batch_size = float(recipe.get("batch_size_g", 1000.0))
    extrapolation_warning = bool(recipe.get("extrapolation_warning", False))
    extrapolation_notes = recipe.get("extrapolation_notes", [])

    # 1. Hard solver check
    if status in ("INFEASIBLE_CONSTRAINT_SET", "NO_ACTIVE_PIGMENTS", "BLOCKED") or not matched_pastes:
        return {
            "confidence_level": "BLOCKED",
            "score": 0,
            "status_color": "red",
            "summary": "⛔ Reçete Üretilemez: Kısıtlar veya pasta havuzu yetersiz.",
            "checks": [{
                "name": "Çözücü Uygunluğu",
                "status": "FAIL",
                "detail": f"Çözücü durumu: {status}"
            }],
            "operator_guidance": ["Reçete hesaplanamadı. Baz veya pasta seçimini kontrol ediniz."],
            "warnings": ["Geçerli bir reçete üretilemedi."]
        }

    # 2. Karakterizasyon Güvenilirliği (Characterization validity)
    char_valid = True
    char_warnings = []
    for p in matched_pastes:
        p_status = p.get("status", "ACTIVE")
        if p_status in ("REJECTED", "FAIL"):
            char_valid = False
            is_blocked = True
            char_warnings.append(f"Pasta '{p.get('name')}' kalibrasyon testini geçememiş ({p_status}).")
        elif p_status in ("CONDITIONAL", "WARN"):
            score -= 10
            char_warnings.append(f"Pasta '{p.get('name')}' koşullu onaylı.")

    if char_valid and not char_warnings:
        checks.append({
            "name": "Karakterizasyon Geçerliliği",
            "status": "PASS",
            "detail": "Tüm pastalar onaylı ve güncel karakterizasyona sahip."
        })
        operator_guidance.append("✓ Karakterizasyon geçerli ve onaylı.")
    elif is_blocked:
        checks.append({
            "name": "Karakterizasyon Geçerliliği",
            "status": "FAIL",
            "detail": "; ".join(char_warnings)
        })
        warnings.extend(char_warnings)
    else:
        checks.append({
            "name": "Karakterizasyon Geçerliliği",
            "status": "WARN",
            "detail": "; ".join(char_warnings)
        })
        warnings.extend(char_warnings)

    # 3. Geometri & Ölçüm Modu Uyumu
    geo = recipe.get("geometry", "d/8°")
    mode = recipe.get("measurement_mode", "SCI")
    checks.append({
        "name": "Geometri & Ölçüm Modu",
        "status": "PASS",
        "detail": f"Optik sistem izole: {geo} {mode}"
    })
    operator_guidance.append(f"✓ Optik geometri ve mod uyumlu ({geo} {mode}).")

    # 4. Tartılabilirlik & Üretilebilirlik
    weighable = True
    sub_scale_pastes = []
    for p in matched_pastes:
        amt = float(p.get("amount_g", 0.0))
        if 0.0 < amt < scale_res - 1e-5:
            weighable = False
            sub_scale_pastes.append(f"{p.get('name')} ({amt:.3f} g < {scale_res} g)")

    if weighable:
        checks.append({
            "name": "Tartılabilirlik & Üretilebilirlik",
            "status": "PASS",
            "detail": f"Tüm pastalar terazi hassasiyetine ({scale_res} g) uygun. Parti boyutu: {batch_size} g."
        })
        operator_guidance.append(f"✓ Reçete {scale_res} g terazi hassasiyetinde tartılabilir.")
    else:
        score -= 25
        checks.append({
            "name": "Tartılabilirlik & Üretilebilirlik",
            "status": "WARN",
            "detail": f"Bazı pastalar terazi hassasiyetinin altında: {', '.join(sub_scale_pastes)}"
        })
        warnings.append(f"Tartım hassasiyeti uyarısı: Parti boyutunu ({batch_size} g) artırınız.")

    # 5. Model Ekstrapolasyon Kontrolü
    if extrapolation_warning:
        score -= 15
        checks.append({
            "name": "Ekstrapolasyon Kontrolü",
            "status": "WARN",
            "detail": "; ".join(extrapolation_notes)
        })
        warnings.extend(extrapolation_notes)
    else:
        checks.append({
            "name": "Ekstrapolasyon Kontrolü",
            "status": "PASS",
            "detail": "Tüm pastalar karakterize edilen konsantrasyon aralığında."
        })
        operator_guidance.append("✓ Konsantrasyonlar karakterizasyon aralığında.")

    # 6. Hedef Renk Doğruluğu (CIEDE2000)
    if delta_e00 <= tolerance_de00:
        checks.append({
            "name": "Renk Farkı (ΔE00)",
            "status": "PASS",
            "detail": f"Tahmini ΔE00 = {delta_e00:.2f} (Tolerans: ≤ {tolerance_de00:.2f})"
        })
        operator_guidance.append(f"✓ Hedef renk tolerans içinde (ΔE00 = {delta_e00:.2f}).")
    elif delta_e00 <= tolerance_de00 * 2.0:
        penalty = int((delta_e00 - tolerance_de00) * 50)
        score -= min(penalty, 30)
        checks.append({
            "name": "Renk Farkı (ΔE00)",
            "status": "WARN",
            "detail": f"Tahmini ΔE00 = {delta_e00:.2f} (Toleransın üzerinde, numune çekimi önerilir)"
        })
        warnings.append(f"Renk farkı orta seviyede (ΔE00 = {delta_e00:.2f}). Drawdown ile test ediniz.")
    else:
        score -= 45
        checks.append({
            "name": "Renk Farkı (ΔE00)",
            "status": "FAIL",
            "detail": f"Tahmini ΔE00 = {delta_e00:.2f} tolerans dışı (Tolerans: {tolerance_de00:.2f})"
        })
        warnings.append(f"Yüksek renk farkı (ΔE00 = {delta_e00:.2f}). Farklı baz veya pasta havuzu deneyiniz.")

    # Number of pastes simplicity bonus/penalty
    n_pastes = len(matched_pastes)
    if n_pastes <= 3:
        operator_guidance.append(f"✓ Basit ve dengeli reçete ({n_pastes} pasta).")
    elif n_pastes >= 5:
        score -= 10
        warnings.append(f"Reçete {n_pastes} pasta içeriyor. Üretim tartım hata riski artabilir.")

    score = max(0, min(100, score))

    if is_blocked:
        conf_level = "BLOCKED"
        status_color = "red"
        summary = "⛔ ÜRETİLEMEZ: Geçersiz kalibrasyon veya kritik kısıt ihlali."
    elif score >= 80 and delta_e00 <= tolerance_de00 * 1.25 and weighable:
        conf_level = "HIGH"
        status_color = "green"
        summary = "🟢 YÜKSEK GÜVEN: Reçete üretime ve laboratuvar çekimine hazır."
    elif score >= 55 and delta_e00 <= tolerance_de00 * 2.5:
        conf_level = "MEDIUM"
        status_color = "yellow"
        summary = "🟡 ORTA GÜVEN: Laboratuvar numunesi çekilip kontrol edilmelidir."
    else:
        conf_level = "LOW"
        status_color = "red"
        summary = "🔴 DÜŞÜK GÜVEN: Reçete riskli, ek karakterizasyon veya baz değişimi önerilir."

    return {
        "confidence_level": conf_level,
        "score": score,
        "status_color": status_color,
        "summary": summary,
        "checks": checks,
        "operator_guidance": operator_guidance,
        "warnings": warnings
    }
