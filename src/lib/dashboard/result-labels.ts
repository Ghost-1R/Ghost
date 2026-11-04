/**
 * Plain-language labels for worker / test results.
 * IDs, hashes, and raw logs belong under Technical details.
 */

export type ExplainedResult = {
  headline: string;
  summary: string;
  chargeLabel: string;
  isTestResult: boolean;
  stepsSaved: number | null;
  chargedCents: number | null;
  technicalLines: string[];
};

function parseContentMeta(content: string): {
  chargedCents: number | null;
  checkpoints: number | null;
  mode: string | null;
  taskId: string | null;
  lines: string[];
} {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pick = (key: string): string | null => {
    const row = lines.find((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}=`));
    return row ? row.slice(key.length + 1) : null;
  };
  const chargedRaw = pick("chargedCents");
  const checkpointsRaw = pick("checkpoints");
  const chargedCents =
    chargedRaw != null && chargedRaw !== "" && Number.isFinite(Number(chargedRaw))
      ? Number(chargedRaw)
      : null;
  const checkpoints =
    checkpointsRaw != null && checkpointsRaw !== "" && Number.isFinite(Number(checkpointsRaw))
      ? Number(checkpointsRaw)
      : null;
  return {
    chargedCents,
    checkpoints,
    mode: pick("mode"),
    taskId: pick("task"),
    lines,
  };
}

function formatCharge(cents: number | null, isTest: boolean): string {
  if (cents == null) {
    return isTest ? "Charge not recorded on this artifact" : "Charge not recorded";
  }
  const dollars = (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return isTest ? `${dollars} charged · test result (not live spend)` : `${dollars} charged`;
}

export function explainArtifactResult(input: {
  title: string;
  content: string;
  contentSha256?: string | null;
  kind?: string | null;
}): ExplainedResult {
  const meta = parseContentMeta(input.content);
  const isTestResult =
    /MOCK|TEST_RUN|test run|mock-step|MOCK_GENERATION/i.test(input.title) ||
    /MOCK|TEST_RUN|MOCK_GENERATION/i.test(input.content) ||
    meta.mode === "MOCK_GENERATION" ||
    meta.mode === "TEST_REVIEW";

  const checkpointMatch =
    input.title.match(/checkpoint\s*(\d+)/i) ||
    input.title.match(/saved after step\s*(\d+)/i) ||
    input.content.match(/checkpoint[:=]\S+:(\d+)/i);
  const stepFromTitle = checkpointMatch?.[1] ? Number(checkpointMatch[1]) : null;

  let headline = input.title;
  if (/^MOCK result/i.test(input.title) || /test run completed/i.test(input.title)) {
    headline = "Test run completed";
  } else if (/^Checkpoint\s+(\d+)/i.test(input.title)) {
    const step = input.title.match(/^Checkpoint\s+(\d+)/i)?.[1];
    headline = step ? `Saved after step ${step}` : "Saved checkpoint";
  } else if (/continue test run|continue MOCK/i.test(input.title)) {
    headline = "Continue test run";
  }

  const stepsSaved = meta.checkpoints ?? stepFromTitle;
  const chargedCents = meta.chargedCents ?? (isTestResult ? 0 : null);
  const chargeLabel = formatCharge(chargedCents, isTestResult);
  const summaryParts: string[] = [];
  if (stepsSaved != null && stepsSaved > 0) {
    summaryParts.push(`${stepsSaved} step${stepsSaved === 1 ? "" : "s"} saved`);
  }
  if (chargedCents != null) {
    summaryParts.push(
      chargedCents === 0 ? "$0 charged" : formatCharge(chargedCents, false).replace(/ charged.*/, " charged"),
    );
  }
  if (isTestResult) {
    summaryParts.push("Test result");
  }

  const technicalLines = [
    ...meta.lines,
    input.kind ? `kind=${input.kind}` : null,
    input.contentSha256 ? `sha256=${input.contentSha256}` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    headline,
    // Charge is included once in the summary line (not repeated as a separate label).
    summary: summaryParts.join(" · ") || (isTestResult ? "Test result saved" : "Saved result"),
    chargeLabel,
    isTestResult,
    stepsSaved,
    chargedCents,
    technicalLines,
  };
}

export function explainWorkerActionLabel(input: {
  status: string;
  checkpointSequence: number;
}): string {
  if (input.status === "SUCCEEDED") return "Test run completed";
  if (input.status === "QUEUED") return "Start test run";
  if (input.status === "BLOCKED") return "Resume test run";
  if (input.checkpointSequence > 0) return "Continue test run";
  return "Continue test run";
}

export function explainMockNotice(input: {
  completed: boolean;
  checkpointSequence: number;
  chargedCents?: number;
}): string {
  const charge =
    typeof input.chargedCents === "number"
      ? `${(input.chargedCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} charged`
      : "$0 charged";
  if (input.completed) {
    return `Test run completed. ${input.checkpointSequence} steps saved · ${charge}. This is a test result, not live spend.`;
  }
  return `Saved after step ${input.checkpointSequence}. ${charge}. Continue the test run when ready.`;
}

export function friendlyArtifactTitle(input: {
  completed: boolean;
  checkpointSequence: number;
  actionType?: string;
}): string {
  if (input.completed) return "Test run completed";
  return `Saved after step ${input.checkpointSequence}`;
}
