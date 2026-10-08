"""
Pytest Configuration & Fixture Isolation for TintMatch PRO
===========================================================
Ensures that all tests execute against an isolated, fresh temporary SQLite database
and NEVER mutate or pollute the development / production database (tintmatch.db).
"""

import os
import shutil
import tempfile
from pathlib import Path
import pytest

# Create an isolated temporary test directory for this pytest session
_TEST_DIR = tempfile.mkdtemp(prefix="tintmatch_test_db_")
_TEST_DB_PATH = Path(_TEST_DIR) / "tintmatch_isolated_test.db"

# Point TINTMATCH_DB_PATH to the isolated database BEFORE any backend module is imported
os.environ["TINTMATCH_DB_PATH"] = str(_TEST_DB_PATH)

# Initialize schema and seed calibration datasets in the isolated database
from backend.database.db import init_db
init_db()


@pytest.fixture(scope="session", autouse=True)
def isolate_test_database():
    """
    Session-wide fixture ensuring complete SQLite test database isolation.
    Guarantees backend/database/tintmatch.db remains pristine.
    """
    yield _TEST_DB_PATH

    # Teardown: delete the temporary test database and directory
    try:
        shutil.rmtree(_TEST_DIR, ignore_errors=True)
    except Exception:
        pass
