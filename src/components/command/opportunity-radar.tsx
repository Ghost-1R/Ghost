"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertOpportunityToProposalTask,
  createOpportunity,
  saveProspect,
  searchProspects,
  updateOutreachLead,
} from "@/lib/command/actions";
import { buildProspectMailto, type ProspectSearchHit } from "@/lib/command/brave-search";
import {
  OUTREACH_SECTION,
  OUTREACH_SERVICES,
  OUTREACH_STAGES,
  isMockSourceUrl,
  type OutreachStage,
} from "@/lib/command/outreach";
import {
  approveAndQueueOutreach,
  recordOutreachEligibility,
} from "@/lib/outreach-worker/actions";
import { defaultSubject } from "@/lib/outreach-worker/compliance";
import { requiredEmailScope, scopeLabel } from "@/lib/outreach-worker/eligibility";
import type { CommandOpportunity } from "@/lib/command/types";
import type { OutreachBoardState } from "@/lib/outreach-worker/types";
import styles from "./command.module.css";

type Props = {
  opportunities: CommandOpportunity[];
  opportunityBlocker: string | null;
  companies: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; companyId: string }>;
  companyFilterId: string | null;
  founderName: string;
  outreachWorker: OutreachBoardState;
};

type Filters = {
  service: string;
  industry: string;
  market: string;
  emailOnFile: "any" | "yes" | "no";
  followUpDue: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OpportunityRadar({
  opportunities,
  opportunityBlocker,
  companies,
  projects,
  companyFilterId,
  founderName,
  outreachWorker,
}: Props) {
  const router = useRouter();
  const [searchPending, startSearch] = useTransition();
  const [pipelinePending, startPipeline] = useTransition();
  const pending = searchPending || pipelinePending;
  const [businessType, setBusinessType] = useState("independent grocery stores");
  const [city, setCity] = useState("Norcross, GA");
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<"idle" | "live" | "mock" | "error">("idle");
  const [hits, setHits] = useState<ProspectSearchHit[]>([]);
  const [draftEmails, setDraftEmails] = useState<Record<string, string>>({});
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pipelineNotice, setPipelineNotice] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [fitDrafts, setFitDrafts] = useState<Record<string, string>>({});
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, string>>({});
  const [serviceDrafts, setServiceDrafts] = useState<Record<string, string>>({});
  const [industryDrafts, setIndustryDrafts] = useState<Record<string, string>>({});
  const [subjectDrafts, setSubjectDrafts] = useState<Record<string, string>>({});
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [permSource, setPermSource] = useState<Record<string, string>>({});
  const [permNotes, setPermNotes] = useState<Record<string, string>>({});
  const [permKind, setPermKind] = useState<Record<string, string>>({});
  const [permDate, setPermDate] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<Filters>({
    service: "",
    industry: "",
    market: "",
    emailOnFile: "any",
    followUpDue: false,
  });

  const defaultCompanyId = companyFilterId ?? companies[0]?.id ?? "";
  const companyName = useMemo(() => {
    const map = new Map(companies.map((company) => [company.id, company.name]));
    return (id: string) => map.get(id) ?? "Company";
  }, [companies]);

  const pipelineLeads = useMemo(
    () =>
      opportunities.filter(
        (item) => !item.isMock && !isMockSourceUrl(item.sourceUrl) && !item.doNotContact,
      ),
    [opportunities],
  );

  const filteredLeads = useMemo(() => {
    const today = todayIso();
    return pipelineLeads.filter((item) => {
      if (filters.service && item.serviceInterest !== filters.service) return false;
      if (
        filters.industry &&
        !item.industry.toLowerCase().includes(filters.industry.trim().toLowerCase())
      ) {
        return false;
      }
      if (
        filters.market &&
        !(item.market || item.geography)
          .toLowerCase()
          .includes(filters.market.trim().toLowerCase())
      ) {
        return false;
      }
      if (filters.emailOnFile === "yes" && !item.contactEmail) return false;
      if (filters.emailOnFile === "no" && item.contactEmail) return false;
      if (filters.followUpDue) {
        if (
          (item.outreachStage !== "sent" && item.outreachStage !== "delivered") ||
          !item.followUpOn ||
          item.followUpOn > today
        ) {
          return false;
        }
      }
      return true;
    });
  }, [pipelineLeads, filters]);

  const byStage = useMemo(() => {
    const groups = Object.fromEntries(OUTREACH_STAGES.map((stage) => [stage, [] as CommandOpportunity[]])) as Record<
      OutreachStage,
      CommandOpportunity[]
    >;
    for (const lead of filteredLeads) {
      groups[lead.outreachStage].push(lead);
    }
    return groups;
  }, [filteredLeads]);

  const onSearch = () => {
    setSaveNotice(null);
    setSaveError(null);
    startSearch(async () => {
      const form = new FormData();
      form.set("businessType", businessType);
      form.set("city", city);
      const result = await searchProspects(form);
      setSearchNotice(result.setupMessage);
      setHits(result.results);
      setSearchMode(result.ok ? result.mode : result.mode === "setup" ? "error" : result.mode);
    });
  };

  const onSave = (hit: ProspectSearchHit) => {
    setSaveNotice(null);
    setSaveError(null);
    startPipeline(async () => {
      const form = new FormData();
      form.set("companyId", defaultCompanyId);
      form.set("title", hit.title);
      form.set("geography", hit.locationHint || city);
      form.set("market", hit.locationHint || city);
      form.set("sourceUrl", hit.url);
      form.set("contactEmail", draftEmails[hit.url] ?? "");
      form.set("fitReason", `Discovered via Brave search for ${businessType} in ${city}.`);
      const result = await saveProspect(form);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setSaveNotice(result.notice);
      router.refresh();
    });
  };

  const runOutreach = (opportunityId: string, action: string, extra?: Record<string, string>) => {
    setPipelineNotice(null);
    setPipelineError(null);
    startPipeline(async () => {
      const form = new FormData();
      form.set("opportunityId", opportunityId);
      form.set("action", action);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          form.set(key, value);
        }
      }
      const result = await updateOutreachLead(form);
      if (!result.ok) {
        setPipelineError(result.error);
        return;
      }
      setPipelineNotice(result.notice);
      router.refresh();
    });
  };

  const approveQueue = (item: CommandOpportunity, extra: Record<string, string>) => {
    setPipelineNotice(null);
    setPipelineError(null);
    startPipeline(async () => {
      const form = new FormData();
      form.set("opportunityId", item.id);
      form.set("recipientEmail", extra.contactEmail || item.contactEmail);
      form.set("subject", extra.subject);
      form.set("body", extra.body);
      if (extra.isFollowUp === "1") form.set("isFollowUp", "1");
      const result = await approveAndQueueOutreach(form);
      if (!result.ok) {
        setPipelineError(result.error);
        return;
      }
      setPipelineNotice(result.notice);
      router.refresh();
    });
  };

  const savePermission = (item: CommandOpportunity, contactEmail: string) => {
    setPipelineNotice(null);
    setPipelineError(null);
    startPipeline(async () => {
      const isFollowUp = item.outreachStage === "sent" || item.outreachStage === "delivered";
      const scope = requiredEmailScope({
        isFollowUp,
        serviceInterest: item.serviceInterest,
      });
      const form = new FormData();
      form.set("opportunityId", item.id);
      form.set("recipientEmail", contactEmail);
      form.set("kind", permKind[item.id] || "documented_request");
      form.set("scope", scope);
      form.set("source", permSource[item.id] || "");
      form.set("notes", permNotes[item.id] || "");
      if (permDate[item.id]) form.set("recordedAt", permDate[item.id]);
      const result = await recordOutreachEligibility(form);
      if (!result.ok) {
        setPipelineError(result.error);
        return;
      }
      setPipelineNotice(result.notice);
      router.refresh();
    });
  };

  const mailtoFor = useMemo(
    () => (item: CommandOpportunity, subject: string, body: string) => {
      if (!item.contactEmail) return null;
      if (body.trim()) {
        return `mailto:${encodeURIComponent(item.contactEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
      return buildProspectMailto({
        email: item.contactEmail,
        businessName: item.title,
        founderName,
      });
    },
    [founderName],
  );

  return (
    <div className={styles.panel} id="radar">
      <h2>Opportunity Radar</h2>
      {opportunityBlocker ? (
        <p className={styles.blocker} role="status">
          {opportunityBlocker}
        </p>
      ) : null}

      <div className={styles.list}>
        <strong>Find prospects</strong>
        <label className={styles.muted} htmlFor="prospect-type">
          Business type
        </label>
        <input
          id="prospect-type"
          value={businessType}
          onChange={(event) => setBusinessType(event.target.value)}
          maxLength={120}
          placeholder="independent grocery stores"
        />
        <label className={styles.muted} htmlFor="prospect-city">
          City
        </label>
        <input
          id="prospect-city"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          maxLength={120}
          placeholder="Norcross, GA"
        />
        <button type="button" className={styles.goldBtn} onClick={onSearch} disabled={searchPending}>
          {searchPending ? "Searching…" : "Find prospects"}
        </button>
        {searchNotice ? (
          <p className={styles.blocker} role="status">
            {searchNotice}
          </p>
        ) : null}
        {searchMode === "mock" ? (
          <p className={styles.muted}>
            Results labeled MOCK — they will not appear in the outreach pipeline if saved.
          </p>
        ) : null}
        {hits.length > 0 ? (
          <div className={styles.list}>
            {hits.map((hit) => {
              const mockHit = isMockSourceUrl(hit.url) || searchMode === "mock";
              return (
                <article key={hit.url} className={styles.row}>
                  <strong>
                    {hit.title}
                    {mockHit ? " · MOCK" : ""}
                  </strong>
                  <span className={styles.muted}>{hit.description || hit.locationHint}</span>
                  <a href={hit.url} target="_blank" rel="noreferrer">
                    Open source page
                  </a>
                  <label className={styles.muted} htmlFor={`email-${hit.url}`}>
                    Public email (verify on the source page)
                  </label>
                  <input
                    id={`email-${hit.url}`}
                    type="email"
                    value={draftEmails[hit.url] ?? ""}
                    onChange={(event) =>
                      setDraftEmails((current) => ({ ...current, [hit.url]: event.target.value }))
                    }
                    placeholder="optional@business.example"
                  />
                  <button
                    type="button"
                    onClick={() => onSave(hit)}
                    disabled={pending || !defaultCompanyId}
                  >
                    Save prospect
                  </button>
                </article>
              );
            })}
          </div>
        ) : null}
        {saveError ? (
          <p className={styles.blocker} role="alert">
            {saveError}
          </p>
        ) : null}
        {saveNotice ? (
          <p className={styles.muted} role="status">
            {saveNotice}
          </p>
        ) : null}
      </div>

      <div className={styles.pipeline} style={{ marginTop: 16 }}>
        <strong>Outreach pipeline</strong>
        <p className={styles.muted}>
          Stages are separate from research-task status. Opening a draft never sends. Approve &amp;
          queue hands exact sender/recipient/subject/body to Outreach; Sent only after provider
          acceptance. Manual Mark as sent remains for mailto-outside-Ghost.
        </p>

        <div className={styles.pipelineFilters}>
          <label>
            Service
            <select
              value={filters.service}
              onChange={(event) => setFilters((current) => ({ ...current, service: event.target.value }))}
            >
              <option value="">All services</option>
              {OUTREACH_SERVICES.map((service) => (
                <option key={service} value={service}>
                  {service}
                </option>
              ))}
            </select>
          </label>
          <label>
            Industry
            <input
              value={filters.industry}
              onChange={(event) =>
                setFilters((current) => ({ ...current, industry: event.target.value }))
              }
              placeholder="e.g. grocery"
              maxLength={120}
            />
          </label>
          <label>
            Market
            <input
              value={filters.market}
              onChange={(event) =>
                setFilters((current) => ({ ...current, market: event.target.value }))
              }
              placeholder="e.g. Norcross"
              maxLength={120}
            />
          </label>
          <label>
            Business email
            <select
              value={filters.emailOnFile}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  emailOnFile: event.target.value as Filters["emailOnFile"],
                }))
              }
            >
              <option value="any">Any</option>
              <option value="yes">On file</option>
              <option value="no">Missing</option>
            </select>
          </label>
          <label className={styles.pipelineCheck}>
            <input
              type="checkbox"
              checked={filters.followUpDue}
              onChange={(event) =>
                setFilters((current) => ({ ...current, followUpDue: event.target.checked }))
              }
            />
            Follow-up due
          </label>
        </div>

        {pipelineError ? (
          <p className={styles.blocker} role="alert">
            {pipelineError}
          </p>
        ) : null}
        {pipelineNotice ? (
          <p className={styles.muted} role="status">
            {pipelineNotice}
          </p>
        ) : null}

        {!opportunityBlocker && pipelineLeads.length === 0 ? (
          <p className={styles.muted}>No outreach leads yet. Search or add one manually.</p>
        ) : null}

        {OUTREACH_STAGES.map((stage) => {
          const section = OUTREACH_SECTION[stage];
          const leads = byStage[stage];
          return (
            <section key={stage} className={styles.pipelineSection} data-tone={section.tone}>
              <header>
                <h3>
                  {section.label}
                  <span className={styles.muted}> · {leads.length}</span>
                </h3>
              </header>
              {leads.length === 0 ? (
                <p className={styles.muted}>None in this stage.</p>
              ) : (
                <div className={styles.list}>
                  {leads.map((item) => {
                    const companyProjects = projects.filter(
                      (project) => project.companyId === item.companyId,
                    );
                    const emailValue = emailDrafts[item.id] ?? item.contactEmail;
                    const fitValue = fitDrafts[item.id] ?? item.fitReason;
                    const followUpValue = followUpDrafts[item.id] ?? item.followUpOn ?? "";
                    const serviceValue = serviceDrafts[item.id] ?? item.serviceInterest;
                    const industryValue = industryDrafts[item.id] ?? item.industry;
                    const subjectValue =
                      subjectDrafts[item.id] ??
                      item.outreachSubject ??
                      defaultSubject(item.title);
                    const bodyValue = bodyDrafts[item.id] ?? item.outreachDraft ?? "";
                    const mailto = mailtoFor(
                      { ...item, contactEmail: emailValue },
                      subjectValue,
                      bodyValue,
                    );
                    return (
                      <article key={item.id} className={styles.pipelineCard}>
                        <strong>{item.title}</strong>
                        <span className={styles.muted}>
                          {companyName(item.companyId)} · {item.market || item.geography}
                          {item.serviceInterest ? ` · ${item.serviceInterest}` : ""}
                          {item.industry ? ` · ${item.industry}` : ""}
                          {item.contactEmail ? ` · ${item.contactEmail}` : ""}
                          {item.discoveredByWorker
                            ? ` · found by ${item.discoveredByWorker}`
                            : ""}
                        </span>
                        {item.sourceUrl ? (
                          <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                            Source
                          </a>
                        ) : null}
                        {item.evidenceSignal ? (
                          <span className={styles.muted}>Evidence: {item.evidenceSignal}</span>
                        ) : null}
                        {item.needsPermission ? (
                          <p className={styles.blocker} role="status">
                            Needs permission — public email alone is not enough to queue or send
                            (including SES). Record an opt-in or documented request for{" "}
                            {scopeLabel(
                              requiredEmailScope({
                                isFollowUp:
                                  item.outreachStage === "sent" ||
                                  item.outreachStage === "delivered",
                                serviceInterest: item.serviceInterest,
                              }),
                            )}
                            . Lead stays available for review.
                          </p>
                        ) : null}
                        {(item.eligibility?.length ?? 0) > 0 ? (
                          <span className={styles.muted}>
                            Permission on file:{" "}
                            {(item.eligibility ?? [])
                              .slice(0, 2)
                              .map(
                                (entry) =>
                                  `${entry.kind === "opt_in" ? "opt-in" : "documented request"} · ${entry.scope} · ${new Date(entry.recordedAt).toLocaleDateString()} · ${entry.source}`,
                              )
                              .join("; ")}
                          </span>
                        ) : null}
                        {item.fitReason ? (
                          <span className={styles.muted}>Why: {item.fitReason}</span>
                        ) : null}
                        {item.sentAt ? (
                          <span className={styles.muted}>
                            Sent {new Date(item.sentAt).toLocaleString()}
                            {item.followUpOn ? ` · Follow up ${item.followUpOn}` : ""}
                            {item.outreachMessageId ? ` · msg ${item.outreachMessageId.slice(0, 8)}` : ""}
                          </span>
                        ) : null}

                        {(stage === "new" ||
                          stage === "waiting" ||
                          stage === "sent" ||
                          stage === "delivered" ||
                          stage === "needs_attention") && (
                          <div className={styles.pipelineFields}>
                            <label className={styles.muted} htmlFor={`fit-${item.id}`}>
                              Why they might need our service
                            </label>
                            <textarea
                              id={`fit-${item.id}`}
                              value={fitValue}
                              onChange={(event) =>
                                setFitDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              maxLength={2000}
                              rows={2}
                            />
                            <label className={styles.muted} htmlFor={`svc-${item.id}`}>
                              Service
                            </label>
                            <select
                              id={`svc-${item.id}`}
                              value={serviceValue}
                              onChange={(event) =>
                                setServiceDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Unset</option>
                              {OUTREACH_SERVICES.map((service) => (
                                <option key={service} value={service}>
                                  {service}
                                </option>
                              ))}
                            </select>
                            <label className={styles.muted} htmlFor={`ind-${item.id}`}>
                              Industry
                            </label>
                            <input
                              id={`ind-${item.id}`}
                              value={industryValue}
                              onChange={(event) =>
                                setIndustryDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              maxLength={120}
                              placeholder="Industry"
                            />
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                runOutreach(item.id, "save_details", {
                                  fitReason: fitValue,
                                  industry: industryValue,
                                  market: item.market || item.geography,
                                  serviceInterest: serviceValue,
                                })
                              }
                            >
                              Save why / details
                            </button>
                          </div>
                        )}

                        {stage === "new" ? (
                          <div className={styles.pipelineActions}>
                            <button
                              type="button"
                              className={styles.goldBtn}
                              disabled={pending}
                              onClick={() =>
                                runOutreach(item.id, "move_to_review", {
                                  fitReason: fitValue,
                                })
                              }
                            >
                              Move to review
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => runOutreach(item.id, "close")}
                            >
                              Close lead
                            </button>
                          </div>
                        ) : null}

                        {stage === "waiting" || stage === "needs_attention" ? (
                          <div className={styles.pipelineFields}>
                            {item.evidenceSignal ? (
                              <p className={styles.muted}>
                                Evidence on file: {item.evidenceSignal}
                              </p>
                            ) : (
                              <p className={styles.muted}>
                                No phone-CTA evidence recorded — review carefully before approving.
                              </p>
                            )}
                            <label className={styles.muted} htmlFor={`wait-email-${item.id}`}>
                              Verified public business email
                            </label>
                            <input
                              id={`wait-email-${item.id}`}
                              type="email"
                              value={emailValue}
                              onChange={(event) =>
                                setEmailDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              placeholder="hello@business.example"
                            />
                            <label className={styles.muted} htmlFor={`wait-sender-${item.id}`}>
                              Sender (Badger United)
                            </label>
                            <input
                              id={`wait-sender-${item.id}`}
                              type="email"
                              value={outreachWorker.senderEmail || ""}
                              readOnly
                              placeholder="Configure sender in Shift Intelligence → Outreach"
                            />
                            <label className={styles.muted} htmlFor={`perm-kind-${item.id}`}>
                              Permission kind
                            </label>
                            <select
                              id={`perm-kind-${item.id}`}
                              value={permKind[item.id] || "documented_request"}
                              onChange={(event) =>
                                setPermKind((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="documented_request">Documented request</option>
                              <option value="opt_in">Opt-in</option>
                            </select>
                            <label className={styles.muted} htmlFor={`perm-source-${item.id}`}>
                              Permission source
                            </label>
                            <input
                              id={`perm-source-${item.id}`}
                              value={permSource[item.id] ?? ""}
                              onChange={(event) =>
                                setPermSource((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              placeholder="e.g. reply to intro call · voicemail 11/4 · signed form"
                              maxLength={500}
                            />
                            <label className={styles.muted} htmlFor={`perm-date-${item.id}`}>
                              Permission date
                            </label>
                            <input
                              id={`perm-date-${item.id}`}
                              type="date"
                              value={permDate[item.id] ?? ""}
                              onChange={(event) =>
                                setPermDate((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            />
                            <label className={styles.muted} htmlFor={`perm-notes-${item.id}`}>
                              Permission notes (optional)
                            </label>
                            <input
                              id={`perm-notes-${item.id}`}
                              value={permNotes[item.id] ?? ""}
                              onChange={(event) =>
                                setPermNotes((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              placeholder="Scope is set from service / follow-up type"
                              maxLength={1000}
                            />
                            <button
                              type="button"
                              disabled={pending || !emailValue}
                              onClick={() => savePermission(item, emailValue)}
                            >
                              Save permission (
                              {scopeLabel(
                                requiredEmailScope({
                                  isFollowUp: false,
                                  serviceInterest: item.serviceInterest,
                                }),
                              )}
                              )
                            </button>
                            <label className={styles.muted} htmlFor={`wait-subject-${item.id}`}>
                              Subject
                            </label>
                            <input
                              id={`wait-subject-${item.id}`}
                              value={subjectValue}
                              onChange={(event) =>
                                setSubjectDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              maxLength={300}
                            />
                            <label className={styles.muted} htmlFor={`wait-body-${item.id}`}>
                              Message
                            </label>
                            <textarea
                              id={`wait-body-${item.id}`}
                              value={bodyValue}
                              onChange={(event) =>
                                setBodyDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              rows={6}
                              maxLength={4000}
                            />
                            <div className={styles.pipelineActions}>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() =>
                                  runOutreach(item.id, "save_email", {
                                    contactEmail: emailValue,
                                    outreachSubject: subjectValue,
                                    outreachDraft: bodyValue,
                                  })
                                }
                              >
                                Save draft fields
                              </button>
                              {mailto ? (
                                <a className={styles.goldBtn} href={mailto}>
                                  Open email draft
                                </a>
                              ) : (
                                <span className={styles.muted}>
                                  Save a verified email to open a draft.
                                </span>
                              )}
                              <button
                                type="button"
                                className={styles.goldBtn}
                                disabled={
                                  pending ||
                                  !emailValue ||
                                  !outreachWorker.senderEmail ||
                                  !subjectValue.trim() ||
                                  !bodyValue.trim() ||
                                  item.needsPermission
                                }
                                onClick={() =>
                                  approveQueue(item, {
                                    contactEmail: emailValue,
                                    subject: subjectValue,
                                    body: bodyValue,
                                  })
                                }
                              >
                                Approve &amp; queue
                              </button>
                              <label className={styles.muted} htmlFor={`follow-${item.id}`}>
                                Optional follow-up date
                              </label>
                              <input
                                id={`follow-${item.id}`}
                                type="date"
                                value={followUpValue}
                                onChange={(event) =>
                                  setFollowUpDrafts((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                disabled={pending || !emailValue}
                                onClick={() =>
                                  runOutreach(item.id, "mark_sent", {
                                    contactEmail: emailValue,
                                    followUpOn: followUpValue,
                                  })
                                }
                              >
                                Mark as sent (manual)
                              </button>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => runOutreach(item.id, "close")}
                              >
                                Close lead
                              </button>
                            </div>
                            <span className={styles.muted}>
                              Opening a draft leaves this lead in Waiting for approval. Changing
                              sender, recipient, subject, or body after Approve &amp; queue requires
                              a fresh approval. Compliance footer (identity, postal address, opt-out)
                              is appended at queue time.
                            </span>
                          </div>
                        ) : null}

                        {stage === "queued" || stage === "sending" ? (
                          <div className={styles.pipelineActions}>
                            <span className={styles.muted}>
                              {stage === "queued"
                                ? "Queued for Outreach — one active claim per message."
                                : "Sending under lease — provider acceptance required before Sent."}
                            </span>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => runOutreach(item.id, "close")}
                            >
                              Close lead
                            </button>
                          </div>
                        ) : null}

                        {stage === "sent" || stage === "delivered" ? (
                          <div className={styles.pipelineFields}>
                            <div className={styles.pipelineActions}>
                              <button
                                type="button"
                                className={styles.goldBtn}
                                disabled={pending}
                                onClick={() => runOutreach(item.id, "mark_replied")}
                              >
                                Mark as replied
                              </button>
                              <button
                                type="button"
                                disabled={pending || !emailValue}
                                onClick={() => savePermission(item, emailValue)}
                              >
                                Save follow-up permission
                              </button>
                              <button
                                type="button"
                                className={styles.goldBtn}
                                disabled={
                                  pending ||
                                  !emailValue ||
                                  !outreachWorker.senderEmail ||
                                  !subjectValue.trim() ||
                                  !bodyValue.trim() ||
                                  item.needsPermission
                                }
                                onClick={() =>
                                  approveQueue(item, {
                                    contactEmail: emailValue,
                                    subject: subjectValue,
                                    body: bodyValue,
                                    isFollowUp: "1",
                                  })
                                }
                              >
                                Approve follow-up &amp; queue
                              </button>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => runOutreach(item.id, "close")}
                              >
                                Close lead
                              </button>
                            </div>
                            <label className={styles.muted} htmlFor={`fu-subject-${item.id}`}>
                              Follow-up subject
                            </label>
                            <input
                              id={`fu-subject-${item.id}`}
                              value={subjectValue}
                              onChange={(event) =>
                                setSubjectDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              maxLength={300}
                            />
                            <label className={styles.muted} htmlFor={`fu-body-${item.id}`}>
                              Follow-up message
                            </label>
                            <textarea
                              id={`fu-body-${item.id}`}
                              value={bodyValue}
                              onChange={(event) =>
                                setBodyDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              rows={4}
                              maxLength={4000}
                            />
                          </div>
                        ) : null}

                        {stage === "replied" ? (
                          <div className={styles.pipelineActions}>
                            <button
                              type="button"
                              className={styles.goldBtn}
                              disabled={pending}
                              onClick={() => runOutreach(item.id, "mark_won")}
                            >
                              Mark as won
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => runOutreach(item.id, "close")}
                            >
                              Close lead
                            </button>
                          </div>
                        ) : null}

                        <form action={convertOpportunityToProposalTask} className={styles.list}>
                          <input type="hidden" name="opportunityId" value={item.id} />
                          <label className={styles.muted} htmlFor={`opp-project-${item.id}`}>
                            Convert to proposal task
                          </label>
                          <select
                            id={`opp-project-${item.id}`}
                            name="projectId"
                            required
                            defaultValue={companyProjects[0]?.id ?? ""}
                            disabled={!companyProjects.length}
                          >
                            {companyProjects.length === 0 ? (
                              <option value="">No projects for this company</option>
                            ) : (
                              companyProjects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name}
                                </option>
                              ))
                            )}
                          </select>
                          <button
                            type="submit"
                            className={styles.goldBtn}
                            disabled={!companyProjects.length}
                          >
                            Create research task
                          </button>
                        </form>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <form action={createOpportunity} className={styles.list} style={{ marginTop: 12 }}>
        <strong>Add opportunity (manual)</strong>
        <select name="companyId" required defaultValue={defaultCompanyId}>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <input name="title" required placeholder="Title" maxLength={200} />
        <input name="geography" placeholder="Geography / market" maxLength={120} />
        <input name="market" placeholder="Market (optional)" maxLength={120} />
        <input name="industry" placeholder="Industry" maxLength={120} />
        <select name="serviceInterest" defaultValue="">
          <option value="">Service (optional)</option>
          {OUTREACH_SERVICES.map((service) => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </select>
        <input name="valueDollars" type="number" step="1" placeholder="Value USD" />
        <input name="score" type="number" min={0} max={100} placeholder="Fit score" />
        <input
          name="fitReason"
          placeholder="Why they might need our service"
          maxLength={2000}
        />
        <button type="submit">Save opportunity</button>
      </form>
      <p className={styles.muted} style={{ marginTop: 10 }}>
        Sales Map stays separate for synced customer orders by geography.{" "}
        <Link href="/companies">Companies</Link>
      </p>
    </div>
  );
}
