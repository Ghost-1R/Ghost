import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceCursor } from "./cursor";
import { extractPublicEmail, findEvidenceSignal, qualifyLeadHit } from "./qualify";

test("phone CTA evidence is required for qualification pitch", () => {
  assert.equal(findEvidenceSignal("Call for availability today"), "Call for availability");
  assert.equal(findEvidenceSignal("We love paint."), null);
});

test("emails are extracted only when credible", () => {
  assert.equal(
    extractPublicEmail("Contact hello@driverightschool.com or noreply@x.com"),
    "hello@driverightschool.com",
  );
  assert.equal(extractPublicEmail("noreply@school.com"), "");
});

test("mock URLs are rejected and candidates without evidence stay candidates", () => {
  const mock = qualifyLeadHit({
    title: "Mock Shop",
    url: "https://example.com/mock/shop",
    description: "Call for availability",
    service: "website",
    market: "Norcross, GA",
  });
  assert.equal(mock.ok, false);

  const candidate = qualifyLeadHit({
    title: "Local Painter",
    url: "https://localpainter.com/",
    description: "Family owned painter",
    service: "website",
    market: "Norcross, GA",
  });
  assert.equal(candidate.ok, true);
  if (candidate.ok) assert.equal(candidate.kind, "candidate");

  const qualified = qualifyLeadHit({
    title: "Drive Right School",
    url: "https://driverightschool.com/",
    description: "To enroll, call our office. Email office@driverightschool.com",
    service: "website",
    market: "Atlanta, GA",
  });
  assert.equal(qualified.ok, true);
  if (qualified.ok) {
    assert.equal(qualified.kind, "qualified");
    assert.equal(qualified.contactEmail, "office@driverightschool.com");
  }
});

test("cursor advances service then market then industry", () => {
  const next = advanceCursor(
    { industryIdx: 0, marketIdx: 0, serviceIdx: 2 },
    { industries: 3, markets: 2, services: 3 },
  );
  assert.deepEqual(next, { industryIdx: 0, marketIdx: 1, serviceIdx: 0 });
});
