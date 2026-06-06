// Self-hosted stealth Playwright bridge — runs on YOUR machine.
//
// Stack:
//   - patchright: actively-maintained Playwright fork that patches the
//     well-known automation fingerprints (runtime.enable leak, console.debug
//     stack leak, headless UA, etc). Drop-in replacement for `playwright`.
//   - ghost-cursor-playwright: bezier-curve human-like mouse movement so
//     click heatmaps don't scream "bot".
//   - persistent context with a real user-data dir so cookies / localStorage /
//     site trust survive restarts (huge anti-bot signal).
//   - manual captcha handoff: when the agent hits a captcha it calls
//     `wait_for_manual` which brings the local Chromium window to the front
//     and waits up to N seconds for YOU to click through. Since the browser
//     runs on your own machine and you're the only user, this is faster,
//     free, and more reliable than any paid solver API.
//   - resource blocking: optionally drops images/fonts/media to make
//     navigation 2–5× faster on heavy pages. Off by default so screenshots
//     still look real; the AI can flip it per-action via `lite: true`.
//
// Single user, one browser, one page at a time. No concurrency.

import express from "express";
import cors from "cors";
import { chromium, type BrowserContext, type Page, type Route } from "patchright";
import { createCursor, type GhostCursor } from "ghost-cursor-playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const USER_DATA_DIR =
  process.env.USER_DATA_DIR ??
  path.join(os.homedir(), ".lovable-agent-chromium");
fs.mkdirSync(USER_DATA_DIR, { recursive: true });



const PLATFORM = process.platform;
const UA =
  PLATFORM === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    : PLATFORM === "win32"
      ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let context: BrowserContext | null = null;
let page: Page | null = null;
let cursor: GhostCursor | null = null;
let liteMode = false; // resource blocking on/off

const HEAVY_TYPES = new Set(["image", "media", "font"]);
async function routeHandler(route: Route) {
  if (liteMode && HEAVY_TYPES.has(route.request().resourceType())) {
    return route.abort();
  }
  return route.continue();
}

async function ensurePage(): Promise<{ p: Page; c: GhostCursor }> {
  if (!context) {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: "chrome",
      headless: false,
      viewport: null,
      userAgent: UA,
      locale: "en-US",
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    await context.route("**/*", routeHandler);
  }
  if (!page || page.isClosed()) {
    page = context.pages()[0] ?? (await context.newPage());
    cursor = await createCursor(page);
  }
  return { p: page, c: cursor! };
}

const jitter = (min = 80, max = 240) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    stealth: "patchright",
    captcha: "manual-handoff",
    lite: liteMode,
  }),
);

app.post("/action", async (req, res) => {
  const { action, selector, url, value, script, timeout_ms, lite, done_selector } = req.body ?? {};

  try {
    // Per-action lite toggle (defaults to current global setting).
    if (typeof lite === "boolean") liteMode = lite;

    const { p, c } = await ensurePage();
    p.setDefaultTimeout(timeout_ms ?? 20000);

    switch (action) {
      case "goto":
        await p.goto(url, { waitUntil: "domcontentloaded" });
        await jitter(400, 900);
        return res.json({ ok: true, url: p.url(), title: await p.title() });

      case "click": {
        await c.actions.click({ target: selector });
        await jitter();
        return res.json({ ok: true });
      }

      case "fill": {
        await c.actions.click({ target: selector });
        await p.fill(selector, "");
        await p.type(selector, String(value ?? ""), {
          delay: 40 + Math.random() * 90,
        });
        await jitter();
        return res.json({ ok: true });
      }

      case "press":
        await p.keyboard.press(value ?? "Enter");
        await jitter();
        return res.json({ ok: true });

      case "text": {
        // In lite mode screenshots are useless anyway; text is what the AI
        // mostly needs, and it's much cheaper than a full screenshot.
        const text = selector
          ? await p.locator(selector).innerText()
          : await p.innerText("body");
        return res.json({ ok: true, text: text.slice(0, 8000) });
      }

      case "screenshot": {
        // Force-load assets for this one shot regardless of lite mode so the
        // AI doesn't get a half-rendered page.
        const wasLite = liteMode;
        liteMode = false;
        try {
          await p.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          const buf = await p.screenshot({ fullPage: false });
          return res.json({ ok: true, screenshot_base64: buf.toString("base64") });
        } finally {
          liteMode = wasLite;
        }
      }

      case "evaluate": {
        const result = await p.evaluate(script ?? "1");
        return res.json({ ok: true, result });
      }

      case "scroll": {
        await p.mouse.wheel(0, Number(value ?? 600));
        await jitter(200, 500);
        return res.json({ ok: true });
      }

      case "hover": {
        await c.actions.move({ target: selector });
        return res.json({ ok: true });
      }

      case "wait":
        if (selector) await p.waitForSelector(selector);
        else await p.waitForTimeout(timeout_ms ?? 1000);
        return res.json({ ok: true });

      case "wait_for_manual": {
        // Captcha / 2FA / login wall handoff. Brings the local Chromium
        // window to the front and waits for the user to clear it.
        // - If `done_selector` is provided, resolves when that selector appears
        //   (e.g. the element that exists only AFTER the captcha is solved).
        // - If `selector` is provided, resolves when that selector disappears
        //   (e.g. the captcha iframe itself).
        // - Otherwise just waits `timeout_ms` (default 120s).
        try { await p.bringToFront(); } catch {}
        const ms = timeout_ms ?? 120000;
        try {
          if (done_selector) {
            await p.waitForSelector(done_selector, { timeout: ms, state: "visible" });
          } else if (selector) {
            await p.waitForSelector(selector, { timeout: ms, state: "detached" });
          } else {
            await p.waitForTimeout(ms);
          }
          return res.json({ ok: true, solved: true });
        } catch {
          return res.json({ ok: false, solved: false, error: "Timed out waiting for manual action." });
        }
      }



      case "set_lite":
        liteMode = !!value;
        return res.json({ ok: true, lite: liteMode });

      case "close":
        if (page) {
          await page.close();
          page = null;
          cursor = null;
        }
        return res.json({ ok: true });

      case "reset":
        if (context) {
          await context.close();
          context = null;
          page = null;
          cursor = null;
        }
        return res.json({ ok: true });

      default:
        return res.status(400).json({ ok: false, error: "Unknown action" });
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () =>
  console.log(`Stealth Playwright bridge listening on http://localhost:${PORT}`),
);
