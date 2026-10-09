"""
Innovatint Industrial Workflow Tests
====================================
Tests for Can Sizes, Products with Abstract Bases (SW, W, TR), Color Cards,
Smart Mixture Proposer, Can Scaling Engine, and Batch Card Matching.
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database.db import get_db_connection, init_db

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    init_db()


def test_can_sizes_api():
    """Verify listing and creating pre-filled can sizes with headspace logic."""
    response = client.get("/api/configuration/can-sizes")
    assert response.status_code == 200
    can_sizes = response.json()
    assert len(can_sizes) >= 4

    codes = [c["code"] for c in can_sizes]
    assert "1L" in codes
    assert "15L" in codes

    # Check 15L can headspace
    can_15l = next(c for c in can_sizes if c["code"] == "15L")
    assert can_15l["nominal_volume_l"] == 15.0
    assert can_15l["default_base_fill_l"] == 14.0
    assert can_15l["max_colorant_volume_l"] == 1.20
    assert can_15l["headspace_l"] == 1.0


def test_products_and_abstract_bases_api():
    """Verify PT.505.25 product and its abstract bases (SW, W, TR)."""
    response = client.get("/api/configuration/products")
    assert response.status_code == 200
    products = response.json()
    assert len(products) >= 1

    pt505 = next((p for p in products if "PT.505.25" in p["code"]), None)
    assert pt505 is not None
    assert len(pt505["bases"]) >= 3

    base_codes = [b["abstract_base_code"] for b in pt505["bases"]]
    assert "SW" in base_codes  # Super White
    assert "W" in base_codes   # White
    assert "TR" in base_codes  # Transparent


def test_color_cards_and_colors_api():
    """Verify RAL Classic K7 card and its reference spectral colors."""
    response = client.get("/api/configuration/color-cards")
    assert response.status_code == 200
    cards = response.json()
    assert len(cards) >= 1

    ral_card = next((c for c in cards if "RAL" in c["code"]), None)
    assert ral_card is not None
    assert ral_card["color_count"] >= 10

    # Fetch colors in RAL card
    col_response = client.get(f"/api/configuration/color-cards/{ral_card['id']}/colors")
    assert col_response.status_code == 200
    card_data = col_response.json()
    colors = card_data["colors"]
    assert len(colors) >= 10

    color_codes = [c["color_code"] for c in colors]
    assert "RAL 7035" in color_codes
    assert "RAL 9010" in color_codes
    assert "RAL 7016" in color_codes

    ral_7035 = next(c for c in colors if c["color_code"] == "RAL 7035")
    assert len(ral_7035["reflectance"]) == 31
    assert "L" in ral_7035["lab"]
    assert ral_7035["hex"] == "#D7D7D7"


def test_smart_mixture_proposer():
    """Verify the Proposer calculates exact letdown weights and preparation instructions."""
    response = client.get("/api/configuration/proposer/letdowns?base_weight_g=100.0&paste_density=1.35&base_density=1.45&levels=0.1,0.5,1.0,2.5,5.0,10.0")
    assert response.status_code == 200
    data = response.json()

    assert data["base_weight_g"] == 100.0
    recs = data["recommendations"]
    assert len(recs) == 6

    # %0.1: 100g base -> 0.1g paste
    r01 = recs[0]
    assert r01["concentration_pct"] == 0.1
    assert r01["paste_weight_g"] == 0.1
    assert r01["total_weight_g"] == 100.1
    assert "100.0g Taşıyıcı Baz" in r01["instruction"]

    # %2.5: 100g base -> 2.5g paste
    r25 = recs[3]
    assert r25["concentration_pct"] == 2.5
    assert r25["paste_weight_g"] == 2.5
    assert r25["total_weight_g"] == 102.5


def test_can_scaling_engine_safe_headspace():
    """Verify scaling a CCM recipe to a 15L can with safe headspace and costing."""
    conn = get_db_connection()
    can = conn.execute("SELECT id FROM can_sizes WHERE code = '15L'").fetchone()
    base = conn.execute("SELECT id FROM bases WHERE code LIKE 'BASE-A%' ORDER BY id ASC").fetchone()
    pastes = conn.execute("SELECT id FROM pastes ORDER BY id ASC LIMIT 2").fetchall()
    conn.close()

    payload = {
        "can_size_id": can["id"],
        "base_id": base["id"],
        "pastes": [
            {"paste_id": pastes[0]["id"], "concentration": 1.5},
            {"paste_id": pastes[1]["id"], "concentration": 0.5}
        ],
        "number_of_cans": 1
    }

    response = client.post("/api/configuration/scale-recipe", json=payload)
    assert response.status_code == 200
    res = response.json()

    assert res["number_of_cans"] == 1
    assert res["base"]["per_can_volume_l"] == 14.0
    assert res["headspace"]["status"] == "HEADSPACE_SAFE"
    assert res["headspace"]["overfill_alert"] is False
    assert res["costing"]["total_batch_cost"] > 0.0
    assert len(res["pastes"]) == 2

    # Check net mass and volume
    for p in res["pastes"]:
        assert p["per_can"]["mass_g"] > 0
        assert p["per_can"]["volume_ml"] > 0
        assert p["per_can"]["shots"] > 0


def test_can_scaling_engine_overfill_alert():
    """Verify overfill alert triggers when colorant dosage exceeds can headspace."""
    conn = get_db_connection()
    can = conn.execute("SELECT id FROM can_sizes WHERE code = '1L'").fetchone()  # max 0.10 L colorants
    base = conn.execute("SELECT id FROM bases WHERE code LIKE 'BASE-A%' ORDER BY id ASC").fetchone()
    paste = conn.execute("SELECT id FROM pastes LIMIT 1").fetchone()
    conn.close()

    # Extreme 25% dosage in 1L can will exceed 0.10L
    payload = {
        "can_size_id": can["id"],
        "base_id": base["id"],
        "pastes": [
            {"paste_id": paste["id"], "concentration": 25.0}
        ],
        "number_of_cans": 1
    }

    response = client.post("/api/configuration/scale-recipe", json=payload)
    assert response.status_code == 200
    res = response.json()

    assert res["headspace"]["overfill_alert"] is True
    assert res["headspace"]["status"] == "OVERFILL_WARNING"


def test_batch_color_card_matching():
    """Verify batch matching of RAL Classic K7 card colors."""
    conn = get_db_connection()
    card = conn.execute("SELECT id FROM color_cards WHERE code = 'RAL-CLASSIC-K7'").fetchone()
    base = conn.execute("SELECT id FROM bases WHERE code LIKE 'BASE-A%' ORDER BY id ASC").fetchone()
    conn.close()

    payload = {
        "card_id": card["id"],
        "base_id": base["id"],
        "max_pastes": 3,
        "profile_id": "color_match",
        "max_de_threshold": 1.5
    }

    response = client.post("/api/configuration/match-card", json=payload)
    assert response.status_code == 200
    res = response.json()

    assert res["total_colors"] >= 10
    assert "success_rate_pct" in res
    assert len(res["results"]) == res["total_colors"]
    for r in res["results"]:
        assert "color_code" in r
        assert "delta_e00" in r


def test_color_cards_batch_and_delete():
    client = TestClient(app)

    # 1. Create a temporary card
    card_res = client.post("/api/configuration/color-cards", json={
        "code": "TEST-CARD-BATCH",
        "name": "Test Batch Card",
        "description": "Testing batch insertion and deletion"
    })
    assert card_res.status_code == 200
    card_id = card_res.json()["id"]

    # 2. Batch add 2 colors
    batch_payload = {
        "colors": [
            {
                "color_code": "BATCH-01",
                "color_name": "Batch Blue",
                "reflectance": [0.1] * 31
            },
            {
                "color_code": "BATCH-02",
                "color_name": "Batch Green",
                "reflectance": [0.2] * 31
            }
        ]
    }
    batch_res = client.post(f"/api/configuration/color-cards/{card_id}/colors/batch", json=batch_payload)
    assert batch_res.status_code == 200
    assert batch_res.json()["count"] == 2

    # Verify colors listed
    list_res = client.get(f"/api/configuration/color-cards/{card_id}/colors")
    assert list_res.status_code == 200
    colors = list_res.json()["colors"]
    assert len(colors) == 2
    color_to_del_id = colors[0]["id"]

    # 3. Delete single color
    del_color_res = client.delete(f"/api/configuration/color-cards/{card_id}/colors/{color_to_del_id}")
    assert del_color_res.status_code == 200

    # Verify 1 remains
    list_after = client.get(f"/api/configuration/color-cards/{card_id}/colors").json()["colors"]
    assert len(list_after) == 1

    # Cleanup card
    client.delete(f"/api/configuration/color-cards/{card_id}")
