/**
 * Brave web search for Opportunity Radar prospect discovery.
 * Keys stay server-side. Missing keys fail closed for LIVE and return labeled MOCK results for local UI tests.
 */

export type ProspectSearchHit = {
  title: string;
  url: string;
  description: string;
  locationHint: string;
};

export type ProspectSearchResult =
  | {
      ok: true;
      mode: "live" | "mock";
      setupMessage: string | null;
      query: string;
      results: ProspectSearchHit[];
    }
  | {
      ok: false;
      mode: "setup" | "error";
      setupMessage: string;
      query: string;
      results: ProspectSearchHit[];
    };

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 8;

function normalizeQuery(businessType: string, city: string): string {
  const type = businessType.trim().slice(0, 120);
  const place = city.trim().slice(0, 120);
  return `${type} ${place}`.trim();
}

function mockHits(businessType: string, city: string): ProspectSearchHit[] {
  const place = city.trim() || "Local area";
  const type = businessType.trim() || "business";
  const slug = encodeURIComponent(place.toLowerCase().replace(/\s+/g, "-"));
  return [
    {
      title: `${place} Fresh Market`,
      url: `https://example.com/mock/${slug}-fresh-market`,
      description: `Independent ${type} serving ${place}. Public contact page (MOCK).`,
      locationHint: place,
    },
    {
      title: `${place} Family Foods`,
      url: `https://example.com/mock/${slug}-family-foods`,
      description: `Neighborhood ${type} near ${place}. Verify email on the source page (MOCK).`,
      locationHint: place,
    },
    {
      title: `Corner Grocer of ${place}`,
      url: `https://example.com/mock/${slug}-corner-grocer`,
      description: `Small ${type} listing for ${place}. MOCK — not a live Brave result.`,
      locationHint: place,
    },
  ].slice(0, MAX_RESULTS);
}

function mapBraveWebResults(
  payload: unknown,
  locationHint: string,
): ProspectSearchHit[] {
  if (!payload || typeof payload !== "object") return [];
  const web = (payload as { web?: { results?: unknown } }).web;
  const rows = Array.isArray(web?.results) ? web.results : [];
  const hits: ProspectSearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    const description =
      typeof entry.description === "string"
        ? entry.description.trim()
        : typeof entry.extra_snippets === "object" &&
            Array.isArray((entry.extra_snippets as { description?: string }[]))
          ? String((entry.extra_snippets as { description?: string }[])[0]?.description ?? "")
          : "";
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    hits.push({
      title: title.slice(0, 200),
      url: url.slice(0, 2000),
      description: description.slice(0, 500),
      locationHint,
    });
    if (hits.length >= MAX_RESULTS) break;
  }
  return hits;
}

/** Server-only Brave search. Never logs the API key. */
export async function searchProspectsWithBrave(input: {
  businessType: string;
  city: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ProspectSearchResult> {
  const businessType = input.businessType.trim();
  const city = input.city.trim();
  const query = normalizeQuery(businessType, city);
  if (businessType.length < 2 || city.length < 2) {
    return {
      ok: false,
      mode: "error",
      setupMessage: "Enter a business type and city (for example, independent grocery stores · Norcross, GA).",
      query,
      results: [],
    };
  }

  const apiKey = (input.apiKey ?? process.env.BRAVE_SEARCH_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      ok: true,
      mode: "mock",
      setupMessage:
        "BRAVE_SEARCH_API_KEY is not configured. Showing labeled MOCK results for local UI testing. Add the key to .env.local (server-side) to activate live Brave Search. Manual opportunity entry stays available.",
      query,
      results: mockHits(businessType, city),
    };
  }

  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));

  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        mode: "error",
        setupMessage: `Brave Search returned HTTP ${response.status}. Manual entry remains available.`,
        query,
        results: [],
      };
    }
    const payload = (await response.json()) as unknown;
    const results = mapBraveWebResults(payload, city);
    return {
      ok: true,
      mode: "live",
      setupMessage: null,
      query,
      results,
    };
  } catch {
    return {
      ok: false,
      mode: "error",
      setupMessage: "Brave Search could not be reached. Manual entry remains available.",
      query,
      results: [],
    };
  }
}

export function buildProspectMailto(input: {
  email: string;
  businessName: string;
  founderName?: string;
}): string | null {
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = input.businessName.trim() || "your team";
  const from = input.founderName?.trim() || "Ghost";
  const subject = encodeURIComponent(`Introduction — ${name}`);
  const body = encodeURIComponent(
    [
      `Hello ${name},`,
      "",
      `My name is ${from}. I came across your business and wanted to introduce myself briefly.`,
      "",
      "I would welcome a short conversation if you are open to it.",
      "",
      "Thank you,",
      from,
    ].join("\n"),
  );
  return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}
