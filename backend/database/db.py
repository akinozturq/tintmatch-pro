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
    from backend.color_engine.spectral_parser import get_industrial_sample_datasets
    from backend.color_engine.colorimetry import reflectance_to_hex, reflectance_to_lab
except ImportError:
    from color_engine.constants import WAVELENGTHS, N_WAVELENGTHS
    from color_engine.saunderson import saunderson_correction
    from color_engine.kubelka_munk import characterize_letdown_series, reflectance_to_ks
    from color_engine.spectral_parser import get_industrial_sample_datasets
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
        measurement_mode TEXT DEFAULT 'SCI',
        optical_system TEXT DEFAULT 'bootstrap_v1',
        is_bootstrap_base BOOLEAN DEFAULT 0,
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
        measurement_mode TEXT NOT NULL DEFAULT 'SCI',
        optical_system TEXT NOT NULL DEFAULT 'bootstrap_v1',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
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
        instrument TEXT DEFAULT 'CHNSpec DS-36D (d/8°)',
        instrument_id INTEGER,
        geometry TEXT DEFAULT 'd/8°',
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
        target_reflectance TEXT,
        lab_json TEXT NOT NULL,
        hex_color TEXT NOT NULL,
        delta_e00 REAL,
        contrast_ratio REAL,
        calculation_hash TEXT,
        calculation_id TEXT,
        engine_version TEXT DEFAULT '2.2.0',
        profile_id TEXT DEFAULT 'color_match',
        geometry TEXT DEFAULT '45°/0°',
        characterization_version INTEGER DEFAULT 1,
        characterization_ids_json TEXT,
        quality_gate_json TEXT,
        tolerance_profile_id TEXT DEFAULT 'industrial',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Instruments registry
    cur.execute("""
    CREATE TABLE IF NOT EXISTS instruments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'CHNSpec DS-36D',
        serial_number TEXT UNIQUE,
        geometry TEXT NOT NULL DEFAULT 'd/8°',
        aperture_mm REAL NOT NULL DEFAULT 10.0,
        calibration_date TIMESTAMP,
        calibration_expiry_hours INTEGER DEFAULT 8,
        last_calibrated_at TIMESTAMP,
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
        calibration_status TEXT DEFAULT 'VALID',
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
        target_reflectance TEXT,
        delta_e00 REAL,
        composite_mi REAL,
        total_load REAL,
        calculation_hash TEXT,
        calculation_id TEXT,
        geometry TEXT DEFAULT '45°/0°',
        characterization_ids_json TEXT,
        tolerance_profile_id TEXT DEFAULT 'industrial',
        is_simulation BOOLEAN DEFAULT 0,
        is_golden_batch BOOLEAN DEFAULT 0,
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
    if "calculation_id" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN calculation_id TEXT")
    if "engine_version" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN engine_version TEXT DEFAULT '2.2.0'")
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
    if "input_hash" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN input_hash TEXT")
    if "output_hash" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN output_hash TEXT")
    if "batch_size_g" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN batch_size_g REAL DEFAULT 1000.0")
    if "scale_resolution_g" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN scale_resolution_g REAL DEFAULT 0.01")
    if "recipe_confidence_json" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN recipe_confidence_json TEXT")
    if "target_reflectance" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN target_reflectance TEXT")
    if "tolerance_profile_id" not in recipe_cols:
        cur.execute("ALTER TABLE recipes ADD COLUMN tolerance_profile_id TEXT DEFAULT 'industrial'")

    # Migrate recipe_history table columns
    cur.execute("PRAGMA table_info(recipe_history)")
    hist_cols = [row[1] for row in cur.fetchall()]
    if "geometry" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN geometry TEXT DEFAULT '45°/0°'")
    if "characterization_ids_json" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN characterization_ids_json TEXT")
    if "calculation_id" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN calculation_id TEXT")
    if "batch_size_g" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN batch_size_g REAL DEFAULT 1000.0")
    if "scale_resolution_g" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN scale_resolution_g REAL DEFAULT 0.01")
    if "actual_dispensed_json" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN actual_dispensed_json TEXT")
    if "measured_reflectance" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN measured_reflectance TEXT")
    if "target_reflectance" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN target_reflectance TEXT")
    if "measured_lab_json" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN measured_lab_json TEXT")
    if "de00_predicted_vs_measured" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN de00_predicted_vs_measured REAL")
    if "de00_target_vs_measured" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN de00_target_vs_measured REAL")
    if "de00_target_vs_predicted" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN de00_target_vs_predicted REAL")
    if "outcome" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN outcome TEXT DEFAULT 'PENDING'")
    if "addback_suggestion_json" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN addback_suggestion_json TEXT")
    if "is_simulation" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN is_simulation BOOLEAN DEFAULT 0")
    if "is_golden_batch" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN is_golden_batch BOOLEAN DEFAULT 0")
    if "tolerance_profile_id" not in hist_cols:
        cur.execute("ALTER TABLE recipe_history ADD COLUMN tolerance_profile_id TEXT DEFAULT 'industrial'")

    # Migrate instruments table columns
    cur.execute("PRAGMA table_info(instruments)")
    inst_cols = [row[1] for row in cur.fetchall()]
    if "calibration_expiry_hours" not in inst_cols:
        cur.execute("ALTER TABLE instruments ADD COLUMN calibration_expiry_hours INTEGER DEFAULT 8")
    if "last_calibrated_at" not in inst_cols:
        cur.execute("ALTER TABLE instruments ADD COLUMN last_calibrated_at TIMESTAMP")

    # Migrate bases table columns
    cur.execute("PRAGMA table_info(bases)")
    base_cols = [row[1] for row in cur.fetchall()]
    if "geometry" not in base_cols:
        cur.execute("ALTER TABLE bases ADD COLUMN geometry TEXT DEFAULT '45°/0°'")
    if "measurement_mode" not in base_cols:
        cur.execute("ALTER TABLE bases ADD COLUMN measurement_mode TEXT DEFAULT 'SCI'")
    if "optical_system" not in base_cols:
        cur.execute("ALTER TABLE bases ADD COLUMN optical_system TEXT DEFAULT 'bootstrap_v1'")
    if "is_bootstrap_base" not in base_cols:
        cur.execute("ALTER TABLE bases ADD COLUMN is_bootstrap_base BOOLEAN DEFAULT 0")

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
    if "calibration_status" not in meas_cols:
        cur.execute("ALTER TABLE measurements ADD COLUMN calibration_status TEXT DEFAULT 'VALID'")

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
    if "cost_per_kg" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN cost_per_kg REAL DEFAULT 150.0")
    if "measurement_mode" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN measurement_mode TEXT NOT NULL DEFAULT 'SCI'")
    if "optical_system" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN optical_system TEXT NOT NULL DEFAULT 'bootstrap_v1'")
    if "status" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'")
    if "bootstrap_role" not in paste_cols:
        cur.execute("ALTER TABLE pastes ADD COLUMN bootstrap_role TEXT DEFAULT NULL")

    # Synchronize status: Auto-reject pastes that failed validation
    cur.execute("UPDATE pastes SET status = 'REJECTED' WHERE passed_validation = 0")
    cur.execute("UPDATE pastes SET status = 'ACTIVE' WHERE passed_validation = 1 AND (status IS NULL OR status = '')")

    # Set bootstrap roles for standard seeded records if null
    cur.execute("UPDATE pastes SET bootstrap_role = 'black' WHERE code = 'PBk7' AND bootstrap_role IS NULL")
    cur.execute("UPDATE bases SET is_bootstrap_base = 1 WHERE code = 'BASE-D' AND (is_bootstrap_base = 0 OR is_bootstrap_base IS NULL)")

    cur.execute("SELECT id FROM pastes WHERE code = 'PW6'")
    if not cur.fetchone():
        white_k = [0.015 + (i * 0.001) for i in range(31)]
        white_s = [1.25 - (i * 0.008) for i in range(31)]
        white_ks = [k / s for k, s in zip(white_k, white_s)]
        cur.execute("SELECT id FROM bases WHERE code = 'BASE-D'")
        base_d_r = cur.fetchone()
        base_d_id = base_d_r[0] if base_d_r else 1
        cur.execute("""
        INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, geometry, measurement_mode, optical_system, status, bootstrap_role, characterization_version, mean_delta_e00, passed_validation, characterization_base_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'd/8°', 'SCI', 'bootstrap_v1', 'ACTIVE', 'white', 1, 0.12, 1, ?)
        """, (
            "Titanium Dioxide White", "PW6", "#f8fafc", 2.10,
            json.dumps([round(v, 4) for v in white_k]),
            json.dumps([round(v, 4) for v in white_s]),
            json.dumps([round(v, 4) for v in white_ks]),
            base_d_id
        ))
        pw6_id = cur.lastrowid
        cur.execute("""
        INSERT INTO characterizations (paste_id, paste_name, base_id, base_name, instrument, geometry, measurement_mode, version, k1, k2, letdowns_json, results_json, mean_delta_e00, passed_validation)
        VALUES (?, 'Titanium Dioxide White', ?, 'Base D - Transparent Clear', 'CHNSpec DS-36D (d/8°)', 'd/8°', 'SCI', 1, 0.04, 0.60, '[]', '{}', 0.12, 1)
        """, (pw6_id, base_d_id))
        cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (cur.lastrowid, pw6_id))

    # Can Sizes table (Pre-filled can sizes with headspace check)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS can_sizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        nominal_volume_l REAL NOT NULL,
        default_base_fill_l REAL NOT NULL,
        max_colorant_volume_l REAL NOT NULL,
        package_cost REAL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Products table (e.g. PT.505.25 - Süper Mat İç Cephe)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        product_type TEXT DEFAULT 'interior_matte',
        voc_limit REAL DEFAULT 30.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Product Abstract Bases mapping (SW, W, TR -> physical bases)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS product_bases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        abstract_base_code TEXT NOT NULL,
        base_id INTEGER NOT NULL REFERENCES bases(id),
        specific_gravity REAL NOT NULL DEFAULT 1.45,
        cost_per_liter REAL DEFAULT 45.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, abstract_base_code)
    );
    """)

    # Color Cards table (e.g. RAL Classic K7, NCS S 1950)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS color_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Card Colors table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS card_colors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL REFERENCES color_cards(id),
        color_code TEXT NOT NULL,
        color_name TEXT NOT NULL,
        hex TEXT NOT NULL,
        lab_json TEXT NOT NULL,
        reflectance_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(card_id, color_code)
    );
    """)

    # Seed default instrument if empty
    cur.execute("SELECT COUNT(*) FROM instruments")
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

    # Check if configuration data needs seeding
    cur.execute("SELECT COUNT(*) FROM can_sizes")
    has_cans = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM products")
    has_products = cur.fetchone()[0]
    if has_cans == 0 or has_products == 0:
        _seed_configuration_data(conn)

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
        VALUES (?, ?, ?, ?, ?, 'd/8°', 'SCI', 1, ?, ?, ?, ?, ?, ?)
        """, (
            paste_id, pdata["name"], base_a_id, "Base A - Opaque White",
            "CHNSpec DS-36D (d/8° Spectrophotometer)", 0.04, 0.60,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, 'd/8°', 1, ?, ?, ?)
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
    VALUES (?, 'Carbon Black', ?, 'Base A - Opaque White', 'CHNSpec DS-36D (d/8°)', 'd/8°', 'SCI', 1, 0.04, 0.60, '[]', '{}', 0.18, 1)
    """, (pbk7_id, base_a_id))
    cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (cur.lastrowid, pbk7_id))

    yellow_k = [3.5 if i < 10 else (1.2 if i < 14 else 0.04) for i in range(31)]
    yellow_s = [0.15] * 31
    yellow_ks = [k / s for k, s in zip(yellow_k, yellow_s)]
    cur.execute("""
    INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, geometry, characterization_version, mean_delta_e00, passed_validation, characterization_base_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'd/8°', 1, ?, ?, ?)
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
    VALUES (?, 'Bismuth Vanadate Yellow', ?, 'Base A - Opaque White', 'CHNSpec DS-36D (d/8°)', 'd/8°', 'SCI', 1, 0.04, 0.60, '[]', '{}', 0.22, 1)
    """, (py184_id, base_a_id))
    cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (cur.lastrowid, py184_id))

    # Quinacridone Magenta PR122
    magenta_k = [0.4 if i < 8 else (3.8 if 10 <= i <= 18 else 0.15) for i in range(31)]
    magenta_s = [0.08] * 31
    magenta_ks = [k / s for k, s in zip(magenta_k, magenta_s)]
    cur.execute("""
    INSERT INTO pastes (name, code, color_hex, density, unit_k, unit_s, unit_ks, geometry, characterization_version, mean_delta_e00, passed_validation, characterization_base_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'd/8°', 1, ?, ?, ?)
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
    VALUES (?, 'Quinacridone Magenta', ?, 'Base A - Opaque White', 'CHNSpec DS-36D (d/8°)', 'd/8°', 'SCI', 1, 0.04, 0.60, '[]', '{}', 0.24, 1)
    """, (pr122_id, base_a_id))
    cur.execute("UPDATE pastes SET active_characterization_id = ? WHERE id = ?", (cur.lastrowid, pr122_id))

    conn.commit()


def _seed_configuration_data(conn: sqlite3.Connection):
    cur = conn.cursor()

    # 1. Pre-filled Can Sizes
    can_sizes_data = [
        ("1L", "1 Litre Kutu", 1.0, 0.90, 0.10, 15.0),
        ("2.5L", "2.5 Litre Galon", 2.5, 2.30, 0.25, 28.0),
        ("7.5L", "7.5 Litre Kova", 7.5, 7.00, 0.65, 55.0),
        ("15L", "15 Litre Standart Teneke", 15.0, 14.00, 1.20, 95.0),
        ("200L", "200 Litre Sanayi Varili", 200.0, 185.00, 18.00, 650.0),
    ]
    cur.executemany("""
    INSERT OR IGNORE INTO can_sizes (code, name, nominal_volume_l, default_base_fill_l, max_colorant_volume_l, package_cost)
    VALUES (?, ?, ?, ?, ?, ?)
    """, can_sizes_data)

    # 2. Products & Abstract Bases (PT.505.25 -> SW, W, TR)
    cur.execute("SELECT id FROM bases WHERE code LIKE 'BASE-A%' ORDER BY id ASC")
    base_a_row = cur.fetchone()
    base_a_id = base_a_row[0] if base_a_row else 1

    cur.execute("SELECT id FROM bases WHERE code LIKE 'BASE-B%' ORDER BY id ASC")
    base_b_row = cur.fetchone()
    base_b_id = base_b_row[0] if base_b_row else 2

    cur.execute("SELECT id FROM bases WHERE code LIKE 'BASE-D%' ORDER BY id ASC")
    base_d_row = cur.fetchone()
    base_d_id = base_d_row[0] if base_d_row else 4

    cur.execute("""
    INSERT OR IGNORE INTO products (code, name, product_type, voc_limit)
    VALUES ('PT.505.25', 'PT.505.25 Endüstriyel Mat Boya Serisi', 'interior_matte', 25.0)
    """)
    cur.execute("SELECT id FROM products WHERE code = 'PT.505.25'")
    prod_row = cur.fetchone()
    if prod_row:
        prod_id = prod_row[0]
        # Abstract Bases SW, W, TR
        cur.executemany("""
        INSERT OR IGNORE INTO product_bases (product_id, abstract_base_code, base_id, specific_gravity, cost_per_liter)
        VALUES (?, ?, ?, ?, ?)
        """, [
            (prod_id, "SW", base_a_id, 1.48, 52.0),
            (prod_id, "W", base_b_id, 1.38, 46.0),
            (prod_id, "TR", base_d_id, 1.05, 65.0),
        ])

    # 3. RAL Classic K7 Color Card & Reference Spectral Colors
    cur.execute("""
    INSERT OR IGNORE INTO color_cards (code, name, description)
    VALUES ('RAL-CLASSIC-K7', 'RAL Classic K7 Koleksiyonu', 'Endüstriyel standart RAL K7 renk kartelası referans spektrumları ve CIELAB koordinatları')
    """)
    cur.execute("SELECT id FROM color_cards WHERE code = 'RAL-CLASSIC-K7'")
    card_row = cur.fetchone()
    if card_row:
        card_id = card_row[0]
        ral_colors = [
            (
                "RAL 7035", "Işık Grisi (Light Grey)", "#D7D7D7",
                {"L": 83.5, "a": -0.8, "b": 2.2},
                [0.612, 0.625, 0.638, 0.647, 0.655, 0.661, 0.665, 0.668, 0.670, 0.672, 0.673, 0.674, 0.675, 0.675, 0.675, 0.674, 0.674, 0.673, 0.672, 0.671, 0.670, 0.669, 0.668, 0.667, 0.666, 0.665, 0.664, 0.663, 0.662, 0.661, 0.660]
            ),
            (
                "RAL 9010", "Saf Beyaz (Pure White)", "#F7F9EF",
                {"L": 94.2, "a": -0.6, "b": 4.8},
                [0.780, 0.810, 0.835, 0.852, 0.865, 0.874, 0.880, 0.885, 0.888, 0.890, 0.892, 0.893, 0.894, 0.894, 0.893, 0.892, 0.891, 0.890, 0.888, 0.887, 0.885, 0.883, 0.881, 0.880, 0.878, 0.876, 0.875, 0.873, 0.871, 0.869, 0.866]
            ),
            (
                "RAL 7016", "Antrasit Gri (Anthracite Grey)", "#383E42",
                {"L": 26.5, "a": -0.9, "b": -2.8},
                [0.065, 0.064, 0.063, 0.062, 0.061, 0.060, 0.059, 0.058, 0.057, 0.056, 0.055, 0.054, 0.053, 0.052, 0.052, 0.051, 0.051, 0.050, 0.050, 0.049, 0.049, 0.048, 0.048, 0.048, 0.047, 0.047, 0.047, 0.046, 0.046, 0.046, 0.045]
            ),
            (
                "RAL 9005", "Simsiyah (Jet Black)", "#0E0E10",
                {"L": 7.2, "a": 0.2, "b": -0.5},
                [0.012, 0.012, 0.011, 0.011, 0.011, 0.010, 0.010, 0.010, 0.010, 0.009, 0.009, 0.009, 0.009, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007]
            ),
            (
                "RAL 5015", "Gök Mavisi (Sky Blue)", "#2271B3",
                {"L": 46.8, "a": -7.5, "b": -38.2},
                [0.420, 0.445, 0.460, 0.450, 0.420, 0.360, 0.280, 0.210, 0.160, 0.130, 0.110, 0.095, 0.085, 0.078, 0.072, 0.068, 0.065, 0.062, 0.060, 0.058, 0.056, 0.055, 0.054, 0.054, 0.054, 0.054, 0.055, 0.056, 0.058, 0.060, 0.062]
            ),
            (
                "RAL 3020", "Trafik Kırmızı (Traffic Red)", "#CC0605",
                {"L": 43.5, "a": 62.4, "b": 39.1},
                [0.045, 0.044, 0.043, 0.042, 0.042, 0.041, 0.041, 0.040, 0.040, 0.040, 0.041, 0.042, 0.045, 0.052, 0.075, 0.130, 0.250, 0.450, 0.650, 0.760, 0.810, 0.835, 0.848, 0.855, 0.860, 0.864, 0.867, 0.870, 0.872, 0.874, 0.876]
            ),
            (
                "RAL 1021", "Kolza Sarısı (Rape Yellow)", "#F6B600",
                {"L": 76.2, "a": 10.5, "b": 78.4},
                [0.042, 0.043, 0.044, 0.045, 0.048, 0.055, 0.075, 0.125, 0.240, 0.480, 0.700, 0.810, 0.845, 0.858, 0.865, 0.870, 0.873, 0.875, 0.877, 0.879, 0.880, 0.881, 0.882, 0.883, 0.884, 0.885, 0.886, 0.887, 0.888, 0.889, 0.890]
            ),
            (
                "RAL 6005", "Yosun Yeşili (Moss Green)", "#114232",
                {"L": 28.4, "a": -18.2, "b": 6.5},
                [0.048, 0.049, 0.052, 0.058, 0.070, 0.092, 0.120, 0.135, 0.130, 0.110, 0.085, 0.065, 0.052, 0.045, 0.042, 0.040, 0.039, 0.038, 0.038, 0.037, 0.037, 0.037, 0.037, 0.037, 0.038, 0.038, 0.039, 0.040, 0.041, 0.042, 0.044]
            ),
            (
                "RAL 8017", "Çikolata Kahve (Chocolate Brown)", "#442F29",
                {"L": 22.8, "a": 8.5, "b": 7.8},
                [0.032, 0.032, 0.032, 0.032, 0.033, 0.034, 0.036, 0.038, 0.041, 0.045, 0.050, 0.056, 0.063, 0.072, 0.082, 0.095, 0.112, 0.132, 0.155, 0.178, 0.200, 0.218, 0.232, 0.244, 0.254, 0.262, 0.270, 0.276, 0.282, 0.288, 0.294]
            ),
            (
                "RAL 7040", "Pencere Grisi (Window Grey)", "#9DA3A6",
                {"L": 65.8, "a": -1.2, "b": -2.1},
                [0.380, 0.395, 0.408, 0.418, 0.426, 0.432, 0.436, 0.439, 0.441, 0.442, 0.443, 0.444, 0.444, 0.444, 0.443, 0.442, 0.441, 0.440, 0.439, 0.438, 0.437, 0.435, 0.434, 0.432, 0.431, 0.429, 0.428, 0.426, 0.425, 0.423, 0.421]
            ),
        ]
        for color_code, color_name, hex_val, lab_val, refl in ral_colors:
            cur.execute("""
            INSERT OR IGNORE INTO card_colors (card_id, color_code, color_name, hex, lab_json, reflectance_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (card_id, color_code, color_name, hex_val, json.dumps(lab_val), json.dumps(refl)))

    conn.commit()
