import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

test("build manifest exists", () => {
  assert.equal(existsSync(path.join(root, "dist-manifest.txt")), true);
  const text = readFileSync(path.join(root, "dist-manifest.txt"), "utf8");
  assert.match(text, /site\/index\.html:/);
});

test("three vehicle cards in HTML", () => {
  const html = readFileSync(path.join(root, "site/index.html"), "utf8");
  assert.equal((html.match(/<article class="vehicle">/g) ?? []).length, 3);
});

test("local validation only", () => {
  const js = readFileSync(path.join(root, "site/app.js"), "utf8");
  assert.match(js, /preventDefault/);
  assert.equal(/\bfetch\s*\(/.test(js), false);
});
