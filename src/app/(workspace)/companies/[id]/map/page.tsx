import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AssignWorkPanel } from "@/components/assignments/assign-work-panel";
import { SalesMapView } from "@/components/sales-map/sales-map-view";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { canViewMap, hasPermission, loadAccessContext } from "@/lib/access/permissions";
import { loadAssignPanelData } from "@/lib/assignments/queries";
import { describeMapScope } from "@/lib/assignments/types";
import { getSession } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/loose";
import {
  submitGrantMapAccessForm,
  submitMapAreaAssignmentForm,
  submitSeedTestOrdersForm,
} from "@/lib/sales-map/actions";
import { deriveMapScope } from "@/lib/sales-map/present";
import { loadMapSummary, type MapFilters } from "@/lib/sales-map/queries";

export const metadata: Metadata = {
  title: "Sales map",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function parseFilters(query: SearchParams): MapFilters {
  const date = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const number = (value: string) => {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const zip = first(query.zip);
  const state = first(query.state);
  const lat = number(first(query.lat));
  const lng = number(first(query.lng));
  return {
    state: /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null,
    zip: /^[0-9]{5}$/.test(zip) ? zip : null,
    radiusMiles: number(first(query.radius)),
    lat: lat !== null && Math.abs(lat) <= 90 ? lat : null,
    lng: lng !== null && Math.abs(lng) <= 180 ? lng : null,
    from: date(first(query.from)),
    to: date(first(query.to)),
  };
}

export default async function CompanySalesMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const { id } = await params;
  const query = await searchParams;
  if (!isUuid(id)) notFound();

  const access = await loadAccessContext(session.supabase, session.user.id, session.user.email);
  if (!canViewMap(access, id)) {
    return (
      <div className="ghost-home today-home">
        <header className="today-hero">
          <div className="today-hero-copy">
            <p className="ghost-brand">GHOST</p>
            <h1>Sales map</h1>
          </div>
        </header>
        <EmptyState>
          You don&apos;t have access to this company&apos;s sales map. Ask the company owner to grant
          map access.
        </EmptyState>
        <p>
          <Link href="/dashboard">Back to Today</Link>
        </p>
      </div>
    );
  }

  const filters = parseFilters(query);
  const [summaryResult, panel] = await Promise.all([
    loadMapSummary(session.supabase, id, filters),
    loadAssignPanelData(session.supabase).catch(() => ({ projects: [], teammates: [] })),
  ]);
  if (summaryResult.status === "error") {
    return <ErrorState message="The sales map could not be loaded right now." />;
  }
  const summary = summaryResult.data;

  const projects = panel.projects.filter((project) => project.companyId === id);
  const teammates = panel.teammates.filter((mate) => mate.companyId === id);
  const mapScope = deriveMapScope(summary);
  const isOwner = hasPermission(access, "map.grant", { companyId: id });
  const canAssign = projects.some((project) =>
    hasPermission(access, "assignment.create", { companyId: id, projectId: project.id }),
  );
  const uniqueTeammates = [...new Map(teammates.map((mate) => [mate.userId, mate])).values()];

  return (
    <div className="ghost-home today-home today-home-wide">
      <header className="today-hero">
        <div className="today-hero-copy">
          <p className="ghost-brand">GHOST</p>
          <h1>{summary.companyName ? `${summary.companyName} · Sales map` : "Sales map"}</h1>
          <p className="ghost-home-lede">
            Where orders come from — by state and ZIP. First-time vs returning customers, with
            refunds, pickup, and missing ZIPs kept separate.
          </p>
        </div>
      </header>

      <SalesMapView summary={summary} basePath={`/companies/${id}/map`} />

      <div className="sales-map-actions">
        {canAssign ? (
          <AssignWorkPanel
            mode="map"
            projects={projects}
            teammates={teammates}
            mapScope={mapScope}
            action={submitMapAreaAssignmentForm}
            heading={mapScope ? `Assign: ${describeMapScope(mapScope)}` : "Assign selected area"}
          />
        ) : (
          <p className="quiet">
            Only a founder or project admin can assign work from the map.
          </p>
        )}

        {isOwner ? (
          <section className="today-card sales-map-card" aria-labelledby="map-admin-heading">
            <div className="ghost-home-section-head">
              <p className="eyebrow">Owner tools</p>
              <h2 id="map-admin-heading">Map access and test data</h2>
            </div>
            <ActionForm action={submitSeedTestOrdersForm} submitLabel="Seed labeled test orders">
              <input type="hidden" name="companyId" value={id} />
              <p className="quiet">
                Adds TEST orders: first-time, returning, refund, pickup, and missing ZIP. Safe to
                repeat.
              </p>
            </ActionForm>
            {uniqueTeammates.length > 0 ? (
              <ActionForm action={submitGrantMapAccessForm} submitLabel="Grant map access">
                <input type="hidden" name="companyId" value={id} />
                <label className="field">
                  <span>Team member</span>
                  <select name="userId" required defaultValue="">
                    <option value="" disabled>
                      Choose a team member
                    </option>
                    {uniqueTeammates.map((mate) => (
                      <option key={mate.userId} value={mate.userId}>
                        {mate.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="quiet">Teammates see aggregate summaries only.</p>
              </ActionForm>
            ) : (
              <p className="quiet">Add team members to grant them map access.</p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
