import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("founder shell uses charcoal sidebar, turquoise accent, and light cards", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--sidebar:\s*#2f3a44/);
  assert.match(css, /--accent:\s*#0f9f94/);
  assert.match(css, /--bg-raise:\s*#fffdf9/);
  assert.match(css, /--radius-card/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /today-card-in/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Today, Files, and Decisions routes exist", () => {
  const shell = readFileSync(new URL("../../components/shell/app-shell.tsx", import.meta.url), "utf8");
  assert.ok(shell.includes('label: "Today"'));
  assert.ok(shell.includes('href: "/files"'));
  assert.ok(shell.includes('href: "/decisions"'));
  const files = readFileSync(
    new URL("../../app/(workspace)/files/page.tsx", import.meta.url),
    "utf8",
  );
  const decisions = readFileSync(
    new URL("../../app/(workspace)/decisions/page.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(files.includes("No artifacts yet"));
  assert.ok(decisions.includes("Pending authorizations"));
  assert.ok(!/78\s*%|fake progress|\$0 MRR/i.test(files + decisions));
});
