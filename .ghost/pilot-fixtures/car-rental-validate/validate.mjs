import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(root, "site");

for (const name of ["index.html", "styles.css", "app.js"]) {
  if (!existsSync(path.join(site, name))) {
    console.error(`MISSING_FILE ${name}`);
    process.exit(1);
  }
}

const html = readFileSync(path.join(site, "index.html"), "utf8");
const css = readFileSync(path.join(site, "styles.css"), "utf8");
const js = readFileSync(path.join(site, "app.js"), "utf8");

function fail(label) {
  console.error(`FAIL ${label}`);
  process.exit(1);
}

if (!/class="hero"/i.test(html)) fail("hero");
if ((html.match(/<article class="vehicle">/g) ?? []).length !== 3) fail("vehicles");
if (!/id="inquiry-form"/i.test(html)) fail("form");
for (const field of ["name", "email", "vehicle", "pickup"]) {
  if (!new RegExp(`name="${field}"`, "i").test(html)) fail(`field-${field}`);
}
if (!/href="\.\/styles\.css"/i.test(html)) fail("css-ref");
if (!/src="\.\/app\.js"/i.test(html)) fail("js-ref");
if (!/preventDefault/i.test(js)) fail("local-validation");
if (/\bfetch\s*\(/.test(js) || /XMLHttpRequest/i.test(js) || /mailto:/i.test(html)) fail("no-network");
if (!/@media/i.test(css)) fail("responsive");

console.log("VALIDATE_OK car-rental fixture (Cursor-prepared sample; not Ghost-generated)");
