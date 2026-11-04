import type { MapScope } from "@/lib/assignments/types";
import type { MapSummary } from "@/lib/sales-map/queries";

/** "$1,234" (whole dollars) or "$12.34" under $100. */
export function formatUsdCents(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dollars < 100 && cents % 100 !== 0 ? 2 : 0,
    maximumFractionDigits: dollars < 100 ? 2 : 0,
  }).format(dollars);
}

/** 0..4 heat level relative to the largest value. 0 means no activity. */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/**
 * The aggregate-only scope for "Assign selected area". Null until the user picks a state,
 * ZIP, or radius. Never includes order ids, customer keys, or addresses.
 */
export function deriveMapScope(summary: Pick<MapSummary, "filters" | "zipPoints">): MapScope | null {
  const { state, zip, radiusMiles, center, from, to } = summary.filters;
  const scope: MapScope = {
    states: state ? [state] : [],
    zips: [],
    radius: null,
    dateFrom: from,
    dateTo: to,
  };
  if (radiusMiles && center) {
    if (center.zip) scope.radius = { centerZip: center.zip, miles: radiusMiles };
    else scope.zips = summary.zipPoints.map((point) => point.zip).slice(0, 200);
  } else if (zip) {
    scope.zips = [zip];
  }
  const empty = scope.states.length === 0 && scope.zips.length === 0 && !scope.radius;
  return empty ? null : scope;
}
