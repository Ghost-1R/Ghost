import { isMockSourceUrl } from "@/lib/command/outreach";
import { DIRECTORY_HOSTS } from "./types";

const PHONE_CTA_PATTERNS: RegExp[] = [
  /call\s+(us\s+)?for\s+(availability|a\s+quote|quotes?|enrollment|pricing|rates?|reservations?)/i,
  /to\s+enroll[,:]?\s*call/i,
  /for\s+availability[,:]?\s*call/i,
  /request\s+a\s+quote\s+by\s+phone/i,
  /phone\s+(only|required)\b/i,
  /must\s+call\s+to\s+(book|enroll|reserve|schedule)/i,
  /please\s+call\s+(us\s+)?to\s+(get|request|book|enroll)/i,
];

const JUNK_EMAIL = /^(noreply|no-reply|donotreply|mailer-daemon|privacy|legal)@/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export type QualifyInput = {
  title: string;
  url: string;
  description?: string;
  pageText?: string;
};

export type QualifyResult =
  | {
      ok: true;
      kind: "qualified" | "candidate";
      businessName: string;
      website: string;
      isDirectory: boolean;
      evidenceSignal: string;
      contactEmail: string;
      pitch: string;
    }
  | { ok: false; reason: string };

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isDirectoryHost(host: string): boolean {
  if (!host) return false;
  if (DIRECTORY_HOSTS.has(host)) return true;
  return [...DIRECTORY_HOSTS].some((entry) => host === entry || host.endsWith(`.${entry.replace(/^www\./, "")}`));
}

export function findEvidenceSignal(text: string): string | null {
  const haystack = text.replace(/\s+/g, " ").trim();
  if (!haystack) return null;
  for (const pattern of PHONE_CTA_PATTERNS) {
    const match = haystack.match(pattern);
    if (match?.[0]) return match[0].slice(0, 200);
  }
  return null;
}

export function extractPublicEmail(text: string): string {
  const matches = text.match(EMAIL_RE) ?? [];
  for (const raw of matches) {
    const email = raw.toLowerCase();
    if (JUNK_EMAIL.test(email)) continue;
    if (email.endsWith("@example.com") || email.endsWith(".example")) continue;
    if (email.includes("sentry.io") || email.includes("wixpress.com")) continue;
    return email.slice(0, 320);
  }
  return "";
}

export function buildPitch(input: {
  businessName: string;
  service: string;
  evidenceSignal: string;
  market: string;
}): string {
  const serviceLabel =
    input.service === "app"
      ? "a simple booking app"
      : input.service === "ads"
        ? "local ad campaigns that capture phone-intent traffic"
        : "a clear website with online inquiry instead of phone-only steps";
  return [
    `${input.businessName} in ${input.market} still routes customers through a phone CTA (“${input.evidenceSignal}”).`,
    `That is a concrete signal they may need ${serviceLabel}.`,
  ]
    .join(" ")
    .slice(0, 2000);
}

export function buildOutreachDraft(input: {
  businessName: string;
  founderName: string;
  evidenceSignal: string;
  service: string;
}): string {
  const serviceBit =
    input.service === "app"
      ? "an easier way for customers to book online"
      : input.service === "ads"
        ? "local ads that match how people already try to reach you"
        : "a website path that does not force every customer to call first";
  return [
    `Hello ${input.businessName},`,
    "",
    `My name is ${input.founderName}. I noticed your site asks customers to “${input.evidenceSignal}” and wanted to share a short idea for ${serviceBit}.`,
    "",
    "Happy to keep this brief if useful.",
    "",
    `Thank you,`,
    input.founderName,
  ].join("\n");
}

/**
 * Qualify a Brave hit using only observable text (snippet and/or fetched page).
 * Never invents emails or business needs.
 */
export function qualifyLeadHit(input: QualifyInput & { service: string; market: string }): QualifyResult {
  if (isMockSourceUrl(input.url)) {
    return { ok: false, reason: "MOCK results are excluded from automated lead saves." };
  }
  if (!/^https?:\/\//i.test(input.url)) {
    return { ok: false, reason: "URL is not http(s)." };
  }
  const host = hostnameOf(input.url);
  if (!host) return { ok: false, reason: "URL host missing." };
  const directory = isDirectoryHost(host);
  const corpus = [input.title, input.description ?? "", input.pageText ?? ""].join("\n");
  const signal = findEvidenceSignal(corpus);
  const email = extractPublicEmail(corpus);
  const businessName = input.title.replace(/\s*[|\-–].*$/, "").trim().slice(0, 200) || input.title.slice(0, 200);

  if (!signal) {
    // Directory without a specific phone CTA stays out — discovery only, not a save.
    if (directory) {
      return { ok: false, reason: "Directory listing without an observable phone CTA signal." };
    }
    // Business site without signal → unverified candidate for New leads.
    return {
      ok: true,
      kind: "candidate",
      businessName,
      website: input.url.slice(0, 2000),
      isDirectory: false,
      evidenceSignal: "",
      contactEmail: "",
      pitch: `Unverified candidate from ${input.market}. No phone-CTA evidence found yet — needs human review.`,
    };
  }

  // Prefer business-owned sites; directory with signal is still a candidate (not auto-waiting).
  if (directory) {
    return {
      ok: true,
      kind: "candidate",
      businessName,
      website: input.url.slice(0, 2000),
      isDirectory: true,
      evidenceSignal: signal,
      contactEmail: "",
      pitch: buildPitch({
        businessName,
        service: input.service,
        evidenceSignal: signal,
        market: input.market,
      }),
    };
  }

  const pitch = buildPitch({
    businessName,
    service: input.service,
    evidenceSignal: signal,
    market: input.market,
  });

  if (email) {
    return {
      ok: true,
      kind: "qualified",
      businessName,
      website: input.url.slice(0, 2000),
      isDirectory: false,
      evidenceSignal: signal,
      contactEmail: email,
      pitch,
    };
  }

  return {
    ok: true,
    kind: "candidate",
    businessName,
    website: input.url.slice(0, 2000),
    isDirectory: false,
    evidenceSignal: signal,
    contactEmail: "",
    pitch,
  };
}

export async function fetchPageText(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(timer);
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(contentType) && contentType) return "";
    const html = await response.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40_000);
  } catch {
    return "";
  }
}
