"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimestamp } from "@/lib/format";
import { formatUsdCents, heatLevel } from "@/lib/sales-map/present";
import type { MapSummary } from "@/lib/sales-map/queries";
import {
  STATE_GRID_COLUMNS,
  STATE_GRID_ROWS,
  STATE_TILES,
  stateName,
} from "@/lib/sales-map/state-grid";

const TILE = 52;
const GAP = 6;
const DEPTH = 8;
const STEP = TILE + GAP;
const SVG_WIDTH = STATE_GRID_COLUMNS * STEP;
const SVG_HEIGHT = STATE_GRID_ROWS * STEP + DEPTH;

type Props = {
  summary: MapSummary;
  /** Path of this page, e.g. /companies/<id>/map. Filters are carried in the query string. */
  basePath: string;
};

function buildHref(basePath: string, summary: MapSummary, overrides: Record<string, string | null>) {
  const { filters } = summary;
  const params = new URLSearchParams();
  const current: Record<string, string | null> = {
    state: filters.state,
    zip: filters.zip,
    radius: filters.radiusMiles ? String(filters.radiusMiles) : null,
    lat: filters.center && !filters.center.zip ? String(filters.center.lat) : null,
    lng: filters.center && !filters.center.zip ? String(filters.center.lng) : null,
    from: filters.from,
    to: filters.to,
    ...overrides,
  };
  for (const [key, value] of Object.entries(current)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function SalesMapView({ summary, basePath }: Props) {
  const router = useRouter();
  const [tilted, setTilted] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const { aggregates, filters, sync } = summary;

  const byState = useMemo(
    () => new Map(aggregates.states.map((row) => [row.state, row])),
    [aggregates.states],
  );
  const prospectStates = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of summary.prospects) {
      if (row.state) out.set(row.state, (out.get(row.state) ?? 0) + row.prospectCount);
    }
    return out;
  }, [summary.prospects]);
  const maxRevenue = Math.max(0, ...aggregates.states.map((row) => row.revenueCents));

  const bubbles = useMemo(() => {
    const points = summary.zipPoints;
    if (points.length === 0) return [];
    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = Math.max(maxLat - minLat, 0.05);
    const spanLng = Math.max(maxLng - minLng, 0.05);
    const peak = Math.max(...points.map((point) => point.revenueCents), 1);
    return points.map((point) => ({
      ...point,
      x: 30 + ((point.lng - minLng) / spanLng) * 300,
      y: 30 + (1 - (point.lat - minLat) / spanLat) * 150,
      r: 6 + Math.sqrt(point.revenueCents / peak) * 14,
    }));
  }, [summary.zipPoints]);

  function selectState(code: string) {
    router.push(buildHref(basePath, summary, { state: filters.state === code ? null : code }));
  }

  function locateMe() {
    if (!("geolocation" in navigator)) {
      setGeoMessage("Location is not available in this browser.");
      return;
    }
    setGeoMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Rounded to ~1 km and only used as a search center — never stored.
        const lat = position.coords.latitude.toFixed(2);
        const lng = position.coords.longitude.toFixed(2);
        router.push(
          buildHref(basePath, summary, {
            zip: null,
            state: null,
            lat,
            lng,
            radius: String(filters.radiusMiles ?? 25),
          }),
        );
        setGeoMessage(null);
      },
      () => setGeoMessage("Location permission was not granted. You can still search by ZIP."),
      { maximumAge: 300000, timeout: 10000 },
    );
  }

  return (
    <div className="sales-map">
      <div className="sales-map-source" role="status">
        <span className="sales-map-chip" data-test={summary.hasTestData ? "true" : "false"}>
          {summary.hasTestData ? "Test data" : "Order data"}
        </span>
        <span>
          Source: <strong>{summary.dataSourceLabel}</strong>
        </span>
        <span>
          Last sync: <strong>{sync?.lastSyncedAt ? formatTimestamp(sync.lastSyncedAt) : "never synced"}</strong>
        </span>
        {sync && !sync.historyComplete ? (
          <span className="sales-map-chip" data-test="true">
            History incomplete — first-time counts may be high
          </span>
        ) : null}
      </div>
      {!sync?.lastSyncedAt && !summary.hasTestData && (
        <p className="notice">Sales coverage is unverified until order data syncs. The map cannot establish that sales are zero.</p>
      )}
      <p className="quiet">
        Aggregates only: totals by state and ZIP. No street addresses, names, or order details are
        shown.
      </p>
      {summary.notice ? (
        <p className="notice" role="status">
          {summary.notice}
        </p>
      ) : null}

      <form className="sales-map-filters" method="get" action={basePath}>
        {filters.state ? <input type="hidden" name="state" value={filters.state} /> : null}
        {filters.center && !filters.center.zip ? (
          <>
            <input type="hidden" name="lat" value={filters.center.lat} />
            <input type="hidden" name="lng" value={filters.center.lng} />
          </>
        ) : null}
        <label className="field">
          <span>ZIP search</span>
          <input
            name="zip"
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            placeholder="e.g. 10001"
            defaultValue={filters.zip ?? ""}
          />
        </label>
        <label className="field">
          <span>Radius (miles)</span>
          <select name="radius" defaultValue={filters.radiusMiles ? String(filters.radiusMiles) : ""}>
            <option value="">Exact ZIP only</option>
            {[10, 25, 50, 100, 250, 500].map((miles) => (
              <option key={miles} value={miles}>
                {miles} mi
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} />
        </label>
        <div className="sales-map-filter-actions">
          <button type="submit" className="button">
            Apply filters
          </button>
          <button type="button" className="button-secondary" onClick={locateMe}>
            Use my location
          </button>
          <a className="button-secondary" href={basePath}>
            Reset
          </a>
        </div>
      </form>
      {geoMessage ? (
        <p className="quiet" role="status">
          {geoMessage}
        </p>
      ) : null}

      <div className="sales-map-grid">
        <section className="today-card sales-map-card" aria-labelledby="map-states-heading">
          <div className="ghost-home-section-head ghost-home-section-head-row">
            <div>
              <p className="eyebrow">United States</p>
              <h2 id="map-states-heading">Sales by state</h2>
            </div>
            <label className="sales-map-toggle">
              <input
                type="checkbox"
                checked={tilted}
                onChange={(event) => setTilted(event.target.checked)}
              />
              <span>3D tilt</span>
            </label>
          </div>

          <div className="sales-map-stage" data-mode={tilted ? "tilt" : "flat"}>
            <div className="sales-map-plane">
              <svg
                viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                role="group"
                aria-label="Sales by state. Select a state to see its ZIP codes."
                className="sales-map-svg"
              >
                {STATE_TILES.map((tile) => {
                  const row = byState.get(tile.code);
                  const level = row ? heatLevel(row.revenueCents, maxRevenue) : 0;
                  const selected = filters.state === tile.code;
                  const x = tile.col * STEP;
                  const y = tile.row * STEP;
                  const prospects = prospectStates.get(tile.code) ?? 0;
                  return (
                    <g
                      key={tile.code}
                      className="sales-map-tile"
                      data-level={level}
                      data-selected={selected ? "true" : "false"}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      aria-label={`${stateName(tile.code)}${
                        row
                          ? `: ${row.orderCount} orders, ${formatUsdCents(row.revenueCents)}`
                          : ": no orders"
                      }`}
                      onClick={() => selectState(tile.code)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectState(tile.code);
                        }
                      }}
                    >
                      <rect className="sales-map-depth" x={x} y={y + DEPTH} width={TILE} height={TILE} rx={6} />
                      <rect className="sales-map-face" x={x} y={y} width={TILE} height={TILE} rx={6} />
                      <text x={x + TILE / 2} y={y + 22} textAnchor="middle" className="sales-map-code">
                        {tile.code}
                      </text>
                      <text x={x + TILE / 2} y={y + 38} textAnchor="middle" className="sales-map-value">
                        {row ? formatUsdCents(row.revenueCents) : "—"}
                      </text>
                      {prospects > 0 ? (
                        <circle className="sales-map-prospect" cx={x + TILE - 8} cy={y + 8} r={4}>
                          <title>{`${prospects} prospect(s) — not customers`}</title>
                        </circle>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
          <p className="quiet sales-map-legend">
            Darker = more revenue. Orange dot = prospects (kept separate from customers). Tiles are a
            simplified layout, not exact borders.
          </p>
        </section>

        <aside className="sales-map-side">
          <section className="today-card sales-map-card" aria-labelledby="map-totals-heading">
            <h2 id="map-totals-heading">Totals in view</h2>
            <dl className="sales-map-stats">
              <div>
                <dt>Paid orders</dt>
                <dd>{aggregates.totals.orderCount}</dd>
              </div>
              <div>
                <dt>Revenue</dt>
                <dd>{formatUsdCents(aggregates.totals.revenueCents)}</dd>
              </div>
              <div>
                <dt>First-time customers</dt>
                <dd>{aggregates.totals.firstTimeCustomers}</dd>
              </div>
              <div>
                <dt>Returning customers</dt>
                <dd>{aggregates.totals.returningCustomers}</dd>
              </div>
            </dl>
          </section>

          <section className="today-card sales-map-card" aria-labelledby="map-unmapped-heading">
            <h2 id="map-unmapped-heading">Not on the map</h2>
            <ul className="today-card-list">
              <li>
                <strong>Pickup</strong>: {aggregates.pickup.orderCount} orders ·{" "}
                {formatUsdCents(aggregates.pickup.revenueCents)}
              </li>
              <li>
                <strong>Missing / invalid ZIP</strong>: {aggregates.missingZip.orderCount} orders ·{" "}
                {formatUsdCents(aggregates.missingZip.revenueCents)}
              </li>
              <li>
                <strong>Refunds</strong>: {aggregates.refunds.orderCount} orders ·{" "}
                {formatUsdCents(aggregates.refunds.refundedCents)} refunded
                {aggregates.refunds.partialRefundCount > 0
                  ? ` (${aggregates.refunds.partialRefundCount} partial)`
                  : ""}
              </li>
              {summary.unlocatedZipCount > 0 ? (
                <li>
                  <strong>ZIPs without a reference location</strong>: {summary.unlocatedZipCount}
                </li>
              ) : null}
            </ul>
            <p className="quiet">
              Refunds are never plotted as customer locations. Hidden while an area filter is on:
              pickup and missing ZIP.
            </p>
          </section>

          <section className="today-card sales-map-card" aria-labelledby="map-prospects-heading">
            <h2 id="map-prospects-heading">Prospects (not customers)</h2>
            {summary.prospects.length === 0 ? (
              <p className="quiet">No prospects in view.</p>
            ) : (
              <ul className="today-card-list">
                {summary.prospects.map((row) => (
                  <li key={row.zip}>
                    ZIP {row.zip}
                    {row.city ? ` · ${row.city}` : ""}
                    {row.state ? `, ${row.state}` : ""} — {row.prospectCount}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <section className="today-card sales-map-card" aria-labelledby="map-zip-heading">
        <div className="ghost-home-section-head ghost-home-section-head-row">
          <div>
            <p className="eyebrow">
              {filters.state ? `${stateName(filters.state)} drilldown` : "ZIP detail"}
            </p>
            <h2 id="map-zip-heading">ZIP areas</h2>
          </div>
          {filters.state ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => router.push(buildHref(basePath, summary, { state: null }))}
            >
              Back to all states
            </button>
          ) : null}
        </div>

        {summary.zipPoints.length === 0 && aggregates.zips.length === 0 ? (
          <p className="empty">
            No mapped orders for these filters.
            {filters.state ? "" : " Pick a state or search a ZIP."}
          </p>
        ) : (
          <>
            {bubbles.length > 0 ? (
              <svg
                viewBox="0 0 360 210"
                className="sales-map-bubbles"
                role="img"
                aria-label="ZIP areas plotted by reference location, sized by revenue"
              >
                <rect x="0" y="0" width="360" height="210" rx="10" className="sales-map-bubbles-bg" />
                {bubbles.map((bubble) => (
                  <g key={bubble.zip}>
                    <circle cx={bubble.x} cy={bubble.y} r={bubble.r} className="sales-map-bubble">
                      <title>{`${bubble.zip} ${bubble.city}: ${bubble.orderCount} orders, ${formatUsdCents(bubble.revenueCents)}`}</title>
                    </circle>
                    <text x={bubble.x} y={bubble.y + 3} textAnchor="middle" className="sales-map-bubble-label">
                      {bubble.zip}
                    </text>
                  </g>
                ))}
              </svg>
            ) : null}
            <div className="sales-map-table-wrap">
              <table className="sales-map-table">
                <thead>
                  <tr>
                    <th scope="col">ZIP</th>
                    <th scope="col">City</th>
                    <th scope="col">State</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">First-time</th>
                    <th scope="col">Returning</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregates.zips.map((row) => {
                    const point = summary.zipPoints.find((entry) => entry.zip === row.zip);
                    return (
                      <tr key={row.zip}>
                        <th scope="row">{row.zip}</th>
                        <td>{point?.city || "—"}</td>
                        <td>{row.state ?? "—"}</td>
                        <td>{row.orderCount}</td>
                        <td>{formatUsdCents(row.revenueCents)}</td>
                        <td>{row.firstTimeCustomers}</td>
                        <td>{row.returningCustomers}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
