"""Text-only Mistral Large client. No images ever go through this path."""
from __future__ import annotations
import json
from typing import Any
import httpx
from ..config import settings
from .prompts import PLANNER_SYSTEM, SUMMARIZER_SYSTEM

API_BASE = "https://api.mistral.ai/v1"


class MistralError(RuntimeError):
    pass


async def _chat(messages: list[dict], *, model: str | None = None,
                temperature: float = 0.2, response_format: dict | None = None) -> str:
    if not settings.mistral_api_key:
        raise MistralError("MISTRAL_API_KEY not set")
    payload: dict[str, Any] = {
        "model": model or settings.mistral_model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{API_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
            json=payload,
        )
        if r.status_code >= 400:
            raise MistralError(f"Mistral {r.status_code}: {r.text[:500]}")
        data = r.json()
        return data["choices"][0]["message"]["content"]


async def plan_next_action(*, goal: str, task_state: dict, perception: dict,
                            page_text: str, memory_rows: list[dict],
                            recent_actions: list[dict]) -> dict:
    """Ask the brain for the next action. Returns the parsed JSON action."""
    user_msg = json.dumps({
        "goal": goal,
        "task_state": task_state,
        "perception": perception,
        "page_text": page_text[:4000],
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
        raise MistralError(f"Planner did not return JSON: {raw[:300]}") from e


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
