"""Centralised config. Read env once at process start."""
from __future__ import annotations
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # Auth (single user, shared token)
    operator_token: str = os.getenv("OPERATOR_TOKEN", "change-me")

    # Supabase
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    supabase_bucket: str = os.getenv("SUPABASE_STORAGE_BUCKET", "operator-profile")

    # Brain (Groq Cloud — the only model in the stack)
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    # Browser
    camoufox_profile_dir: str = os.getenv("CAMOUFOX_PROFILE_DIR", "./.camoufox-profile")

    # Perception
    max_elements: int = int(os.getenv("MAX_ELEMENTS", "120"))

    # Loop guardrails
    max_steps_per_task: int = int(os.getenv("MAX_STEPS_PER_TASK", "200"))
    session_restart_seconds: int = int(os.getenv("SESSION_RESTART_SECONDS", "3600"))


settings = Settings()
