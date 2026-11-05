import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProspectMailto, searchProspectsWithBrave } from "./brave-search";

test("missing Brave key returns labeled MOCK results and setup message", async () => {
  const result = await searchProspectsWithBrave({
    businessType: "independent grocery stores",
    city: "Norcross, GA",
    apiKey: "",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mode, "mock");
  assert.match(result.setupMessage ?? "", /BRAVE_SEARCH_API_KEY/);
  assert.ok(result.results.length > 0);
  assert.ok(result.results.length <= 8);
  assert.match(result.results[0]?.description ?? "", /MOCK/i);
});

test("live Brave path maps web results and caps at eight", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    title: `Store ${index + 1}`,
    url: `https://example.com/store-${index + 1}`,
    description: `Listing ${index + 1}`,
  }));
  const result = await searchProspectsWithBrave({
    businessType: "grocery",
    city: "Atlanta, GA",
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(JSON.stringify({ web: { results: rows } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mode, "live");
  assert.equal(result.results.length, 8);
  assert.equal(result.setupMessage, null);
});

test("mailto draft includes recipient and short introduction", () => {
  const href = buildProspectMailto({
    email: "hello@fresh.example",
    businessName: "Norcross Fresh Market",
    founderName: "CEO JITTA",
  });
  assert.ok(href);
  assert.match(href!, /^mailto:hello%40fresh\.example\?/);
  assert.match(href!, /subject=/);
  assert.match(href!, /body=/);
  const decoded = decodeURIComponent(href!);
  assert.match(decoded, /Norcross Fresh Market/);
  assert.match(decoded, /CEO JITTA/);
});
