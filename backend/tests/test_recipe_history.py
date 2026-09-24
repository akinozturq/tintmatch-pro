import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database.db import init_db, get_db_connection
from backend.routes.formulation import compute_canonical_execution_hash

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_test_db():
    init_db()
    yield

def test_canonical_hash_sensitivity():
    """Verify that canonical execution context hash changes if optical or algorithmic parameters change."""
    pastes = [
        {"id": 1, "name": "Yellow", "concentration": 2.5},
        {"id": 2, "name": "Blue", "concentration": 1.0}
    ]
    hash_base1 = compute_canonical_execution_hash(
        base_id=1, base_hash="hash_alpha", pastes=pastes, k1=0.04, k2=0.60, profile_id="color_match"
    )
    # Reversing paste order must give identical hash (order-invariant canonical sorting)
    reversed_pastes = [
        {"id": 2, "name": "Blue", "concentration": 1.0},
        {"id": 1, "name": "Yellow", "concentration": 2.5}
    ]
    hash_base1_reversed = compute_canonical_execution_hash(
        base_id=1, base_hash="hash_alpha", pastes=reversed_pastes, k1=0.04, k2=0.60, profile_id="color_match"
    )
    assert hash_base1 == hash_base1_reversed

    # Changing base optical hash
    hash_base2 = compute_canonical_execution_hash(
        base_id=1, base_hash="hash_beta", pastes=pastes, k1=0.04, k2=0.60, profile_id="color_match"
    )
    assert hash_base1 != hash_base2

    # Changing Saunderson k1 or k2
    hash_k1_changed = compute_canonical_execution_hash(
        base_id=1, base_hash="hash_alpha", pastes=pastes, k1=0.05, k2=0.60, profile_id="color_match"
    )
    assert hash_base1 != hash_k1_changed

    # Changing profile
    hash_profile_changed = compute_canonical_execution_hash(
        base_id=1, base_hash="hash_alpha", pastes=pastes, k1=0.04, k2=0.60, profile_id="light_stability"
    )
    assert hash_base1 != hash_profile_changed


def test_recipe_save_and_attempt_tracking():
    """Verify that saving a recipe automatically logs attempt #1 and subsequent attempts work."""
    # Ensure a base exists
    conn = get_db_connection()
    base = conn.execute("SELECT id FROM bases LIMIT 1").fetchone()
    conn.close()
    base_id = base["id"] if base else 1

    payload = {
        "name": "Test Trial Green",
        "base_id": base_id,
        "pastes": [
            {"id": 1, "name": "Test Yellow", "concentration": 1.25},
            {"id": 2, "name": "Test Cyan", "concentration": 0.75}
        ],
        "predicted_reflectance": [0.2] * 31,
        "lab": {"L": 65.0, "a": -15.0, "b": 22.0},
        "hex_color": "#4a9c6d",
        "delta_e00": 0.42,
        "k1": 0.04,
        "k2": 0.60,
        "profile_id": "color_match",
        "operator_notes": "Initial automatic formulation match"
    }

    resp = client.post("/api/formulation/recipes", json=payload)
    assert resp.status_code == 200
    save_data = resp.json()
    assert save_data["success"] is True
    recipe_id = save_data["id"]
    assert "calculation_hash" in save_data
    assert save_data["attempt_number"] == 1

    # Fetch attempts
    att_resp = client.get(f"/api/formulation/recipes/{recipe_id}/attempts")
    assert att_resp.status_code == 200
    att_data = att_resp.json()
    assert att_data["recipe_id"] == recipe_id
    assert len(att_data["attempts"]) == 1
    att1 = att_data["attempts"][0]
    assert att1["attempt_number"] == 1
    assert att1["delta_e00"] == 0.42
    assert att1["calculation_hash"] == save_data["calculation_hash"]

    # Add attempt #2 (manual tint addition / correction)
    attempt2_payload = {
        "pastes": [
            {"id": 1, "name": "Test Yellow", "concentration": 1.30},
            {"id": 2, "name": "Test Cyan", "concentration": 0.75}
        ],
        "predicted_reflectance": [0.21] * 31,
        "delta_e00": 0.28,
        "composite_mi": 0.15,
        "operator_notes": "Added +0.05% Yellow to adjust yellow undertone"
    }
    att2_resp = client.post(f"/api/formulation/recipes/{recipe_id}/attempts", json=attempt2_payload)
    assert att2_resp.status_code == 200
    att2_data = att2_resp.json()
    assert att2_data["success"] is True
    assert att2_data["attempt_number"] == 2

    # Verify attempts list now has 2 attempts
    att_resp_after = client.get(f"/api/formulation/recipes/{recipe_id}/attempts")
    assert att_resp_after.status_code == 200
    attempts = att_resp_after.json()["attempts"]
    assert len(attempts) == 2
    assert attempts[1]["attempt_number"] == 2
    assert attempts[1]["delta_e00"] == 0.28
    assert "Added +0.05% Yellow" in attempts[1]["operator_notes"]

    # Delete recipe and verify cascade delete
    del_resp = client.delete(f"/api/formulation/recipes/{recipe_id}")
    assert del_resp.status_code == 200
    # Recipe should not exist
    att_resp_deleted = client.get(f"/api/formulation/recipes/{recipe_id}/attempts")
    assert att_resp_deleted.status_code == 404
