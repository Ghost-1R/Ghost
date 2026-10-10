import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("fixture build artifact exists", () => {
  const text = readFileSync(new URL("./dist-hello.txt", import.meta.url), "utf8");
  assert.match(text, /Ghost isolated pilot/);
});

test("fixture arithmetic", () => {
  assert.equal(2 + 2, 4);
});
