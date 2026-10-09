"""
Configuration and Industrial Workflow API Router
================================================
Handles industrial packaging (Can Sizes), Products with Abstract Bases (SW, W, TR),
Color Cards & Card Colors management, Smart Mixture Proposer, and Can Scaling Engine.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
import json
import numpy as np

from ..database.db import get_db_connection
from ..color_engine.formulation import match_color_ccm
from ..color_engine.colorimetry import reflectance_to_lab, reflectance_to_hex

router = APIRouter(prefix="/api/configuration", tags=["configuration"])


# ---------------------------------------------------------------------------
# Pydantic Request Models
# ---------------------------------------------------------------------------

class CanSizeCreate(BaseModel):
    code: str = Field(..., json_schema_extra={"example": "15L"})
    name: str = Field(..., json_schema_extra={"example": "15 Litre Standart Teneke"})
    nominal_volume_l: float = Field(..., json_schema_extra={"example": 15.0})
    default_base_fill_l: float = Field(..., json_schema_extra={"example": 14.0})
    max_colorant_volume_l: float = Field(..., json_schema_extra={"example": 1.20})
    package_cost: float = Field(0.0, json_schema_extra={"example": 95.0})


class ProductBaseMapping(BaseModel):
    abstract_base_code: str = Field(..., json_schema_extra={"example": "SW"})  # SW, W, TR
    base_id: int
    specific_gravity: float = Field(1.45, json_schema_extra={"example": 1.48})
    cost_per_liter: float = Field(45.0, json_schema_extra={"example": 52.0})


class ProductCreate(BaseModel):
    code: str = Field(..., json_schema_extra={"example": "PT.505.25"})
    name: str = Field(..., json_schema_extra={"example": "PT.505.25 Süper Mat İç Cephe"})
    product_type: str = Field("interior_matte", json_schema_extra={"example": "interior_matte"})
    voc_limit: float = Field(25.0, json_schema_extra={"example": 25.0})
    bases: list[ProductBaseMapping] = []


class ColorCardCreate(BaseModel):
    code: str = Field(..., json_schema_extra={"example": "RAL-CLASSIC-K7"})
    name: str = Field(..., json_schema_extra={"example": "RAL Classic K7 Koleksiyonu"})
    description: str | None = None


class CardColorCreate(BaseModel):
    color_code: str = Field(..., json_schema_extra={"example": "RAL 7035"})
    color_name: str = Field(..., json_schema_extra={"example": "Işık Grisi (Light Grey)"})
    hex: str | None = Field(default=None, json_schema_extra={"example": "#D7D7D7"})
    reflectance: list[float] = Field(..., description="31-point spectral reflectance (400-700 nm)")


class CardColorBatchCreate(BaseModel):
    colors: list[CardColorCreate]


class PasteInput(BaseModel):
    paste_id: int
    concentration: float  # % mass relative to base


class ScaleRecipeRequest(BaseModel):
    can_size_id: int
    base_id: int
    pastes: list[PasteInput]
    number_of_cans: int = 1


class BatchMatchCardRequest(BaseModel):
    card_id: int
    base_id: int
    product_id: int | None = None
    max_pastes: int = 4
    profile_id: str = "color_match"
    max_de_threshold: float = 1.0


# ---------------------------------------------------------------------------
# 1. CAN SIZES ENDPOINTS
# ---------------------------------------------------------------------------

@router.get("/can-sizes")
def list_can_sizes():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM can_sizes ORDER BY nominal_volume_l ASC").fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "code": r["code"],
            "name": r["name"],
            "nominal_volume_l": r["nominal_volume_l"],
            "default_base_fill_l": r["default_base_fill_l"],
            "max_colorant_volume_l": r["max_colorant_volume_l"],
            "headspace_l": round(r["nominal_volume_l"] - r["default_base_fill_l"], 3),
            "package_cost": r["package_cost"],
            "created_at": r["created_at"]
        }
        for r in rows
    ]


@router.post("/can-sizes")
def create_can_size(data: CanSizeCreate):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
        INSERT INTO can_sizes (code, name, nominal_volume_l, default_base_fill_l, max_colorant_volume_l, package_cost)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (
            data.code.strip().upper(),
            data.name.strip(),
            data.nominal_volume_l,
            data.default_base_fill_l,
            data.max_colorant_volume_l,
            data.package_cost
        ))
        conn.commit()
        new_id = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Kutu boyutu kaydedilemedi: {str(e)}")
    conn.close()
    return {"id": new_id, "code": data.code, "message": "Kutu boyutu başarıyla eklendi."}


@router.delete("/can-sizes/{can_size_id}")
def delete_can_size(can_size_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM can_sizes WHERE id = ?", (can_size_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Kutu boyutu {can_size_id} silindi."}


# ---------------------------------------------------------------------------
# 2. PRODUCTS & ABSTRACT BASES ENDPOINTS
# ---------------------------------------------------------------------------

@router.get("/products")
def list_products():
    conn = get_db_connection()
    products = conn.execute("SELECT * FROM products ORDER BY id ASC").fetchall()
    result = []
    for p in products:
        p_id = p["id"]
        base_rows = conn.execute("""
        SELECT pb.*, b.name as base_name, b.code as base_code, b.reflectance as base_reflectance
        FROM product_bases pb
        JOIN bases b ON pb.base_id = b.id
        WHERE pb.product_id = ?
        ORDER BY pb.abstract_base_code ASC
        """, (p_id,)).fetchall()

        bases_list = []
        for b in base_rows:
            try:
                refl = json.loads(b["base_reflectance"])
                hex_c = reflectance_to_hex(refl)
            except Exception:
                hex_c = "#E5E5E5"

            bases_list.append({
                "id": b["id"],
                "abstract_base_code": b["abstract_base_code"],
                "base_id": b["base_id"],
                "base_name": b["base_name"],
                "base_code": b["base_code"],
                "base_hex": hex_c,
                "specific_gravity": b["specific_gravity"],
                "cost_per_liter": b["cost_per_liter"]
            })

        result.append({
            "id": p["id"],
            "code": p["code"],
            "name": p["name"],
            "product_type": p["product_type"],
            "voc_limit": p["voc_limit"],
            "created_at": p["created_at"],
            "bases": bases_list
        })
    conn.close()
    return result


@router.post("/products")
def create_product(data: ProductCreate):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
        INSERT INTO products (code, name, product_type, voc_limit)
        VALUES (?, ?, ?, ?)
        """, (data.code.strip().upper(), data.name.strip(), data.product_type, data.voc_limit))
        prod_id = cur.lastrowid

        for b in data.bases:
            cur.execute("""
            INSERT INTO product_bases (product_id, abstract_base_code, base_id, specific_gravity, cost_per_liter)
            VALUES (?, ?, ?, ?, ?)
            """, (prod_id, b.abstract_base_code.strip().upper(), b.base_id, b.specific_gravity, b.cost_per_liter))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Ürün kaydedilemedi: {str(e)}")
    conn.close()
    return {"id": prod_id, "code": data.code, "message": "Ürün ve soyut baz eşleşmeleri kaydedildi."}


