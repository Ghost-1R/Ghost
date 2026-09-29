import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../../components/ghost/markdown";
import { parseInline, parseMarkdown } from "./markdown";

function html(source: string): string {
  return renderToStaticMarkup(createElement(Markdown, { source }));
}

test("assistant answers render bold, italic, and inline code instead of literal markers", () => {
  const out = html("The gate is **not ready** until *fresh* evidence exists. Run `npm test` first.");
  assert.equal(
    out,
    '<div class="markdown"><p>The gate is <strong>not ready</strong> until <em>fresh</em> evidence exists. Run <code>npm test</code> first.</p></div>',
  );
  assert.ok(!out.includes("**"));
  assert.equal(html("__strong__ and _soft_"), '<div class="markdown"><p><strong>strong</strong> and <em>soft</em></p></div>');
  assert.equal(html("***both***"), '<div class="markdown"><p><strong><em>both</em></strong></p></div>');
  assert.equal(html("**Status:** `READY`"), '<div class="markdown"><p><strong>Status:</strong> <code>READY</code></p></div>');
});

test("paragraphs split on blank lines and keep single line breaks", () => {
  assert.equal(html("First line\nsecond line\n\nNext paragraph"), '<div class="markdown"><p>First line<br/>second line</p><p>Next paragraph</p></div>');
});

test("ordered and unordered lists render as list elements", () => {
  assert.equal(
    html("Next steps:\n1. Run the **Inspector**\n2. Open *Presentation*\n\n- lint\n- tsc\n* build"),
    '<div class="markdown"><p>Next steps:</p><ol><li>Run the <strong>Inspector</strong></li><li>Open <em>Presentation</em></li></ol><ul><li>lint</li><li>tsc</li><li>build</li></ul></div>',
  );
  assert.equal(html("3. third\n4. fourth"), '<div class="markdown"><ol start="3"><li>third</li><li>fourth</li></ol></div>');
  assert.equal(html("- first\n  continues here\n- second"), '<div class="markdown"><ul><li>first continues here</li><li>second</li></ul></div>');
});

test("fenced code blocks keep their content verbatim and unformatted", () => {
  const out = html("Run:\n```bash\nnpm run build\necho **not bold** <b>x</b>\n```\nDone.");
  assert.equal(
    out,
    '<div class="markdown"><p>Run:</p><pre data-language="bash"><code>npm run build\necho **not bold** &lt;b&gt;x&lt;/b&gt;</code></pre><p>Done.</p></div>',
  );
  assert.equal(html("```\nunclosed\ncode"), '<div class="markdown"><pre><code>unclosed\ncode</code></pre></div>');
  assert.equal(html('```"><script>\nx\n```'), '<div class="markdown"><pre><code>x</code></pre></div>');
});

test("headings render as emphasized paragraphs, not raw hashes", () => {
  assert.equal(html("## Summary\nText"), '<div class="markdown"><p class="markdown-heading"><strong>Summary</strong></p><p>Text</p></div>');
});

test("HTML, scripts, and links in model output stay inert text", () => {
  const out = html('<script>alert(1)</script> <img src=x onerror="alert(1)"> [click](javascript:alert(1)) <a href="https://evil.example">x</a>');
  assert.ok(!out.includes("<script"));
  assert.ok(!out.includes("<img"));
  assert.ok(!out.includes("<a "));
  assert.ok(!out.includes('href="'));
  assert.ok(!out.includes('onerror="'));
  assert.ok(out.includes("&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;"));
  assert.ok(out.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(out.includes("[click](javascript:alert(1))"));
  const bold = html("**<img src=x onerror=alert(1)>**");
  assert.equal(bold, '<div class="markdown"><p><strong>&lt;img src=x onerror=alert(1)&gt;</strong></p></div>');
});

test("the renderer never uses raw HTML injection", () => {
  const renderer = readFileSync(new URL("../../components/ghost/markdown.tsx", import.meta.url), "utf8");
  const conversation = readFileSync(new URL("../../components/ghost/conversation.tsx", import.meta.url), "utf8");
  for (const source of [renderer, conversation]) {
    assert.ok(!source.includes("dangerouslySetInnerHTML"));
    assert.ok(!source.includes("innerHTML"));
  }
});

test("unmatched or spaced markers stay literal", () => {
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ type: "text", value: "2 * 3 * 4" }]);
  assert.deepEqual(parseInline("snake_case_name and file_name.ts"), [{ type: "text", value: "snake_case_name and file_name.ts" }]);
  assert.deepEqual(parseInline("**unclosed bold"), [{ type: "text", value: "**unclosed bold" }]);
  assert.deepEqual(parseInline("\\*not italic\\*"), [{ type: "text", value: "*not italic*" }]);
  assert.deepEqual(parseInline("`code with **stars**`"), [{ type: "code", value: "code with **stars**" }]);
  assert.deepEqual(parseInline("``has ` tick``"), [{ type: "code", value: "has ` tick" }]);
  assert.equal(html("**bold `code` inside**"), '<div class="markdown"><p><strong>bold <code>code</code> inside</strong></p></div>');
});

test("empty and whitespace answers render no blocks", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("\n\n  \n"), []);
});

test("user messages stay plain text in the conversation", () => {
  const conversation = readFileSync(new URL("../../components/ghost/conversation.tsx", import.meta.url), "utf8");
  assert.match(conversation, /message\.role === "assistant" \? <Markdown source=\{splitAnswer\(message\.content\)\.answer\} \/> : <p className="bubble-text">\{message\.content\}<\/p>/);
});
