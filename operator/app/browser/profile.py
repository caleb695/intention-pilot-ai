"""Snapshot the Camoufox profile dir to Supabase Storage and restore it on boot.

HF Space disk is ephemeral across sleeps/restarts, but cookies + localStorage
are the entire reason we run a persistent profile. We zip the profile dir
after every successful login / cookie change, and unzip on boot.
"""
from __future__ import annotations
import asyncio
import io
import os
import zipfile
from pathlib import Path

from ..config import settings
from ..memory.supabase import storage


PROFILE_KEY = "camoufox-profile.zip"


def _zip_dir(root: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in root.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(root))
    return buf.getvalue()


def _unzip_to(data: bytes, root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(root)


async def restore() -> bool:
    root = Path(settings.camoufox_profile_dir)
    if root.exists() and any(root.iterdir()):
        return False  # already have a local profile
    data = await asyncio.to_thread(storage.download, settings.supabase_bucket, PROFILE_KEY)
    if not data:
        return False
    await asyncio.to_thread(_unzip_to, data, root)
    return True


async def snapshot() -> None:
    root = Path(settings.camoufox_profile_dir)
    if not root.exists():
        return
    data = await asyncio.to_thread(_zip_dir, root)
    await asyncio.to_thread(
        storage.upload, settings.supabase_bucket, PROFILE_KEY, data, upsert=True
    )