@router.delete("/products/{product_id}")
def delete_product(product_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM product_bases WHERE product_id = ?", (product_id,))
    cur.execute("DELETE FROM products WHERE id = ?", (product_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Ürün {product_id} silindi."}


# ---------------------------------------------------------------------------
# 3. COLOR CARDS & CARD COLORS ENDPOINTS
# ---------------------------------------------------------------------------

@router.get("/color-cards")
def list_color_cards():
    conn = get_db_connection()
    rows = conn.execute("""
    SELECT c.*, COUNT(col.id) as color_count
    FROM color_cards c
    LEFT JOIN card_colors col ON c.id = col.card_id
    GROUP BY c.id
    ORDER BY c.id ASC
    """).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "code": r["code"],
            "name": r["name"],
            "description": r["description"],
            "color_count": r["color_count"],
            "created_at": r["created_at"]
        }
        for r in rows
    ]


@router.get("/color-cards/{card_id}/colors")
def list_card_colors(card_id: int):
    conn = get_db_connection()
    card = conn.execute("SELECT * FROM color_cards WHERE id = ?", (card_id,)).fetchone()
    if not card:
        conn.close()
        raise HTTPException(status_code=404, detail="Renk kartelası bulunamadı")

    colors = conn.execute("""
    SELECT * FROM card_colors WHERE card_id = ? ORDER BY color_code ASC
    """, (card_id,)).fetchall()
    conn.close()

    return {
        "card": {
            "id": card["id"],
            "code": card["code"],
            "name": card["name"],
            "description": card["description"]
        },
        "colors": [
            {
                "id": c["id"],
                "color_code": c["color_code"],
                "color_name": c["color_name"],
                "hex": c["hex"],
                "lab": json.loads(c["lab_json"]),
                "reflectance": json.loads(c["reflectance_json"]),
                "created_at": c["created_at"]
            }
            for c in colors
        ]
    }


@router.post("/color-cards")
def create_color_card(data: ColorCardCreate):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
        INSERT INTO color_cards (code, name, description)
        VALUES (?, ?, ?)
        """, (data.code.strip().upper(), data.name.strip(), data.description))
        conn.commit()
        new_id = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Renk kartelası oluşturulamadı: {str(e)}")
    conn.close()
    return {"id": new_id, "code": data.code, "message": "Renk kartelası başarıyla oluşturuldu."}


@router.post("/color-cards/{card_id}/colors")
def add_card_color(card_id: int, data: CardColorCreate):
    if len(data.reflectance) != 31:
        raise HTTPException(status_code=400, detail="Spektral yansıma 31 dalga boyu içermelidir (400-700 nm @ 10 nm)")

    refl_arr = np.asarray(data.reflectance, dtype=float)
    if np.max(refl_arr) > 1.5:
        refl_arr = refl_arr / 100.0
    refl_arr = np.clip(refl_arr, 0.0001, 0.9999)

    lab_vals = reflectance_to_lab(refl_arr, illuminant="D65", observer="10")
    lab_dict = {"L": round(lab_vals[0], 2), "a": round(lab_vals[1], 2), "b": round(lab_vals[2], 2)}
    hex_val = data.hex if data.hex else reflectance_to_hex(refl_arr)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
        INSERT INTO card_colors (card_id, color_code, color_name, hex, lab_json, reflectance_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (
            card_id,
            data.color_code.strip(),
            data.color_name.strip(),
            hex_val,
            json.dumps(lab_dict),
            json.dumps([round(float(v), 5) for v in refl_arr])
        ))
        conn.commit()
        new_id = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Kartela rengi eklenemedi: {str(e)}")
    conn.close()
    return {"id": new_id, "color_code": data.color_code, "lab": lab_dict, "hex": hex_val}


@router.post("/color-cards/{card_id}/colors/batch")
def add_batch_card_colors(card_id: int, data: CardColorBatchCreate):
    conn = get_db_connection()
    cur = conn.cursor()
    inserted = []
    try:
        for c in data.colors:
            if len(c.reflectance) != 31:
                continue
            refl_arr = np.asarray(c.reflectance, dtype=float)
            if np.max(refl_arr) > 1.5:
                refl_arr = refl_arr / 100.0
            refl_arr = np.clip(refl_arr, 0.0001, 0.9999)
            lab_vals = reflectance_to_lab(refl_arr, illuminant="D65", observer="10")
            lab_dict = {"L": round(lab_vals[0], 2), "a": round(lab_vals[1], 2), "b": round(lab_vals[2], 2)}
            hex_val = c.hex if c.hex else reflectance_to_hex(refl_arr)
            cur.execute("""
            INSERT OR REPLACE INTO card_colors (card_id, color_code, color_name, hex, lab_json, reflectance_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                card_id,
                c.color_code.strip(),
                c.color_name.strip(),
                hex_val,
                json.dumps(lab_dict),
                json.dumps([round(float(v), 5) for v in refl_arr])
            ))
            inserted.append(c.color_code)
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Toplu kartela rengi ekleme hatası: {str(e)}")
    conn.close()
    return {"success": True, "count": len(inserted), "colors": inserted}


