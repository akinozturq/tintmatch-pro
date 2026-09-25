"""
Database and Seed Initialization Module
=======================================
SQLite persistent store for Bases, Colorant Pastes, Characterization Sessions, and Formulation Recipes.
Pre-seeded with industrial coatings and spectrophotometer calibration data.
"""

import sqlite3
import json
import os
from pathlib import Path
import numpy as np
try:
    from backend.color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
    from backend.color_engine.saunderson import saunderson_correction
    from backend.color_engine.kubelka_munk import characterize_letdown_series, reflectance_to_ks
    from backend.color_engine.rm400_parser import get_industrial_sample_datasets
    from backend.color_engine.colorimetry import reflectance_to_hex, reflectance_to_lab
except ImportError:
    from color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
    from color_engine.saunderson import saunderson_correction
    from color_engine.kubelka_munk import characterize_letdown_series, reflectance_to_ks
    from color_engine.rm400_parser import get_industrial_sample_datasets
    from color_engine.colorimetry import reflectance_to_hex, reflectance_to_lab

DB_PATH = Path(__file__).resolve().parent / "tintmatch.db"


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    cur = conn.cursor()

    # Bases table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS bases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        base_type TEXT NOT NULL,
        density REAL NOT NULL DEFAULT 1.4,
        contrast_ratio REAL NOT NULL,
        is_opaque BOOLEAN NOT NULL DEFAULT 1,
        reflectance TEXT NOT NULL,
        absorption_k TEXT NOT NULL,
        scattering_s TEXT NOT NULL,
        geometry TEXT DEFAULT '45°/0°',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Pastes table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS pastes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        color_hex TEXT NOT NULL,
        density REAL NOT NULL DEFAULT 1.3,
        unit_k TEXT NOT NULL,
        unit_s TEXT NOT NULL,
        unit_ks TEXT NOT NULL,
        geometry TEXT NOT NULL DEFAULT '45°/0°',
        characterization_version INTEGER DEFAULT 1,
        active_characterization_id INTEGER,
        mean_delta_e00 REAL NOT NULL DEFAULT 0.0,
        passed_validation BOOLEAN NOT NULL DEFAULT 1,
        characterization_base_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Characterization history
    cur.execute("""
    CREATE TABLE IF NOT EXISTS characterizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paste_id INTEGER,
        paste_name TEXT,
        base_id INTEGER,
        base_name TEXT,
        instrument TEXT DEFAULT 'X-Rite RM400 (45°/0°)',
        instrument_id INTEGER,
        geometry TEXT DEFAULT '45°/0°',
        measurement_mode TEXT DEFAULT 'SCI',
        version INTEGER DEFAULT 1,
        measurement_context_json TEXT,
        k1 REAL DEFAULT 0.04,
        k2 REAL DEFAULT 0.60,
        letdowns_json TEXT NOT NULL,
        results_json TEXT NOT NULL,
        mean_delta_e00 REAL NOT NULL,
        passed_validation BOOLEAN NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Saved formulation recipes
    cur.execute("""
    CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        base_id INTEGER NOT NULL,
        pastes_json TEXT NOT NULL,
        predicted_reflectance TEXT NOT NULL,
        lab_json TEXT NOT NULL,
        hex_color TEXT NOT NULL,
        delta_e00 REAL,
        contrast_ratio REAL,
        calculation_hash TEXT,
        profile_id TEXT DEFAULT 'color_match',
        geometry TEXT DEFAULT '45°/0°',
        characterization_version INTEGER DEFAULT 1,
        characterization_ids_json TEXT,
        quality_gate_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Instruments registry
    cur.execute("""
    CREATE TABLE IF NOT EXISTS instruments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'X-Rite RM400',
        serial_number TEXT UNIQUE,
        geometry TEXT NOT NULL DEFAULT '45°/0°',
        aperture_mm REAL NOT NULL DEFAULT 4.0,
        calibration_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Laboratory measurements archive
    cur.execute("""
    CREATE TABLE IF NOT EXISTS measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id INTEGER,
        operator TEXT DEFAULT 'Laboratory Technician',
        sample_name TEXT NOT NULL,
        geometry TEXT DEFAULT '45°/0°',
        measurement_mode TEXT DEFAULT 'SCI',
        specular_included BOOLEAN DEFAULT 1,
        is_simulation BOOLEAN DEFAULT 0,
        file_sha256 TEXT,
        raw_content TEXT,
        parsed_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(instrument_id) REFERENCES instruments(id)
    );
    """)

    # Recipe trial attempts and formulation history
    cur.execute("""
    CREATE TABLE IF NOT EXISTS recipe_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        pastes_json TEXT NOT NULL,
        predicted_reflectance TEXT,
        delta_e00 REAL,
        composite_mi REAL,
        total_load REAL,
        calculation_hash TEXT,
        geometry TEXT DEFAULT '45°/0°',
        characterization_ids_json TEXT,
        operator_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recipe_id) REFERENCES recipes(id)
    );
    """)

    # Migrate recipes table columns if upgrading from existing DB
    cur.execute("PRAGMA table_info(recipes)")
    recipe_cols = [row[1] for row in cur.fetchall()]
    if "calculation_hash" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN calculation_hash TEXT")
    if "profile_id" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN profile_id TEXT DEFAULT 'color_match'")
    if "quality_gate_json" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN quality_gate_json TEXT")
    if "geometry" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN geometry TEXT DEFAULT '45°/0°'")
    if "characterization_version" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN characterization_version INTEGER DEFAULT 1")
    if "characterization_ids_json" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN characterization_ids_json TEXT")

    # Migrate recipe_history table columns
    cur.execute("PRAGMA table_info(recipe_history)")
    hist_cols = [row[1] for row in cur.fetchall()]
    if "geometry" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN geometry TEXT DEFAULT '45°/0°'")
    if "characterization_ids_json" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN characterization_ids_json TEXT")

    # Migrate bases table columns
    cur.execute("PRAGMA table_info(bases)")
    base_cols = [row[1] for row in cur.fetchall()]
    if "geometry" not in base_cols:
        cur.execute("ALTER TABLE bases ADD COLUMN geometry TEXT DEFAULT '45°/0°'")

    # Migrate measurements table columns
    cur.execute("PRAGMA table_info(measurements)")
    meas_cols = [row[1] for row in cur.fetchall()]
    if "geometry" not in meas_cols:
        cur.execute("ALTER TABLE measurements ADD COLUMN geometry TEXT DEFAULT '45°/0°'")
    if "measurement_mode" not in meas_cols:
        cur.execute("ALTER TABLE measurements ADD COLUMN measurement_mode TEXT DEFAULT 'SCI'")
    if "specular_included" not in meas_cols:
        cur.execute("ALTER TABLE measurements ADD COLUMN specular_included BOOLEAN DEFAULT 1")
    if "is_simulation" not in meas_cols:
        cur.execute("ALTER TABLE measurements ADD COLUMN is_simulation BOOLEAN DEFAULT 0")

    # Migrate characterizations table columns
    cur.execute("PRAGMA table_info(characterizations)")
    char_cols = [row[1] for row in cur.fetchall()]
    if "geometry" not in char_cols:
        cur.execute("ALTER TABLE characterizations ADD COLUMN geometry TEXT DEFAULT '45°/0°'")
    if "measurement_mode" not in char_cols:
        cur.execute("ALTER TABLE characterizations ADD COLUMN measurement_mode TEXT DEFAULT 'SCI'")
    if "instrument_id" not in char_cols:
        cur.execute("ALTER TABLE characterizations ADD COLUMN instrument_id INTEGER")
    if "version" not in char_cols:
        cur.execute("ALTER TABLE characterizations ADD COLUMN version INTEGER DEFAULT 1")
    if "measurement_context_json" not in char_cols:
        cur.execute("ALTER TABLE characterizations ADD COLUMN measurement_context_json TEXT")

    # Migrate pastes table columns
    cur.execute("PRAGMA table_info(pastes)")
    paste_cols = [row[1] for row in cur.fetchall()]
    if "geometry" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN geometry TEXT DEFAULT '45°/0°'")
    if "characterization_version" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN characterization_version INTEGER DEFAULT 1")
    if "active_characterization_id" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN active_characterization_id INTEGER REFERENCES characterizations(id)")

    # Seed default instrument if empty
    cur.execute("SELECT COUNT(*) FROM instruments")
    if cur.fetchone()[0] == 0:
        cur.execute("""
        INSERT INTO instruments (name, model, serial_number, geometry, aperture_mm, calibration_date)
        VALUES ('Primary Lab Spectrophotometer', 'X-Rite RM400', 'XR-RM400-08941', '45°/0° Directional', 4.0, CURRENT_TIMESTAMP)
        """)

    cur.execute("SELECT COUNT(*) FROM instruments WHERE model LIKE '%DS-36D%'")
    if cur.fetchone()[0] == 0:
        cur.execute("""
        INSERT INTO instruments (name, model, serial_number, geometry, aperture_mm, calibration_date)
        VALUES ('CHNSpec Benchtop Spectrophotometer', 'CHNSpec DS-36D', 'DS36D-COM4', 'd/8° Integrating Sphere', 10.0, CURRENT_TIMESTAMP)
        """)

    conn.commit()

    # Check if bases need seeding
    cur.execute("SELECT COUNT(*) FROM bases")
    if cur.fetchone()[0] == 0:
        _seed_default_data(conn)

    conn.close()


def _seed_default_data(conn: sqlite3.Connection):
    cur = conn.cursor()

    # Base A: Opaque White (high scattering, high hiding >= 98%)
    base_a_r = [
        0.832, 0.854, 0.871, 0.882, 0.888, 0.892,
        0.895, 0.897, 0.898, 0.899, 0.898, 0.897,
        0.896, 0.894, 0.893, 0.891, 0.890, 0.889,
        0.887, 0.885, 0.884, 0.882, 0.880, 0.879,
        0.877, 0.875, 0.874, 0.872, 0.870, 0.868, 0.865
    ]
    base_a_r_int = saunderson_correction(base_a_r, k1=0.04, k2=0.60)
    base_a_s = [1.0] * 31
    base_a_k = (reflectance_to_ks(base_a_r_int) * np.array(base_a_s)).tolist()

    # Base B: Medium Semi-Opaque Base
    base_b_r = [v * 0.92 for v in base_a_r]
    base_b_r_int = saunderson_correction(base_b_r, k1=0.04, k2=0.60)
    base_b_s = [0.65] * 31
    base_b_k = (reflectance_to_ks(base_b_r_int) * np.array(base_b_s)).tolist()

    # Base C: Deep Base (Low TiO2 for dark/saturated shades)
    base_c_r = [v * 0.72 for v in base_a_r]
    base_c_r_int = saunderson_correction(base_c_r, k1=0.04, k2=0.60)
    base_c_s = [0.25] * 31
    base_c_k = (reflectance_to_ks(base_c_r_int) * np.array(base_c_s)).tolist()

    # Base D: Clear / Transparent Base (No TiO2, varnish/binder)
    base_d_r = [0.15] * 31
    base_d_r_int = saunderson_correction(base_d_r, k1=0.04, k2=0.60)
    base_d_s = [0.005] * 31
    base_d_k = (reflectance_to_ks(base_d_r_int) * np.array(base_d_s)).tolist()

    cur.execute("""
    INSERT INTO bases (name, code, base_type, density, contrast_ratio, is_opaque, reflectance, absorption_k, scattering_s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        "Base A - Opaque White", "BASE-A", "white_a", 1.45, 98.4, 1,
        json.dumps(base_a_r), json.dumps(base_a_k), json.dumps(base_a_s)
    ))
    base_a_id = cur.lastrowid

    cur.execute("""
    INSERT INTO bases (name, code, base_type, density, contrast_ratio, is_opaque, reflectance, absorption_k, scattering_s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        "Base B - Medium Tinting", "BASE-B", "medium_b", 1.35, 92.5, 0,
        json.dumps(base_b_r), json.dumps(base_b_k), json.dumps(base_b_s)
    ))

    cur.execute("""
    INSERT INTO bases (name, code, base_type, density, contrast_ratio, is_opaque, reflectance, absorption_k, scattering_s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        "Base C - Deep Base", "BASE-C", "deep_c", 1.25, 68.2, 0,
        json.dumps(base_c_r), json.dumps(base_c_k), json.dumps(base_c_s)
    ))

    cur.execute("""
    INSERT INTO bases (name, code, base_type, density, contrast_ratio, is_opaque, reflectance, absorption_k, scattering_s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        "Base D - Transparent Clear", "BASE-D", "transparent_d", 1.08, 22.1, 0,
        json.dumps(base_d_r), json.dumps(base_d_k), json.dumps(base_d_s)
    ))

    # Pre-characterize the sample pigments from our calibrated dataset!
    samples = get_industrial_sample_datasets()
    for code, pdata in samples["colorants"].items():
        res = characterize_letdown_series(
            base_reflectance=base_a_r,
            letdowns=pdata["letdowns"],
            k1=0.04,
            k2=0.60
        )

        cur.execute("""
        INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, geometry, characterization_version, mean_delta_e00, passed_validation, characterization_base_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, '45°/0°', 1, ?, ?, ?)
        """, (
            pdata["name"], pdata["code"], pdata["color_hex"], pdata["density"],
            json.dumps(res["unit_k"]), json.dumps(res["unit_s"]), json.dumps(res["unit_ks"]),
            res["mean_delta_e00"], 1 if res["passed_validation"] else 0, base_a_id
        ))
        paste_id = cur.lastrowid

        # Insert characterization record
        cur.execute("""
        INSERT INTO characterizations (paste_id, paste_name, base_id, base_name, instrument, geometry, measurement_mode, version, k1, k2, letdowns_json, results_json, mean_delta_e00, passed_validation)
        VALUES (?, ?, ?, ?, ?, '45°/0°', 'SPEX', 1, ?, ?, ?, ?, ?, ?)
        """, (
            paste_id, pdata["name"], base_a_id, "Base A - Opaque White",
            "X-Rite RM400 (45°/0° Spectrophotometer)", 0.04, 0.60,
            json.dumps(pdata["letdowns"]), json.dumps(res),
            res["mean_delta_e00"], 1 if res["passed_validation"] else 0
        ))
        char_id = cur.lastrowid
        cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (char_id, paste_id))

    # Add Carbon Black (PBk7) and Bismuth Vanadate Yellow (PY184)
    black_k = [4.8 - (i * 0.02) for i in range(31)]
    black_s = [0.04] * 31
    black_ks = [k / s for k, s in zip(black_k, black_s)]
    cur.execute("""
    INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, geometry, characterization_version, mean_delta_e00, passed_validation, characterization_base_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, '45°/0°', 1, ?, ?, ?)
    """, (
        "Carbon Black", "PBk7", "#18181b", 1.15,
        json.dumps([round(v, 4) for v in black_k]),
        json.dumps([round(v, 4) for v in black_s]),
        json.dumps([round(v, 4) for v in black_ks]),
        0.18, 1, base_a_id
    ))
    pbk7_id = cur.lastrowid
    cur.execute("""
    INSERT INTO characterizations (paste_id, paste_name, base_id, base_name, instrument, geometry, measurement_mode, version, k1, k2, letdowns_json, results_json, mean_delta_e00, passed_validation)
    VALUES (?, 'Carbon Black', ?, 'Base A - Opaque White', 'X-Rite RM400 (45°/0°)', '45°/0°', 'SPEX', 1, 0.04, 0.60, '[]', '{}', 0.18, 1)
    """, (pbk7_id, base_a_id))
    cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (cur.lastrowid, pbk7_id))

    yellow_k = [3.5 if i < 10 else (1.2 if i < 14 else 0.04) for i in range(31)]
    yellow_s = [0.15] * 31
    yellow_ks = [k / s for k, s in zip(yellow_k, yellow_s)]
    cur.execute("""
    INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, geometry, characterization_version, mean_delta_e00, passed_validation, characterization_base_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, '45°/0°', 1, ?, ?, ?)
    """, (
        "Bismuth Vanadate Yellow", "PY184", "#eab308", 1.85,
        json.dumps([round(v, 4) for v in yellow_k]),
        json.dumps([round(v, 4) for v in yellow_s]),
        json.dumps([round(v, 4) for v in yellow_ks]),
        0.22, 1, base_a_id
    ))
    py184_id = cur.lastrowid
    cur.execute("""
    INSERT INTO characterizations (paste_id, paste_name, base_id, base_name, instrument, geometry, measurement_mode, version, k1, k2, letdowns_json, results_json, mean_delta_e00, passed_validation)
    VALUES (?, 'Bismuth Vanadate Yellow', ?, 'Base A - Opaque White', 'X-Rite RM400 (45°/0°)', '45°/0°', 'SPEX', 1, 0.04, 0.60, '[]', '{}', 0.22, 1)
    """, (py184_id, base_a_id))
    cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (cur.lastrowid, py184_id))

    # Quinacridone Magenta PR122
    magenta_k = [0.4 if i < 8 else (3.8 if 10 <= i <= 18 else 0.15) for i in range(31)]
    magenta_s = [0.08] * 31
    magenta_ks = [k / s for k, s in zip(magenta_k, magenta_s)]
    cur.execute("""
    INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, geometry, characterization_version, mean_delta_e00, passed_validation, characterization_base_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, '45°/0°', 1, ?, ?, ?)
    """, (
        "Quinacridone Magenta", "PR122", "#db2777", 1.30,
        json.dumps([round(v, 4) for v in magenta_k]),
        json.dumps([round(v, 4) for v in magenta_s]),
        json.dumps([round(v, 4) for v in magenta_ks]),
        0.24, 1, base_a_id
    ))
    pr122_id = cur.lastrowid
    cur.execute("""
    INSERT INTO characterizations (paste_id, paste_name, base_id, base_name, instrument, geometry, measurement_mode, version, k1, k2, letdowns_json, results_json, mean_delta_e00, passed_validation)
    VALUES (?, 'Quinacridone Magenta', ?, 'Base A - Opaque White', 'X-Rite RM400 (45°/0°)', '45°/0°', 'SPEX', 1, 0.04, 0.60, '[]', '{}', 0.24, 1)
    """, (pr122_id, base_a_id))
    cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (cur.lastrowid, pr122_id))

    conn.commit()
