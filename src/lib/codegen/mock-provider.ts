import { createHash, randomUUID } from "node:crypto";
import { estimateTokens, wouldExceedCost, wouldExceedTokenBudget } from "./budget";
import { PILOT_03_OBJECTIVE } from "./pilot03-constants";
import { CODING_PROVIDER_PRIVACY, providerSatisfiesClassification } from "./privacy";
import { assertObjectiveSafe, validateProposals } from "./security";
import type { CodeGenerationRequest, CodeGenerationResult, CodingProvider, FileChangeProposal } from "./types";

function vehicleComparisonProposals(rootDir: string): FileChangeProposal[] {
  const css = `:root{--ink:#14231c;--paper:#f3efe6;--accent:#2f6f4e;--line:#c9c1b2}
*{box-sizing:border-box}body{margin:0;font-family:Georgia,serif;background:linear-gradient(160deg,#e8efe9,#f3efe6 45%,#efe6d8);color:var(--ink)}
main{max-width:960px;margin:0 auto;padding:2.5rem 1.25rem 4rem}h1{font-size:clamp(2rem,4vw,3rem);margin:0 0 .5rem}
.lede{max-width:36rem;line-height:1.5;opacity:.85}.grid{display:grid;gap:1rem;margin-top:2rem;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
article{padding:1.25rem;border-top:3px solid var(--accent)}.meta{list-style:none;padding:0;margin:1rem 0 0;font-size:.95rem;line-height:1.6}
`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vehicle Comparison</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main>
    <h1>Vehicle comparison</h1>
    <p class="lede">Three dummy vehicles for local mock code-generation review.</p>
    <section class="grid" id="vehicles" aria-label="Vehicle cards"></section>
  </main>
  <script type="module" src="./app.js"></script>
</body>
</html>
`;
  const js = `const vehicles = [
  { id: "v1", name: "Harbor Hatch", type: "Compact", range: "280 mi", price: "$28,400" },
  { id: "v2", name: "Ridge Wagon", type: "Wagon", range: "340 mi", price: "$36,900" },
  { id: "v3", name: "Coast Cruiser", type: "SUV", range: "310 mi", price: "$42,150" },
];
const root = document.getElementById("vehicles");
for (const v of vehicles) {
  const card = document.createElement("article");
  card.dataset.vehicleId = v.id;
  card.innerHTML = \`<h2>\${v.name}</h2><ul class="meta"><li>\${v.type}</li><li>Range \${v.range}</li><li>\${v.price}</li></ul>\`;
  root.appendChild(card);
}
`;
  const test = `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("./app.js", import.meta.url), "utf8");
assert.match(html, /Vehicle comparison/i);
assert.match(html, /id="vehicles"/);
assert.equal((js.match(/id: "v\\d"/g) || []).length, 3);
console.log("mock vehicle comparison tests passed");
`;
  return [
    { relativePath: `${rootDir}/index.html`, op: "CREATE", content: html, languageHint: "html" },
    { relativePath: `${rootDir}/styles.css`, op: "CREATE", content: css, languageHint: "css" },
    { relativePath: `${rootDir}/app.js`, op: "CREATE", content: js, languageHint: "javascript" },
    { relativePath: `${rootDir}/test.mjs`, op: "CREATE", content: test, languageHint: "javascript" },
  ];
}

/**
 * Deterministic mock coding provider — MOCK_GENERATION only.
 * Never claims live AI coding. No network. No credentials.
 */
export function createMockCodingProvider(): CodingProvider {
  return {
    id: "mock",
    privacy: CODING_PROVIDER_PRIVACY.mock,
    async generate(request: CodeGenerationRequest, signal?: AbortSignal): Promise<CodeGenerationResult> {
      const started = Date.now();
      const checkpointId = randomUUID();
      const attribution = {
        mode: "MOCK_GENERATION" as const,
        providerId: "mock" as const,
        model: "mock-codegen-v1",
        note: "Deterministic mock output. Not real AI code generation.",
      };

      if (signal?.aborted) {
        return {
          ok: false,
          reason: "CANCELLED",
          message: "Generation cancelled before start.",
          attribution,
          checkpointId,
        };
      }

      if (!providerSatisfiesClassification(this.privacy, request.classification)) {
        return {
          ok: false,
          reason: "PRIVACY_MISMATCH",
          message: "Mock provider cannot satisfy required classification.",
          attribution,
          checkpointId,
        };
      }

      if (request.classification === "RESTRICTED") {
        return {
          ok: false,
          reason: "PRIVACY_MISMATCH",
          message: "RESTRICTED data cannot be sent to coding providers in this foundation.",
          attribution,
          checkpointId,
        };
      }

      const objectiveOk = assertObjectiveSafe(request.objective);
      if (!objectiveOk.ok) {
        return { ok: false, reason: objectiveOk.reason, message: objectiveOk.message, attribution, checkpointId };
      }

      if (/provider unavailable/i.test(request.objective)) {
        return {
          ok: false,
          reason: "PROVIDER_UNAVAILABLE",
          message: "Mock provider forced unavailable for failure test.",
          attribution,
          checkpointId,
        };
      }

      // Simulate bounded work
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 15);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
        });
      }).catch(() => null);
      if (signal?.aborted) {
        return {
          ok: false,
          reason: "CANCELLED",
          message: "Generation cancelled.",
          attribution,
          checkpointId,
        };
      }

      const rootDir =
        request.objective === PILOT_03_OBJECTIVE || /vehicle comparison/i.test(request.objective)
          ? "generated/pilot-03-vehicle-comparison"
          : "generated/vehicle-comparison";
      const proposals = vehicleComparisonProposals(rootDir);
      const validated = validateProposals(proposals, request.allowedRelativeRoots, request.budget.maxOutputBytes);
      if (!validated.ok) {
        return { ok: false, reason: validated.reason, message: validated.message, attribution, checkpointId };
      }

      const inputTokens = estimateTokens(request.objective);
      const outputTokens = estimateTokens(validated.proposals.map((p) => p.content ?? "").join("\n"));
      if (wouldExceedTokenBudget(request.budget, inputTokens, outputTokens)) {
        return {
          ok: false,
          reason: "BUDGET_EXCEEDED",
          message: "Token budget exceeded for mock generation.",
          attribution,
          checkpointId,
        };
      }
      const estimatedCostUsd = 0;
      if (wouldExceedCost(request.budget, estimatedCostUsd)) {
        return {
          ok: false,
          reason: "BUDGET_EXCEEDED",
          message: "Cost budget exceeded.",
          attribution,
          checkpointId,
        };
      }

      const durationMs = Date.now() - started;
      if (durationMs > request.budget.maxDurationMs) {
        return {
          ok: false,
          reason: "TIMEOUT",
          message: "Mock generation exceeded duration budget.",
          attribution,
          checkpointId,
        };
      }

      // Stable content fingerprint for evidence (not a secret)
      createHash("sha256").update(validated.proposals.map((p) => p.relativePath + (p.content ?? "")).join("|")).digest("hex");

      return {
        ok: true,
        proposals: validated.proposals,
        attribution,
        usage: { inputTokens, outputTokens, estimatedCostUsd },
        checkpointId,
        durationMs,
      };
    },
  };
}