@router.delete("/color-cards/{card_id}/colors/{color_id}")
def delete_card_color(card_id: int, color_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM card_colors WHERE card_id = ? AND id = ?", (card_id, color_id))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Renk {color_id} karteladan silindi."}


@router.delete("/color-cards/{card_id}")
def delete_color_card(card_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM card_colors WHERE card_id = ?", (card_id,))
    cur.execute("DELETE FROM color_cards WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Renk kartelası {card_id} silindi."}


# ---------------------------------------------------------------------------
# 4. SMART MIXTURE PROPOSER ENDPOINT
# ---------------------------------------------------------------------------

@router.get("/proposer/letdowns")
def propose_letdown_mixtures(
    base_weight_g: float = Query(100.0, description="Hedef baz tartım miktarı (gram)"),
    paste_density: float = Query(1.35, description="Pasta yoğunluğu (g/cm³)"),
    base_density: float = Query(1.45, description="Baz yoğunluğu (g/cm³)"),
    levels: str = Query("0.1,0.5,1.0,2.5,5.0,10.0", description="Virgülle ayrılmış seyreltme yüzdeleri")
):
    """
    K-M Çift Sabitli Karakterizasyon için teknisyene optimal seyreltme serisi ve
    hassas terazi tartım reçetesi (gram ve ml cinsinden) önerir.
    """
    try:
        pct_list = [float(x.strip()) for x in levels.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Geçersiz seyreltme seviyeleri formatı")

    recommendations = []
    base_vol_ml = base_weight_g / base_density

    for pct in pct_list:
        # Net paste weight in grams for given base weight
        # concentration % = (paste_weight / base_weight) * 100
        paste_wt_g = round(base_weight_g * (pct / 100.0), 3)
        paste_vol_ml = round(paste_wt_g / paste_density, 3)
        total_wt_g = round(base_weight_g + paste_wt_g, 3)
        total_vol_ml = round(base_vol_ml + paste_vol_ml, 3)

        recommendations.append({
            "concentration_pct": pct,
            "base_weight_g": base_weight_g,
            "paste_weight_g": paste_wt_g,
            "paste_volume_ml": paste_vol_ml,
            "total_weight_g": total_wt_g,
            "total_volume_ml": total_vol_ml,
            "instruction": f"{base_weight_g:.1f}g Taşıyıcı Baz + {paste_wt_g:.2f}g ({paste_vol_ml:.2f} ml) Pasta tartıp homojenize edin."
        })

    return {
        "base_weight_g": base_weight_g,
        "base_density": base_density,
        "paste_density": paste_density,
        "recommendations": recommendations,
        "summary": f"{len(recommendations)} kademeli optimal Kubelka-Munk seyreltme merdiveni oluşturuldu."
    }


# ---------------------------------------------------------------------------
# 5. CAN SIZING & FORMULA SCALING ENGINE
# ---------------------------------------------------------------------------

@router.post("/scale-recipe")
def scale_recipe_to_can(data: ScaleRecipeRequest):
    """
    Laboratuvar % konsantrasyon reçetesini seçilen ambalaj boyutuna (0.75L, 2.5L, 15L vb.)
    göre net gramaj ve hacme dönüştürür; tepe boşluğu (headspace) ve maliyet hesabı yapar.
    """
    conn = get_db_connection()

    can_row = conn.execute("SELECT * FROM can_sizes WHERE id = ?", (data.can_size_id,)).fetchone()
    if not can_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Kutu boyutu bulunamadı")

    base_row = conn.execute("SELECT * FROM bases WHERE id = ?", (data.base_id,)).fetchone()
    if not base_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Taşıyıcı baz boya bulunamadı")

    base_density = float(base_row["density"] or 1.45)
    base_cost_l = 45.0  # default TL / L

    # Check if base has a product pricing
    pb_row = conn.execute("SELECT cost_per_liter FROM product_bases WHERE base_id = ?", (data.base_id,)).fetchone()
    if pb_row:
        base_cost_l = float(pb_row["cost_per_liter"])

    # Base volume per can and total
    base_fill_per_can_l = float(can_row["default_base_fill_l"])
    total_base_volume_l = round(base_fill_per_can_l * data.number_of_cans, 3)
    base_mass_per_can_kg = round(base_fill_per_can_l * base_density, 3)
    total_base_mass_kg = round(base_mass_per_can_kg * data.number_of_cans, 3)
    base_mass_g = base_mass_per_can_kg * 1000.0

    scaled_pastes = []
    total_paste_vol_per_can_ml = 0.0
    total_paste_cost = 0.0

    for p in data.pastes:
        paste_row = conn.execute("SELECT * FROM pastes WHERE id = ?", (p.paste_id,)).fetchone()
        if not paste_row:
            continue

        p_density = float(paste_row["density"] or 1.35)
        p_cost_kg = float(paste_row["cost_per_kg"] if "cost_per_kg" in paste_row.keys() and paste_row["cost_per_kg"] else 150.0)

        # Net paste mass per can in grams: (base_mass_g * c / 100)
        paste_mass_per_can_g = round(base_mass_g * (p.concentration / 100.0), 2)
        paste_vol_per_can_ml = round(paste_mass_per_can_g / p_density, 2)

        total_paste_mass_g = round(paste_mass_per_can_g * data.number_of_cans, 2)
        total_paste_vol_ml = round(paste_vol_per_can_ml * data.number_of_cans, 2)

        # Shots approximation (1 shot = 1/384 fl oz ≈ 0.0769 ml)
        shots = round(paste_vol_per_can_ml / 0.0769, 1)

        # Cost for this paste
        paste_cost_total = round((total_paste_mass_g / 1000.0) * p_cost_kg, 2)
        total_paste_cost += paste_cost_total
        total_paste_vol_per_can_ml += paste_vol_per_can_ml

        scaled_pastes.append({
            "paste_id": paste_row["id"],
            "name": paste_row["name"],
            "code": paste_row["code"],
            "color_hex": paste_row["color_hex"],
            "concentration_pct": p.concentration,
            "density": p_density,
            "per_can": {
                "mass_g": paste_mass_per_can_g,
                "volume_ml": paste_vol_per_can_ml,
                "shots": shots
            },
            "total": {
                "mass_g": total_paste_mass_g,
                "volume_ml": total_paste_vol_ml
            },
            "cost_per_kg": p_cost_kg,
            "total_cost": paste_cost_total
        })

    conn.close()

    total_paste_vol_per_can_l = total_paste_vol_per_can_ml / 1000.0
    max_colorant_l = float(can_row["max_colorant_volume_l"])
    headspace_remaining_ml = round((max_colorant_l - total_paste_vol_per_can_l) * 1000.0, 1)
    overfill_alert = total_paste_vol_per_can_l > max_colorant_l

    # Costing summary
    base_cost_total = round(total_base_volume_l * base_cost_l, 2)
    can_pkg_cost_total = round(float(can_row["package_cost"] or 0.0) * data.number_of_cans, 2)
    total_batch_cost = round(base_cost_total + total_paste_cost + can_pkg_cost_total, 2)

    total_finished_volume_l = round(total_base_volume_l + (total_paste_vol_per_can_l * data.number_of_cans), 3)
    cost_per_liter = round(total_batch_cost / max(total_finished_volume_l, 0.001), 2)

    return {
        "can_size": {
            "id": can_row["id"],
            "code": can_row["code"],
            "name": can_row["name"],
            "nominal_volume_l": can_row["nominal_volume_l"],
            "default_base_fill_l": can_row["default_base_fill_l"],
            "max_colorant_volume_l": can_row["max_colorant_volume_l"],
            "package_cost": can_row["package_cost"]
        },
        "number_of_cans": data.number_of_cans,
        "base": {
            "id": base_row["id"],
            "name": base_row["name"],
            "code": base_row["code"],
            "density": base_density,
            "cost_per_liter": base_cost_l,
            "per_can_volume_l": base_fill_per_can_l,
            "per_can_mass_kg": base_mass_per_can_kg,
            "total_volume_l": total_base_volume_l,
            "total_mass_kg": total_base_mass_kg,
            "total_cost": base_cost_total
        },
        "pastes": scaled_pastes,
        "headspace": {
            "max_colorant_volume_ml": round(max_colorant_l * 1000.0, 1),
            "used_colorant_volume_ml": round(total_paste_vol_per_can_ml, 1),
            "remaining_headspace_ml": headspace_remaining_ml,
            "overfill_alert": overfill_alert,
            "status": "OVERFILL_WARNING" if overfill_alert else "HEADSPACE_SAFE"
        },
        "costing": {
            "base_cost": base_cost_total,
            "colorant_cost": round(total_paste_cost, 2),
            "package_cost": can_pkg_cost_total,
            "total_batch_cost": total_batch_cost,
            "cost_per_liter": cost_per_liter,
            "cost_per_can": round(total_batch_cost / max(data.number_of_cans, 1), 2)
        }
    }


# ---------------------------------------------------------------------------
# 6. BATCH COLOR CARD MATCHING
# ---------------------------------------------------------------------------

@router.post("/match-card")
def batch_match_card(data: BatchMatchCardRequest):
    """
    Belirli bir renk kartelasındaki (örn. RAL Classic) tüm renkler için
    seçilen baz ve pastalarla toplu CCM reçete eşlemesi çalıştırır.
    """
    conn = get_db_connection()

    card = conn.execute("SELECT * FROM color_cards WHERE id = ?", (data.card_id,)).fetchone()
    if not card:
        conn.close()
        raise HTTPException(status_code=404, detail="Renk kartelası bulunamadı")

    colors = conn.execute("SELECT * FROM card_colors WHERE card_id = ?", (data.card_id,)).fetchall()
    if not colors:
        conn.close()
        raise HTTPException(status_code=400, detail="Kartelada kayıtlı renk bulunmuyor")

    base = conn.execute("SELECT * FROM bases WHERE id = ?", (data.base_id,)).fetchone()
    if not base:
        conn.close()
        raise HTTPException(status_code=404, detail="Taşıyıcı baz bulunamadı")

    # Get available pastes
    pastes = conn.execute("SELECT * FROM pastes WHERE passed_validation = 1 ORDER BY id ASC").fetchall()
    conn.close()

    if not pastes:
        raise HTTPException(status_code=400, detail="Karakterize edilmiş geçerli pasta bulunamadı")

    results = []
    passed_count = 0

    for col in colors:
        target_refl = json.loads(col["reflectance_json"])
        try:
            match_res = match_color_ccm(
                target_reflectance=target_refl,
                base_id=data.base_id,
                paste_ids=[p["id"] for p in pastes],
                max_pastes=data.max_pastes,
                profile_id=data.profile_id
            )
            de00 = match_res.get("delta_e00", 99.9)
            passed = de00 <= data.max_de_threshold
            if passed:
                passed_count += 1

            results.append({
                "color_id": col["id"],
                "color_code": col["color_code"],
                "color_name": col["color_name"],
                "hex": col["hex"],
                "delta_e00": round(de00, 3),
                "passed": passed,
                "pastes": match_res.get("pastes", []),
                "predicted_hex": match_res.get("predicted_hex", col["hex"]),
                "predicted_lab": match_res.get("predicted_lab", {})
            })
        except Exception as e:
            results.append({
                "color_id": col["id"],
                "color_code": col["color_code"],
                "color_name": col["color_name"],
                "hex": col["hex"],
                "delta_e00": None,
                "passed": False,
                "error": str(e)
            })

    return {
        "card": {
            "id": card["id"],
            "code": card["code"],
            "name": card["name"]
        },
        "total_colors": len(colors),
        "passed_colors": passed_count,
        "success_rate_pct": round((passed_count / max(len(colors), 1)) * 100.0, 1),
        "results": results
    }
