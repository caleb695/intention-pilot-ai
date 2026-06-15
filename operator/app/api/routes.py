"""HTTP + SSE surface. One user, shared token."""
from __future__ import annotations
import json
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..config import settings
from ..loop import loop
from ..memory import supabase as mem

router = APIRouter(prefix="/api")


def _auth(token: str | None) -> None:
    if token != settings.operator_token:
        raise HTTPException(401, "Bad token")


class StartReq(BaseModel):
    goal: str


@router.post("/task")
async def start_task(req: StartReq, x_operator_token: str | None = Header(None)):
    _auth(x_operator_token)
    await loop.start(req.goal)
    return {"ok": True, "task_id": loop.task_id}


@router.post("/resume")
async def resume(x_operator_token: str | None = Header(None)):
    _auth(x_operator_token)
    loop.resume()
    return {"ok": True}


@router.post("/cancel")
async def cancel(x_operator_token: str | None = Header(None)):
    _auth(x_operator_token)
    loop.cancel()
    return {"ok": True}


@router.get("/status")
async def status(x_operator_token: str | None = Header(None)):
    _auth(x_operator_token)
    return {
        "running": loop.running,
        "paused_for_user": loop.paused_for_user,
        "handoff_message": loop.handoff_message,
        "task_id": loop.task_id,
        "goal": loop.goal,
    }


@router.get("/facts")
async def facts(x_operator_token: str | None = Header(None)):
    _auth(x_operator_token)
    return {"facts": mem.list_facts()}


@router.get("/events")
async def events(request: Request, token: str | None = None):
    # SSE: token in querystring because EventSource can't set headers.
    _auth(token)

    async def gen():
        async for evt in loop.events():
            if await request.is_disconnected():
                break
            yield f"data: {json.dumps(evt)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
