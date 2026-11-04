/**
 * Post-deploy dashboard founder checks (production only).
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = (process.env.GHOST_PRODUCTION_URL ?? "https://ghost-nkk0.onrender.com").replace(/\/$/, "");
const env: Record<string, string> = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i <= 0 || line.startsWith("#")) continue;
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const health = (await fetch(`${base}/api/health`).then((r) => r.json())) as { status?: string; commit?: string };
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', env.GHOST_LOCAL_FOUNDER_EMAIL);
await page.fill('input[type="password"], input[name="password"]', env.GHOST_LOCAL_FOUNDER_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 60000 });
await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
await page.waitForSelector(".os-dashboard, .os-hero", { timeout: 30000 });

const text = await page.locator("body").innerText();
const checks = {
  health,
  whatIsGhost: /second mind/i.test(text),
  ivoireShop: /Ivoire Shop/i.test(text),
  pipeline: /Project Pipeline|IMPLEMENTATION/i.test(text),
  today: /Today with Ghost/i.test(text),
  decisions: /Needs Your Decision/i.test(text),
  askGhost: /Ask Ghost|ghost-command/i.test(text) || (await page.locator("#ghost-command, textarea[name=message]").count()) > 0,
  readyForDelivery: /ready_for_delivery/i.test(text),
  noFakePercent: !/\b\d{1,3}\s*%\s*(complete|done|progress)/i.test(text),
  openBlocker: /blocker/i.test(text),
  requirements12: /Requirements:\s*12/i.test(text),
};

await page.setViewportSize({ width: 768, height: 1024 });
await page.waitForTimeout(500);
const ipad = await page.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  menu: Boolean(document.querySelector(".menu-button")),
  hero: Boolean(document.querySelector(".os-hero")),
  today: document.body.innerText.includes("Today with Ghost"),
}));

console.log(JSON.stringify({ pass: Object.values(checks).every((v) => v !== false), checks, ipad }, null, 2));
await browser.close();

if (!checks.whatIsGhost || !checks.ivoireShop || checks.noFakePercent === false) process.exit(1);
