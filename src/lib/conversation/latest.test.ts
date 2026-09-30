import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isLongAnswer, latestExchange } from "./latest";

const turn = (id: string, role: "user" | "assistant", content: string) => ({ id, role, content });

test("an empty conversation shows no latest card", () => {
  assert.deepEqual(latestExchange([], null), { ask: null, answer: null, thinking: false, unanswered: false });
});

test("the latest card pairs the newest answer with the request before it", () => {
  const messages = [
    turn("1", "user", "first"),
    turn("2", "assistant", "first answer"),
    turn("3", "user", "second"),
    turn("4", "assistant", "second answer"),
  ];
  const latest = latestExchange(messages, null);
  assert.equal(latest.ask, "second");
  assert.equal(latest.answer?.id, "4");
  assert.equal(latest.thinking, false);
});

test("a pending question shows thinking instead of an older answer", () => {
  const latest = latestExchange([turn("1", "user", "old"), turn("2", "assistant", "old answer")], "new question");
  assert.deepEqual(latest, { ask: "new question", answer: null, thinking: true, unanswered: false });
});

test("a stored question without an answer is reported, not filled in", () => {
  const latest = latestExchange([turn("1", "user", "old"), turn("2", "assistant", "a"), turn("3", "user", "unanswered")], null);
  assert.deepEqual(latest, { ask: "unanswered", answer: null, thinking: false, unanswered: true });
});

test("long answers are detected from the visible answer, not the sources", () => {
  assert.equal(isLongAnswer("Short answer."), false);
  assert.equal(isLongAnswer("x".repeat(701)), true);
  assert.equal(isLongAnswer(Array.from({ length: 15 }, (_, index) => `line ${index}`).join("\n")), true);
});

test("the command bar sends on Enter, keeps Shift+Enter, and offers voice without auto-sending", () => {
  const conversation = readFileSync(new URL("../../components/ghost/conversation.tsx", import.meta.url), "utf8");
  assert.match(conversation, /name="message"/);
  assert.match(conversation, /rows=\{1\}/);
  assert.match(conversation, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.nativeEvent\.isComposing/);
  assert.match(conversation, /<MicButton voice=\{voice\} \/>/);
  assert.match(conversation, /Open conversation/);
  assert.ok(!/messages\.slice|splice\(|\.filter\(\(message\) => message\.role/.test(conversation), "history must not be trimmed");
});

test("the dashboard shows only real systems state and no invented metrics", () => {
  const page = readFileSync(new URL("../../app/(workspace)/dashboard/page.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("<DashboardHero") < page.indexOf('variant="command"'));
  assert.ok(page.indexOf('variant="command"') < page.indexOf("Continue from the real state."));
  assert.ok(!/Math\.random|%<|uptime|velocity|streak/i.test(page));
});

test("command bar motion is compositor-only and stops under reduced motion", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  for (const name of ["command-sweep", "mic-pulse", "latest-reveal", "thinking-dot"]) {
    const frames = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.ok(frames, `missing ${name}`);
    assert.ok(!/box-shadow|width|height|top|left|margin/.test(frames), `${name} animates layout or paint`);
  }
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const selector of [".command-bar::after", ".latest-answer", ".thinking-dots span", ".conversation-dialog[open]", ".command-mic::after"]) {
    assert.ok(reduced.includes(selector), `reduced motion misses ${selector}`);
  }
  assert.match(css, /\.command-action \{[^}]*width: 2\.75rem;[^}]*height: 2\.75rem/);
});
