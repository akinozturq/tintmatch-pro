"""
TintMatch Pro - FastAPI Backend Application
===========================================
B2B Spectrophotometric Colorant Paste and Base Characterization / CCM System.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .database.db import init_db
from .routes.bases import router as bases_router
from .routes.pastes import router as pastes_router
from .routes.characterization import router as characterization_router
from .routes.formulation import router as formulation_router
from .routes.reports import router as reports_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables and seed calibration datasets
    init_db()
    yield


import os

app = FastAPI(
    title="TintMatch Pro API",
    description="B2B Spectrophotometric Colorant Paste and Base Characterization / CCM (Computer Color Matching) Web API",
    version="2.0.0",
    lifespan=lifespan
)

# Configurable CORS for enterprise deployment
allowed_origins_env = os.environ.get("ALLOWED_ORIGINS")
if allowed_origins_env:
    origins = [orig.strip() for orig in allowed_origins_env.split(",") if orig.strip()]
else:
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "*"
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(bases_router)
app.include_router(pastes_router)
app.include_router(characterization_router)
app.include_router(formulation_router)
app.include_router(reports_router)


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "TintMatch Pro CCM Engine 2.0",
        "version": "2.0.0",
        "spectral_channels": 31,
        "wavelength_range": "400-700 nm @ 10 nm",
        "optimizer": "SLSQP Constrained Multi-Profile Optimizer",
        "profiles": ["color_match", "light_stability", "economy"],
        "validation_standard": "ISO 18314 Analytical Colorimetry Calculation Standards"
    }


# Mount built frontend SPA static files if directory exists
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
