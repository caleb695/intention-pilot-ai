"""Camoufox async driver with human-timing layer.

Camoufox is a patched Firefox that hides automation fingerprints. We drive
it through its Playwright-compatible API. Persistent profile lives at
`settings.camoufox_profile_dir` and is snapshotted to Supabase Storage by
`profile.py` so it survives Space restarts.

Manual handoff: when the brain returns a `handoff` action, the API layer
calls `wait_for_user_signal()` which blocks until the user taps "resume"
in the web UI. The browser stays open; the user clears whatever is in the
way (captcha, 2FA) on their phone-mirrored session.
"""
from __future__ import annotations
import asyncio
import random
from typing import Any

from ..config import settings


class Camoufox:
    def __init__(self) -> None:
        self._cf: Any = None
        self._browser: Any = None
        self._page: Any = None
        self._lock = asyncio.Lock()

    async def ensure_page(self) -> Any:
        async with self._lock:
            if self._page and not self._page.is_closed():
                return self._page
            # Imported lazily so the FastAPI server can boot without
            # downloading the Firefox binary first.
            from camoufox.async_api import AsyncCamoufox
            self._cf = AsyncCamoufox(
                headless=True,
                persistent_context=True,
                user_data_dir=settings.camoufox_profile_dir,
                humanize=True,
                geoip=True,
                block_images=False,   # toggled per-action
            )
            self._browser = await self._cf.__aenter__()
            ctx = self._browser  # AsyncCamoufox yields a BrowserContext
            self._page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            return self._page

    # ---- human timing -------------------------------------------------
    @staticmethod
    async def _jitter(lo: float = 0.08, hi: float = 0.24) -> None:
        await asyncio.sleep(random.uniform(lo, hi))

    # ---- actions ------------------------------------------------------
    async def goto(self, url: str) -> dict:
        p = await self.ensure_page()
        await p.goto(url, wait_until="domcontentloaded")
        await self._jitter(0.4, 0.9)
        return {"url": p.url, "title": await p.title()}

    async def click_xy(self, x: int, y: int) -> None:
        p = await self.ensure_page()
        await p.mouse.move(x + random.randint(-2, 2), y + random.randint(-2, 2),
                           steps=random.randint(8, 16))
        await self._jitter(0.05, 0.18)
        await p.mouse.click(x, y, delay=random.uniform(40, 120))
        await self._jitter()

    async def type_text(self, text: str, submit: bool = False) -> None:
        p = await self.ensure_page()
        for ch in text:
            await p.keyboard.type(ch, delay=random.uniform(40, 110))
        if submit:
            await self._jitter(0.1, 0.3)
            await p.keyboard.press("Enter")
        await self._jitter()

    async def press(self, key: str) -> None:
        p = await self.ensure_page()
        await p.keyboard.press(key)
        await self._jitter()

    async def scroll(self, dy: int) -> None:
        p = await self.ensure_page()
        await p.mouse.wheel(0, dy)
        await self._jitter(0.2, 0.5)

    async def screenshot(self) -> bytes:
        p = await self.ensure_page()
        try:
            await p.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass
        return await p.screenshot(full_page=False)

    async def page_text(self) -> str:
        p = await self.ensure_page()
        try:
            return (await p.inner_text("body"))[:8000]
        except Exception:
            return ""

    async def url(self) -> str:
        p = await self.ensure_page()
        return p.url

    async def close(self) -> None:
        if self._cf is not None:
            try:
                await self._cf.__aexit__(None, None, None)
            except Exception:
                pass
        self._cf = self._browser = self._page = None


# Module-level singleton (single-user app, one browser).
driver = Camoufox()
