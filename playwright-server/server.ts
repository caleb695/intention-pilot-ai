// Self-hosted Playwright bridge — runs on YOUR machine, NOT in the Lovable Cloud.
// Single persistent Chromium instance. One active session, no concurrency.
// See README.md in this directory for setup.

import express from "express";
import cors from "cors";
import { chromium, type Browser, type Page } from "playwright";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

let browser: Browser | null = null;
let page: Page | null = null;

async function ensurePage(): Promise<Page> {
  if (!browser) browser = await chromium.launch({ headless: false });
  if (!page || page.isClosed()) page = await browser.newPage();
  return page;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/action", async (req, res) => {
  const { action, selector, url, value, script, timeout_ms } = req.body ?? {};
  try {
    const p = await ensurePage();
    p.setDefaultTimeout(timeout_ms ?? 15000);
    switch (action) {
      case "goto":
        await p.goto(url, { waitUntil: "domcontentloaded" });
        return res.json({ ok: true, url: p.url(), title: await p.title() });
      case "click":
        await p.click(selector);
        return res.json({ ok: true });
      case "fill":
        await p.fill(selector, value ?? "");
        return res.json({ ok: true });
      case "press":
        await p.keyboard.press(value ?? "Enter");
        return res.json({ ok: true });
      case "text": {
        const text = selector ? await p.locator(selector).innerText() : await p.innerText("body");
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
      case "wait":
        if (selector) await p.waitForSelector(selector);
        else await p.waitForTimeout(timeout_ms ?? 1000);
        return res.json({ ok: true });
      case "close":
        if (page) { await page.close(); page = null; }
        return res.json({ ok: true });
      default:
        return res.status(400).json({ ok: false, error: "Unknown action" });
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`Playwright bridge listening on http://localhost:${PORT}`));
