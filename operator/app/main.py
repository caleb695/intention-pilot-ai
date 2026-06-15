"""FastAPI entrypoint. Serves the API and the mobile-first web UI."""
from __future__ import annotations
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.routes import router as api_router
from .browser.profile import restore as restore_profile

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Pull the browser profile from Supabase Storage before first request.
    try:
        await restore_profile()
    except Exception as e:  # noqa: BLE001
        print(f"[startup] profile restore failed: {e}")
    yield


app = FastAPI(title="Operator", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # single user; locked down by OPERATOR_TOKEN
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
