// Self-hosted stealth Playwright bridge — runs on YOUR machine.
// Stack:
//   - patchright: actively-maintained Playwright fork that patches the
//     well-known automation fingerprints (runtime.enable leak, console.debug
//     stack leak, headless UA, etc). Drop-in replacement for `playwright`.
//   - ghost-cursor-playwright: bezier-curve human-like mouse movement so
//     click heatmaps don't scream "bot".
//   - persistent context with a real user-data dir so cookies / localStorage /
//     site trust survive restarts (huge anti-bot signal).
//
// Single user, one browser, one page at a time. No concurrency.

import express from "express";
import cors from "cors";
import { chromium, type BrowserContext, type Page } from "patchright";
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

// Realistic, current desktop Chrome on the host platform.
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

async function ensurePage(): Promise<{ p: Page; c: GhostCursor }> {
  if (!context) {
    // launchPersistentContext + channel:'chrome' is what patchright recommends
    // for the best stealth posture (real Chrome > bundled Chromium for fp).
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: "chrome",
      headless: false,
      viewport: null, // use real window size, not the 1280x720 tell
      userAgent: UA,
      locale: "en-US",
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Patchright recommends NOT setting these flags; defaults are tuned.
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  if (!page || page.isClosed()) {
    page = context.pages()[0] ?? (await context.newPage());
    cursor = await createCursor(page);
  }
  return { p: page, c: cursor! };
}

// Small jittered delay so we don't fire actions at robot intervals.
const jitter = (min = 80, max = 240) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

app.get("/health", (_req, res) => res.json({ ok: true, stealth: "patchright" }));

app.post("/action", async (req, res) => {
  const { action, selector, url, value, script, timeout_ms } = req.body ?? {};
  try {
    const { p, c } = await ensurePage();
    p.setDefaultTimeout(timeout_ms ?? 20000);

    switch (action) {
      case "goto":
        await p.goto(url, { waitUntil: "domcontentloaded" });
        await jitter(400, 900);
        return res.json({ ok: true, url: p.url(), title: await p.title() });

      case "click": {
        // ghost-cursor moves along a bezier path to the element, then clicks.
        await c.actions.click({ target: selector });
        await jitter();
        return res.json({ ok: true });
      }

      case "fill": {
        // Focus via human-like click, clear, then type with per-keystroke delay.
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
        const text = selector
          ? await p.locator(selector).innerText()
          : await p.innerText("body");
        return res.json({ ok: true, text: text.slice(0, 8000) });
      }

      case "screenshot": {
        const buf = await p.screenshot({ fullPage: false });
        return res.json({ ok: true, screenshot_base64: buf.toString("base64") });
      }

      case "evaluate": {
        const result = await p.evaluate(script ?? "1");
        return res.json({ ok: true, result });
      }

      case "scroll": {
        // Smooth, human-ish scroll instead of a single jump.
        const dy = Number(value ?? 600);
        await p.mouse.wheel(0, dy);
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
