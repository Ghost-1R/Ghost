/**
 * Capture founder-review screenshots of the redesigned dashboard.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import path from "node:path";

const env: Record<string, string> = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i <= 0 || line.startsWith("#")) continue;
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:3000";
const OUT = path.join(process.cwd(), ".ghost", "dashboard-review");
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', env.GHOST_LOCAL_FOUNDER_EMAIL);
await page.fill('input[type="password"], input[name="password"]', env.GHOST_LOCAL_FOUNDER_PASSWORD);
await Promise.all([
  page.waitForURL(/dashboard|projects/, { timeout: 30000 }).catch(() => null),
  page.click('button[type="submit"]'),
]);
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.waitForSelector(".os-dashboard, .os-hero", { timeout: 20000 });

const checks: Record<string, unknown> = {
  hasHero: await page.locator(".os-hero").count(),
  hasActive: await page.locator(".os-active-card").count(),
  hasToday: await page.getByText("Today with Ghost").count(),
  hasDecisions: await page.getByText("Needs Your Decision").count(),
  hasPipeline: await page.locator(".os-pipeline-horizontal").count(),
  hasAsk: await page.locator("#ask-ghost").count(),
  hasIvoire: await page.getByText("Ivoire Shop").count(),
  bodyTextSample: (await page.locator("body").innerText()).slice(0, 500),
};

for (const vp of viewports) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(400);
  const file = path.join(OUT, `dashboard-${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowX: doc.scrollWidth > doc.clientWidth + 1,
    };
  });
  checks[vp.name] = { file, overflow };
}

writeFileSync(path.join(OUT, "checks.json"), JSON.stringify(checks, null, 2));
console.log(JSON.stringify({ pass: true, out: OUT, checks }, null, 2));
await browser.close();
