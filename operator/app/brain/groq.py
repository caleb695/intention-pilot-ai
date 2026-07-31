"""Groq Cloud client — the single brain.

Text-only. Perception comes from the accessibility/DOM tree the browser
driver extracts, so no vision model is involved anywhere in the loop.
"""
from __future__ import annotations
import json
from typing import Any
import httpx

from ..config import settings
from .prompts import PLANNER_SYSTEM, SUMMARIZER_SYSTEM

API_BASE = "https://api.groq.com/openai/v1"


class BrainError(RuntimeError):
    pass


# Back-compat alias so older imports keep working.
GroqError = BrainError


async def _chat(messages: list[dict], *, model: str | None = None,
                temperature: float = 0.2, response_format: dict | None = None) -> str:
    if not settings.groq_api_key:
        raise BrainError("GROQ_API_KEY not set")
    payload: dict[str, Any] = {
        "model": model or settings.groq_model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{API_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json=payload,
        )
        if r.status_code >= 400:
            raise BrainError(f"Groq {r.status_code}: {r.text[:500]}")
        data = r.json()
        return data["choices"][0]["message"]["content"]


async def plan_next_action(*, goal: str, task_state: dict, perception: dict,
                            page_text: str, elements: list[dict],
                            memory_rows: list[dict],
                            recent_actions: list[dict]) -> dict:
    """Ask the brain for the next action. Returns the parsed JSON action."""
    user_msg = json.dumps({
        "goal": goal,
        "task_state": task_state,
        "last_result": perception,
        "page_text": page_text[:6000],
        "elements": elements[:120],
        "memory": memory_rows[-20:],
        "recent_actions": recent_actions[-8:],
    }, ensure_ascii=False)

    raw = await _chat(
        [
            {"role": "system", "content": PLANNER_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise BrainError(f"Planner did not return JSON: {raw[:300]}") from e


async def summarise(goal: str, transcript: list[dict]) -> str:
    return await _chat(
        [
            {"role": "system", "content": SUMMARIZER_SYSTEM},
            {"role": "user", "content": json.dumps(
                {"goal": goal, "transcript": transcript[-40:]}, ensure_ascii=False
            )},
        ],
        temperature=0.3,
    )
