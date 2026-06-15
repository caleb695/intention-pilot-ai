"""Thin Supabase wrapper for memory + storage. Service-role; server-only."""
from __future__ import annotations
from typing import Any
from supabase import create_client, Client

from ..config import settings


def _client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


_sb: Client | None = None


def sb() -> Client:
    global _sb
    if _sb is None:
        _sb = _client()
    return _sb


# ---- tables -----------------------------------------------------------

def list_facts(limit: int = 200) -> list[dict]:
    r = sb().table("op_facts").select("*").order("updated_at", desc=True).limit(limit).execute()
    return r.data or []


def add_fact(kind: str, content: str) -> None:
    sb().table("op_facts").insert({"kind": kind, "content": content}).execute()


def create_task(goal: str) -> dict:
    r = sb().table("op_tasks").insert({"goal": goal, "status": "running"}).execute()
    return r.data[0]


def update_task(task_id: str, **fields: Any) -> None:
    sb().table("op_tasks").update(fields).eq("id", task_id).execute()


def write_checkpoint(task_id: str, state: dict) -> None:
    # Latest-only: upsert by task_id.
    sb().table("op_checkpoints").upsert(
        {"task_id": task_id, "state": state}, on_conflict="task_id"
    ).execute()


def read_checkpoint(task_id: str) -> dict | None:
    r = sb().table("op_checkpoints").select("state").eq("task_id", task_id).limit(1).execute()
    return (r.data or [{}])[0].get("state") if r.data else None


def clear_checkpoint(task_id: str) -> None:
    sb().table("op_checkpoints").delete().eq("task_id", task_id).execute()


# ---- storage (profile snapshots) --------------------------------------

class _Storage:
    def download(self, bucket: str, key: str) -> bytes | None:
        try:
            return sb().storage.from_(bucket).download(key)
        except Exception:
            return None

    def upload(self, bucket: str, key: str, data: bytes, *, upsert: bool = True) -> None:
        sb().storage.from_(bucket).upload(
            key, data, {"upsert": "true" if upsert else "false",
                        "content-type": "application/zip"}
        )


storage = _Storage()
