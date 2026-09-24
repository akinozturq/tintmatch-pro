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


app = FastAPI(
    title="TintMatch Pro API",
    description="B2B Spectrophotometric Colorant Paste and Base Characterization / CCM (Computer Color Matching) Web API",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for local Vite dev server and external clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
        "service": "TintMatch Pro CCM Engine",
        "version": "1.0.0",
        "spectral_channels": 31,
        "wavelength_range": "400-700 nm @ 10 nm",
        "validation_standard": "CIEDE2000 ΔE00 < 0.3 (ISO 18314)"
    }


# Mount built frontend SPA static files if directory exists
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
