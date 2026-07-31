"""Camoufox async driver with human-timing layer.

Camoufox is a patched Firefox that hides automation fingerprints. We drive
it through its Playwright-compatible API. Persistent profile lives at
`settings.camoufox_profile_dir` and is snapshotted to Supabase Storage by
`profile.py` so it survives restarts.

Perception is text-only: `snapshot()` walks the DOM/accessibility tree and
returns a numbered list of interactive elements. The brain acts on those
`ref` numbers instead of pixel coordinates, so no vision model is needed.
"""
from __future__ import annotations
import asyncio
import random
from typing import Any

from ..config import settings

# Collects interactive, visible elements and tags each with data-op-ref.
_SNAPSHOT_JS = """
(maxN) => {
  document.querySelectorAll('[data-op-ref]').forEach(e => e.removeAttribute('data-op-ref'));
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],' +
              '[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],' +
              '[role=combobox],[role=switch],[contenteditable=true],[onclick],[tabindex]';
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (n >= maxN) break;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    if (r.bottom < -600 || r.top > window.innerHeight + 1200) continue;
    const name = (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.innerText ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.value || ''
    ).replace(/\\s+/g, ' ').trim().slice(0, 120);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') ||
      (tag === 'a' ? 'link' : tag === 'button' ? 'button' :
       tag === 'input' ? ('input:' + (el.type || 'text')) : tag);
    if (!name && !['input:text','input:email','input:password','input:search','textarea','select','input:file'].includes(role)) continue;
    el.setAttribute('data-op-ref', String(n));
    const item = { ref: n, role, name };
    if (el.value !== undefined && el.value !== '' && el.type !== 'password') item.value = String(el.value).slice(0, 80);
    if (el.getAttribute('placeholder')) item.placeholder = el.getAttribute('placeholder');
    if (tag === 'a' && el.href) item.href = el.href.slice(0, 200);
    if (r.top > window.innerHeight || r.bottom < 0) item.offscreen = true;
    out.push(item);
    n++;
  }
  return out;
}
"""


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
                block_images=True,   # text-only perception: images are dead weight
            )
            self._browser = await self._cf.__aenter__()
            ctx = self._browser  # AsyncCamoufox yields a BrowserContext
            self._page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            return self._page

    # ---- human timing -------------------------------------------------
    @staticmethod
    async def _jitter(lo: float = 0.08, hi: float = 0.24) -> None:
        await asyncio.sleep(random.uniform(lo, hi))

    async def _locator(self, ref: int) -> Any:
        p = await self.ensure_page()
        loc = p.locator(f'[data-op-ref="{ref}"]')
        if await loc.count() == 0:
            raise ValueError(f"ref {ref} is no longer on the page; take a fresh snapshot")
        return loc.first

    # ---- perception ---------------------------------------------------
    async def snapshot(self) -> list[dict]:
        p = await self.ensure_page()
        try:
            return await p.evaluate(_SNAPSHOT_JS, settings.max_elements)
        except Exception:
            return []

    async def page_text(self) -> str:
        p = await self.ensure_page()
        try:
            return (await p.inner_text("body"))[:8000]
        except Exception:
            return ""

    async def url(self) -> str:
        p = await self.ensure_page()
        return p.url

    async def title(self) -> str:
        p = await self.ensure_page()
        try:
            return await p.title()
        except Exception:
            return ""

    # ---- actions ------------------------------------------------------
    async def goto(self, url: str) -> dict:
        p = await self.ensure_page()
        await p.goto(url, wait_until="domcontentloaded")
        await self._jitter(0.4, 0.9)
        return {"url": p.url, "title": await p.title()}

    async def click_ref(self, ref: int) -> None:
        loc = await self._locator(ref)
        await loc.scroll_into_view_if_needed(timeout=5000)
        await self._jitter(0.05, 0.18)
        await loc.click(timeout=8000, delay=random.uniform(40, 120))
        await self._jitter(0.2, 0.5)

    async def type_ref(self, ref: int, text: str, submit: bool = False) -> None:
        loc = await self._locator(ref)
        await loc.scroll_into_view_if_needed(timeout=5000)
        await loc.click(timeout=8000)
        try:
            await loc.fill("")
        except Exception:
            pass
        for ch in text:
            await loc.type(ch, delay=random.uniform(40, 110))
        if submit:
            await self._jitter(0.1, 0.3)
            await loc.press("Enter")
        await self._jitter()

    async def select_ref(self, ref: int, value: str) -> None:
        loc = await self._locator(ref)
        try:
            await loc.select_option(label=value)
        except Exception:
            await loc.select_option(value=value)
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
        """Kept for the UI's optional live view — never sent to a model."""
        p = await self.ensure_page()
        try:
            await p.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass
        return await p.screenshot(full_page=False)

    async def close(self) -> None:
        if self._cf is not None:
            try:
                await self._cf.__aexit__(None, None, None)
            except Exception:
                pass
        self._cf = self._browser = self._page = None


# Module-level singleton (single-user app, one browser).
driver = Camoufox()
