"""The perception → plan → act loop.

One task at a time. Cooperative cancellation via `Task.cancel`. Streams
status events out through an asyncio.Queue the API layer subscribes to.
"""
from __future__ import annotations
import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .brain.mistral import plan_next_action, summarise, MistralError
from .browser.camoufox import driver
from .browser.profile import snapshot as snapshot_profile
from .config import settings
from .eyes import moondream
from .memory import supabase as mem


@dataclass
class Loop:
    task_id: str = ""
    goal: str = ""
    running: bool = False
    paused_for_user: bool = False
    handoff_message: str = ""
    transcript: list[dict] = field(default_factory=list)
    _events: asyncio.Queue = field(default_factory=asyncio.Queue)
    _resume: asyncio.Event = field(default_factory=asyncio.Event)
    _bg: asyncio.Task | None = None
    _started_at: float = 0.0

    async def emit(self, kind: str, **data: Any) -> None:
        evt = {"t": time.time(), "kind": kind, **data}
        self.transcript.append(evt)
        await self._events.put(evt)

    async def events(self) -> AsyncIterator[dict]:
        while True:
            yield await self._events.get()

    def resume(self) -> None:
        self.paused_for_user = False
        self.handoff_message = ""
        self._resume.set()

    def cancel(self) -> None:
        if self._bg and not self._bg.done():
            self._bg.cancel()

    async def start(self, goal: str) -> None:
        if self.running:
            raise RuntimeError("A task is already running")
        task = mem.create_task(goal)
        self.task_id = task["id"]
        self.goal = goal
        self.running = True
        self._started_at = time.time()
        self.transcript.clear()
        self._bg = asyncio.create_task(self._run())

    async def _perceive(self) -> tuple[bytes, str]:
        shot = await driver.screenshot()
        text = await driver.page_text()
        return shot, text

    async def _run(self) -> None:
        try:
            await self.emit("started", goal=self.goal, task_id=self.task_id)
            facts = mem.list_facts()
            recent_actions: list[dict] = []
            perception: dict = {"note": "initial — no perception yet"}

            for step in range(settings.max_steps_per_task):
                # Hourly browser restart with profile snapshot.
                if time.time() - self._started_at > settings.session_restart_seconds:
                    await self.emit("status", msg="hourly restart")
                    await snapshot_profile()
                    await driver.close()
                    self._started_at = time.time()

                shot, page_text = await self._perceive()
                action = await plan_next_action(
                    goal=self.goal,
                    task_state={"step": step, "url": await driver.url()},
                    perception=perception,
                    page_text=page_text,
                    memory_rows=facts,
                    recent_actions=recent_actions,
                )
                await self.emit("action", action=action)
                recent_actions.append(action)
                name = action.get("action")

                if name == "goto":
                    info = await driver.goto(action["url"])
                    perception = {"goto": info}
                elif name == "click":
                    await driver.click_xy(int(action["x"]), int(action["y"]))
                    perception = {"clicked": action.get("label", "")}
                elif name == "type":
                    await driver.type_text(action["text"], submit=bool(action.get("submit")))
                    perception = {"typed": True}
                elif name == "key":
                    await driver.press(action["key"])
                    perception = {"key": action["key"]}
                elif name == "scroll":
                    await driver.scroll(int(action.get("dy", 600)))
                    perception = {"scrolled": True}
                elif name == "wait":
                    await asyncio.sleep(min(int(action.get("ms", 1000)) / 1000, 10))
                    perception = {"waited": True}
                elif name == "ask_eyes":
                    q = action["question"]
                    answer = await moondream.describe(shot, q)
                    pts: list[dict] = []
                    if any(w in q.lower() for w in ("where", "button", "click", "point")):
                        try:
                            pts = await moondream.point(shot, q)
                        except Exception:
                            pts = []
                    perception = {"q": q, "a": answer, "points": pts}
                elif name == "save_memory":
                    mem.add_fact(action.get("kind", "fact"), action["content"])
                    facts = mem.list_facts()
                    perception = {"saved": True}
                elif name == "handoff":
                    self.paused_for_user = True
                    self.handoff_message = action.get("instruction", "Please assist.")
                    await self.emit("handoff",
                                    reason=action.get("reason", "other"),
                                    instruction=self.handoff_message)
                    self._resume.clear()
                    await self._resume.wait()
                    perception = {"handoff_resolved": True}
                elif name == "done":
                    summary = action.get("summary") or await summarise(self.goal, self.transcript)
                    mem.update_task(self.task_id, status="done", summary=summary)
                    mem.clear_checkpoint(self.task_id)
                    await snapshot_profile()
                    await self.emit("done", summary=summary)
                    return
                elif name == "fail":
                    reason = action.get("reason", "unknown")
                    mem.update_task(self.task_id, status="failed", summary=reason)
                    await self.emit("failed", reason=reason)
                    return
                else:
                    await self.emit("warn", msg=f"unknown action {name!r}; skipping")

                mem.write_checkpoint(self.task_id, {
                    "step": step, "url": await driver.url(),
                    "recent_actions": recent_actions[-8:],
                })

            await self.emit("failed", reason="max_steps")
            mem.update_task(self.task_id, status="failed", summary="max_steps")
        except asyncio.CancelledError:
            mem.update_task(self.task_id, status="failed", summary="cancelled")
            await self.emit("cancelled")
            raise
        except MistralError as e:
            await self.emit("error", error=f"brain: {e}")
            mem.update_task(self.task_id, status="failed", summary=str(e))
        except Exception as e:  # noqa: BLE001
            await self.emit("error", error=f"{type(e).__name__}: {e}")
            mem.update_task(self.task_id, status="failed", summary=str(e))
        finally:
            self.running = False


loop = Loop()
