"""
TintMatch PRO - Application Launcher
====================================
Launches the FastAPI backend serving both the REST API and the built React SPA frontend.

Usage:
    python run_server.py
"""

import sys
import uvicorn
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from backend.database.db import init_db

if __name__ == "__main__":
    print("=" * 70)
    print("  TintMatch PRO - Spektrofotometrik Renklendirici ve Baz Karakterizasyonu")
    print("  X-Rite RM400 Ham Veri & CCM (Computer Color Matching) Motoru")
    print("=" * 70)
    print("[*] Veritabanı ve kalibrasyon tabloları kontrol ediliyor...")
    init_db()
    print("[*] Başlatılıyor: http://127.0.0.1:8000")
    print("    - Web Arayüzü (SPA): http://127.0.0.1:8000")
    print("    - Swagger API Dokümantasyonu: http://127.0.0.1:8000/docs")
    print("=" * 70)

    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info"
    )
