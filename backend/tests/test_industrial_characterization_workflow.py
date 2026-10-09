"""
Industrial Characterization and Laboratory Packaging Workflow Tests
===================================================================
Tests for Can Sizes, Products with Abstract Bases (SW, W, TR), Color Cards,
Smart Mixture Proposer & Custom Mixture Series Templates (Add, Edit, Delete),
Can Scaling Engine, and Batch Card Matching.
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
    can = conn.execute("SELECT id FROM can_sizes WHERE code = '1L'").fetchone()
    base = conn.execute("SELECT id FROM bases WHERE code LIKE 'BASE-A%' ORDER BY id ASC").fetchone()
    paste = conn.execute("SELECT id FROM pastes LIMIT 1").fetchone()
    conn.close()

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


# ============================================================================
# RECOMMENDED MIXTURE SERIES (ADD, EDIT, DELETE, RESET) TESTS
# ============================================================================

def test_mixture_templates_crud_workflow():
    """Verify technician can list, add, edit, delete, and reset recommended mixture series."""
    # 1. List default BWC templates
    get_res = client.get("/api/characterization/mixture-templates?series_type=BWC")
    assert get_res.status_code == 200
    bwc_list = get_res.json()
    assert len(bwc_list) >= 5
    initial_count = len(bwc_list)

    # 2. Add a new custom letdown mixture
    add_payload = {
        "series_type": "BWC",
        "name": "Özel Test Açması (%3.5)",
        "concentration_pct": 3.5,
        "colorant_ratio": 0.035,
        "base_ratio": 0.965,
        "description": "Özel laboratuvar ara ton testi"
    }
    post_res = client.post("/api/characterization/mixture-templates", json=add_payload)
    assert post_res.status_code == 200
    added_id = post_res.json()["id"]

    # Verify it is listed
    list_res = client.get("/api/characterization/mixture-templates?series_type=BWC")
    assert len(list_res.json()) == initial_count + 1
    found = next((m for m in list_res.json() if m["id"] == added_id), None)
    assert found is not None
    assert found["name"] == "Özel Test Açması (%3.5)"
    assert found["concentration_pct"] == 3.5

    # 3. Edit / modify the mixture
    edit_payload = {
        "name": "Revize Test Açması (%3.8)",
        "concentration_pct": 3.8
    }
    put_res = client.put(f"/api/characterization/mixture-templates/{added_id}", json=edit_payload)
    assert put_res.status_code == 200

    # Verify modification
    list_res2 = client.get("/api/characterization/mixture-templates?series_type=BWC")
    edited = next((m for m in list_res2.json() if m["id"] == added_id), None)
    assert edited["name"] == "Revize Test Açması (%3.8)"
    assert edited["concentration_pct"] == 3.8

    # 4. Delete the mixture
    del_res = client.delete(f"/api/characterization/mixture-templates/{added_id}")
    assert del_res.status_code == 200

    # Verify deletion
    list_res3 = client.get("/api/characterization/mixture-templates?series_type=BWC")
    assert len(list_res3.json()) == initial_count
    assert not any(m["id"] == added_id for m in list_res3.json())


def test_dynamic_mixture_proposer_and_actual_weights():
    """Verify dynamic mixture proposer scales to custom batch weights and handles actual weights."""
    # Test proposer generation
    payload = {
        "series_type": "BWC",
        "batch_weight_g": 200.0,
        "paste_density": 1.35,
        "base_density": 1.45,
        "min_scale_resolution_g": 0.01
    }
    res = client.post("/api/characterization/proposer/generate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["batch_weight_g"] == 200.0
    assert len(data["proposals"]) >= 5

    # Check a 5% letdown: for 200g base -> 10.0g paste
    prop_5 = next((p for p in data["proposals"] if abs(p["concentration_pct"] - 5.0) < 0.1), None)
    assert prop_5 is not None
    assert prop_5["proposal"]["colorant_weight_g"] == 10.0
    assert prop_5["is_dispensable"] is True


def test_dual_substrate_and_actual_dispensed_calculation():
    """Verify K-M characterization with actual weighed grams and dual-substrate (Rw, Rb) evaluation."""
    conn = get_db_connection()
    base = conn.execute("SELECT id FROM bases WHERE code LIKE 'BASE-A%' LIMIT 1").fetchone()
    conn.close()

    # White letdown readings (Rw) and black background readings (Rb)
    payload = {
        "base_id": base["id"],
        "letdowns": [
            {
                "concentration": 5.0,
                "reflectance": [0.45] * 31,
                "reflectance_black": [0.38] * 31,
                "actual_colorant_g": 5.12,  # slight scale deviation
                "actual_base_g": 99.88,
                "actual_total_g": 105.00
            },
            {
                "concentration": 1.0,
                "reflectance": [0.72] * 31,
                "reflectance_black": [0.65] * 31,
                "actual_colorant_g": 1.05,
                "actual_base_g": 100.00,
                "actual_total_g": 101.05
            }
        ],
        "k1": 0.04,
        "k2": 0.60,
        "use_two_constant": True
    }

    res = client.post("/api/characterization/calculate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert "unit_k" in data
    assert "unit_s" in data
    assert "dual_substrate_evaluations" in data
    assert len(data["dual_substrate_evaluations"]) == 2
    assert "mean_calibrated_thickness_um" in data
    assert data["mean_calibrated_thickness_um"] > 0


def test_characterization_sets_api():
    """Verify listing configured optical characterization sets."""
    res = client.get("/api/characterization/sets")
    assert res.status_code == 200
    sets = res.json()
    assert len(sets) >= 1
    main_set = sets[0]
    assert "code" in main_set
    assert "system_mode" in main_set
    assert main_set["k1"] > 0
    assert main_set["k2"] > 0


def test_stage1_bootstrap_calculate_api():
    """Verify Stage 1 BW letdown calibration calculation deriving K_black and S_white."""
    conn = get_db_connection()
    base_d = conn.execute("SELECT id FROM bases WHERE code LIKE 'BASE-D%' LIMIT 1").fetchone()
    pbk7 = conn.execute("SELECT id FROM pastes WHERE code = 'PBk7' LIMIT 1").fetchone()
    pw6 = conn.execute("SELECT id FROM pastes WHERE code = 'PW6' LIMIT 1").fetchone()
    conn.close()

    white_r = [0.88] * 31
    black_r = [0.05] * 31

    # Synthetic realistic BW letdowns: pure white and black dilutions
    bw_letdowns = [
        {
            "concentration": 0.0,
            "reflectance": white_r,
            "reflectance_black": [0.86] * 31,
            "actual_base_g": 100.0,
            "actual_colorant_g": 0.0
        },
        {
            "concentration": 0.45,
            "reflectance": [0.55] * 31,
            "reflectance_black": [0.53] * 31,
            "actual_base_g": 99.55,
            "actual_colorant_g": 0.45
        },
        {
            "concentration": 2.34,
            "reflectance": [0.25] * 31,
            "reflectance_black": [0.24] * 31,
            "actual_base_g": 97.66,
            "actual_colorant_g": 2.34
        },
        {
            "concentration": 7.00,
            "reflectance": [0.08] * 31,
            "reflectance_black": [0.07] * 31,
            "actual_base_g": 93.00,
            "actual_colorant_g": 7.00
        }
    ]

    payload = {
        "clear_base_id": base_d["id"],
        "black_paste_id": pbk7["id"],
        "white_paste_id": pw6["id"],
        "k1": 0.04,
        "k2": 0.60,
        "thickness": 100.0,
        "bw_letdowns": bw_letdowns
    }

    res = client.post("/api/characterization/bootstrap-calculate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert "unit_k_white" in data
    assert "unit_s_white" in data
    assert "unit_k_black" in data
    assert "unit_s_black" in data
    assert len(data["unit_k_white"]) == 31
    assert len(data["unit_s_white"]) == 31
    # Check physical normalization
    assert all(s == 1.0 for s in data["unit_s_white"])
    # Check black absorption is high
    assert all(k > 0.05 for k in data["unit_k_black"])
    assert "back_predictions" in data
    assert len(data["back_predictions"]) == 4
    assert data["mean_delta_e00"] >= 0


def test_stage1_bootstrap_system_lock_with_bw_measurements():
    """Verify Stage 1 complete physical lockdown with measured BW series."""
    conn = get_db_connection()
    base_d = conn.execute("SELECT id FROM bases WHERE code LIKE 'BASE-D%' LIMIT 1").fetchone()
    pbk7 = conn.execute("SELECT id FROM pastes WHERE code = 'PBk7' LIMIT 1").fetchone()
    pw6 = conn.execute("SELECT id FROM pastes WHERE code = 'PW6' LIMIT 1").fetchone()
    conn.close()

    white_r = [0.88] * 31
    bw_letdowns = [
        {
            "concentration": 0.0,
            "reflectance": white_r,
            "reflectance_black": [0.86] * 31,
            "actual_base_g": 100.0,
            "actual_colorant_g": 0.0
        },
        {
            "concentration": 1.18,
            "reflectance": [0.38] * 31,
            "reflectance_black": [0.37] * 31,
            "actual_base_g": 98.82,
            "actual_colorant_g": 1.18
        },
        {
            "concentration": 7.00,
            "reflectance": [0.08] * 31,
            "reflectance_black": [0.07] * 31,
            "actual_base_g": 93.00,
            "actual_colorant_g": 7.00
        }
    ]

    payload = {
        "clear_base_id": base_d["id"],
        "black_paste_id": pbk7["id"],
        "white_paste_id": pw6["id"],
        "optical_system": "bootstrap_v1",
        "k1": 0.04,
        "k2": 0.60,
        "thickness": 100.0,
        "bw_letdowns": bw_letdowns
    }

    res = client.post("/api/characterization/bootstrap-system", json=payload)
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["success"] is True
    assert "calculation" in res_data
    assert res_data["calculation"] is not None

    # Check Stage 1 status
    status_res = client.get("/api/characterization/bootstrap-status")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["stages"]["stage1"]["status"] == "COMPLETED"
    assert status_data["stages"]["stage1"]["clear_base"]["id"] == base_d["id"]
    assert status_data["stages"]["stage1"]["black_paste"]["id"] == pbk7["id"]
    assert status_data["stages"]["stage1"]["white_paste"]["id"] == pw6["id"]


