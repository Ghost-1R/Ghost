import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { formatTimestamp } from "@/lib/format";
import { loadProductArchitecture } from "@/lib/product-architect/queries";
import { loadProjectDetail } from "@/lib/projects/queries";
import {
  createSystemComponentAction,
  createSystemConstraintAction,
  createSystemDataFlowAction,
  createSystemEntityAction,
  createSystemEnvConfigAction,
  createSystemFieldAction,
  createSystemIntegrationAction,
  createSystemInterfaceAction,
  createSystemQuestionAction,
  createSystemRelationshipAction,
  createSystemRiskAction,
  escalateSystemQuestionToDecisionAction,
  initializeSystemArchitectureAction,
  resolveSystemQuestionAction,
  saveRequirementCoverageAction,
  saveSystemOverviewAction,
  syncSystemNextActionAction,
  transitionSystemArchitectureAction,
  updateSystemComponentAction,
  updateSystemConstraintAction,
  updateSystemDataFlowAction,
  updateSystemEntityAction,
  updateSystemEnvConfigAction,
  updateSystemFieldAction,
  updateSystemIntegrationAction,
  updateSystemInterfaceAction,
  updateSystemRelationshipAction,
  updateSystemRiskAction,
} from "@/lib/system-architecture/actions";
import {
  loadSystemArchitecture,
  loadSystemArchitectureBundle,
  loadSystemArchitectureHistory,
} from "@/lib/system-architecture/queries";
import {
  CONFIG_CLASSIFICATIONS,
  COVERAGE_STATUSES,
  RELATIONSHIP_CARDINALITIES,
  SENSITIVE_CLASSES,
  SYSTEM_COMPONENT_TYPES,
  SYSTEM_RECORD_STATUSES,
  TECH_RISK_SEVERITIES,
} from "@/lib/system-architecture/types";
import { buildCoverageMatrix, evaluateSystemBundle, summarizeCoverage } from "@/lib/system-architecture/workflow";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `System Architecture ${id.slice(0, 8)}` };
}

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

export default async function SystemArchitecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!UUID_PATTERN.test(projectId)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>System Architecture</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }
  if (!project.data) notFound();

  const architecture = await loadSystemArchitecture(session.supabase, projectId);
  if (architecture.status === "error") {
    return (
      <div className="stack">
        <h1>System Architecture</h1>
        <ErrorState message={architecture.message} />
      </div>
    );
  }

  if (!architecture.data) {
    const [conversation, product] = await Promise.all([
      loadLatestConversation(session.supabase, projectId),
      loadProductArchitecture(session.supabase, projectId),
    ]);
    const productStatus = product.status === "ok" ? product.data?.status ?? null : null;
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">System Architecture</p>
            <h1>{project.data.name}</h1>
          </div>
          <Link className="button-secondary" href={`/projects/${projectId}`}>
            Back to project
          </Link>
        </div>
        <Panel title="Initialize System Architecture">
          <p className="quiet">
            Turns a BUILD_READY Product Architecture into a technical blueprint: components, database, interfaces,
            integrations, and requirement coverage. This is design only. It does not implement, migrate, or deploy
            anything, and Ghost will not invent components for you.
          </p>
          {product.status === "error" ? <ErrorState message={product.message} /> : null}
          <p className="quiet">
            Product Architecture: {productStatus ?? "not initialized"}
            {productStatus && productStatus !== "BUILD_READY" ? " (must be BUILD_READY first)" : ""}
          </p>
          <ActionForm action={initializeSystemArchitectureAction} submitLabel="Initialize System Architecture">
            <input type="hidden" name="projectId" value={projectId} />
          </ActionForm>
        </Panel>
        <Panel title="Ask Ghost about this system">
          <p className="quiet">
            System Architecture is not initialized yet. Answers must say what is unknown until design records exist.
          </p>
          {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
          <GhostConversation
            projectId={projectId}
            projectName={project.data.name}
            conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
            messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
            providerConfigured={isModelConfigured()}
          />
        </Panel>
      </div>
    );
  }

  const arch = architecture.data;
  const [bundleResult, history, conversation] = await Promise.all([
    loadSystemArchitectureBundle(session.supabase, arch),
    loadSystemArchitectureHistory(session.supabase, arch.id),
    loadLatestConversation(session.supabase, projectId),
  ]);

  if (bundleResult.status === "error") {
    return (
      <div className="stack">
        <h1>System Architecture</h1>
        <ErrorState message={bundleResult.message} />
      </div>
    );
  }

  const bundle = bundleResult.data;
  const { components, entities, fields, relationships, interfaces, dataFlows, integrations, envConfigs, risks, constraints, questions } =
    bundle;
  const historyRows = history.status === "ok" ? history.data : [];
  const { readiness, defects, blockers } = evaluateSystemBundle(bundle);
  const matrix = buildCoverageMatrix({
    requirements: bundle.requirements,
    coverage: bundle.coverage,
    components,
    interfaces,
  });
  const coverageSummary = summarizeCoverage(matrix);
  const openQuestions = questions.filter((row) => row.status === "OPEN" || row.status === "ESCALATED");
  const entityName = (entityId: string | null) => {
    const entity = entities.find((row) => row.id === entityId);
    return entity ? `${entity.humanId} ${entity.name}` : "missing";
  };
  const liveEntities = entities.filter((row) => row.status === "PROPOSED" || row.status === "APPROVED");
  const proposedCount = [components, entities, relationships, interfaces, dataFlows, integrations, envConfigs, risks].reduce(
    (sum, rows) => sum + rows.filter((row) => row.status === "PROPOSED").length,
    0,
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">System Architecture</p>
          <h1>{project.data.name}</h1>
        </div>
        <ul className="meta">
          <li>
            <StatusBadge status={arch.status} />
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}`}>
              Project
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/architect`}>
              Product Architect
            </Link>
          </li>
        </ul>
      </div>

      <Panel title="Overview">
        <p>
          Status <strong>{arch.status}</strong> · Product Architecture {bundle.productStatus ?? "missing"}
        </p>
        <ul className="meta">
          <li>Components: {components.length}</li>
          <li>Entities: {entities.length} / fields {fields.length} / relationships {relationships.length}</li>
          <li>Interfaces: {interfaces.length}</li>
          <li>Data flows: {dataFlows.length}</li>
          <li>Integrations: {integrations.length}</li>
          <li>Env variables (names): {envConfigs.length}</li>
          <li>Risks: {risks.length}</li>
          <li>Proposed, awaiting approval: {proposedCount}</li>
          <li>Open questions: {openQuestions.length}</li>
          <li>Open decisions: {bundle.openDecisionCount}</li>
        </ul>
        <p className="quiet">
          System Architecture is design only. It is not implementation, a deployed database, a live API, or a deployed
          product. Ghost does not invent completion percentages.
        </p>
      </Panel>

      <Panel title="Readiness">
        {readiness.architectureReady && defects.length === 0 ? (
          <>
            <p>
              <strong>ARCHITECTURE READY</strong> (designed, not built)
            </p>
            <ul className="meta">
              {readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              <strong>NOT ARCHITECTURE READY</strong> · {blockers.length} item{blockers.length === 1 ? "" : "s"} remaining
            </p>
            <ul className="meta">
              {blockers.map((gap) => (
                <li key={gap.code}>{gap.message}</li>
              ))}
            </ul>
          </>
        )}
        <ActionForm action={syncSystemNextActionAction} submitLabel="Record justified next action">
          <input type="hidden" name="projectId" value={projectId} />
        </ActionForm>
        <div className="meta">
          {(["DESIGNING", "REVIEW", "APPROVED", "ARCHITECTURE_READY"] as const).map((status) => (
            <ActionForm key={status} action={transitionSystemArchitectureAction} submitLabel={`Move to ${status}`}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="reason" value={`Founder moved System Architecture to ${status}.`} />
            </ActionForm>
          ))}
        </div>
      </Panel>

      <Panel title="Ask Ghost about this system">
        <p className="quiet">
          Answers must use System Architecture records. Proposals are not approvals, and design is not deployment.
        </p>
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={projectId}
          projectName={project.data.name}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
        />
      </Panel>

      <Panel title="Summary, authentication, authorization, topology">
        <ActionForm action={saveSystemOverviewAction} submitLabel="Save overview">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>System summary</span>
            <textarea name="summary" defaultValue={arch.summary} maxLength={8000} />
          </label>
          <label className="field">
            <span>Authentication</span>
            <textarea name="authSummary" defaultValue={arch.authSummary} maxLength={4000} />
          </label>
          <label className="field">
            <span>Authorization</span>
            <textarea name="authorizationSummary" defaultValue={arch.authorizationSummary} maxLength={4000} />
          </label>
          <label className="field">
            <span>Runtime topology (one line per node or hop)</span>
            <textarea name="runtimeTopology" defaultValue={arch.runtimeTopology.join("\n")} />
          </label>
          <label className="field">
            <span>Note</span>
            <textarea name="note" defaultValue={arch.note} maxLength={4000} />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Components">
        {components.length === 0 ? <EmptyState>No components designed yet.</EmptyState> : null}
        {components.map((component) => (
          <article className="list-item" key={component.id}>
            <h3>
              {component.humanId}: {component.name}
            </h3>
            <p className="quiet">
              {component.status} · {component.componentType} · {component.provenance} · linked requirements{" "}
              {component.requirementIds.length}
            </p>
            <p>{component.purpose}</p>
            {component.responsibilities.length ? (
              <ul className="meta">
                {component.responsibilities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            <ActionForm action={updateSystemComponentAction} submitLabel="Save component">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="componentId" value={component.id} />
              <input type="hidden" name="requirementsPresent" value="1" />
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={component.name} required />
              </label>
              <label className="field">
                <span>Purpose</span>
                <textarea name="purpose" defaultValue={component.purpose} />
              </label>
              <label className="field">
                <span>Type</span>
                <select name="componentType" defaultValue={component.componentType}>
                  {options(SYSTEM_COMPONENT_TYPES)}
                </select>
              </label>
              <label className="field">
                <span>Responsibilities (one per line)</span>
                <textarea name="responsibilities" defaultValue={component.responsibilities.join("\n")} />
              </label>
              <label className="field">
                <span>Depends on (one per line)</span>
                <textarea name="dependencyRefs" defaultValue={component.dependencyRefs.join("\n")} />
              </label>
              <fieldset className="field">
                <legend>Supports accepted requirements</legend>
                {bundle.requirements
                  .filter((requirement) => requirement.approvalStatus === "ACCEPTED")
                  .map((requirement) => (
                    <label key={requirement.id}>
                      <input
                        type="checkbox"
                        name="requirementIds"
                        value={requirement.id}
                        defaultChecked={component.requirementIds.includes(requirement.id)}
                      />{" "}
                      {requirement.humanId}
                    </label>
                  ))}
              </fieldset>
              <label className="field">
                <span>Approval</span>
                <select name="status" defaultValue={component.status}>
                  {options(SYSTEM_RECORD_STATUSES)}
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemComponentAction} submitLabel="Propose component">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={200} />
          </label>
          <label className="field">
            <span>Purpose</span>
            <textarea name="purpose" />
          </label>
          <label className="field">
            <span>Type</span>
            <select name="componentType" defaultValue="OTHER">
              {options(SYSTEM_COMPONENT_TYPES)}
            </select>
          </label>
          <label className="field">
            <span>Responsibilities (one per line)</span>
            <textarea name="responsibilities" />
          </label>
          <label className="field">
            <span>Depends on (one per line)</span>
            <textarea name="dependencyRefs" />
          </label>
          <fieldset className="field">
            <legend>Supports accepted requirements</legend>
            {bundle.requirements
              .filter((requirement) => requirement.approvalStatus === "ACCEPTED")
              .map((requirement) => (
                <label key={requirement.id}>
                  <input type="checkbox" name="requirementIds" value={requirement.id} /> {requirement.humanId}
                </label>
              ))}
          </fieldset>
        </ActionForm>
      </Panel>

      <Panel title="Database (designed, not deployed)">
        {defects.length ? (
          <>
            <p>
              <strong>{defects.length} schema defect{defects.length === 1 ? "" : "s"}</strong>
            </p>
            <ul className="meta">
              {defects.map((defect) => (
                <li key={defect.code}>{defect.message}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="quiet">No schema defects detected. Designed tables are not migrated tables.</p>
        )}
        {entities.length === 0 ? <EmptyState>No entities designed yet.</EmptyState> : null}
        {entities.map((entity) => {
          const entityFields = fields.filter((field) => field.entityId === entity.id);
          return (
            <article className="list-item" key={entity.id}>
              <h3>
                {entity.humanId}: {entity.name}
              </h3>
              <p className="quiet">
                {entity.status} · sensitive {entity.sensitiveClass} · ownership {entity.ownershipField || "none"} ·{" "}
                {entity.provenance}
              </p>
              <p>{entity.purpose}</p>
              <p className="quiet">RLS expectation (planned): {entity.rlsExpectation || "none recorded"}</p>
              {entityFields.length ? (
                <ul className="meta">
                  {entityFields.map((field) => (
                    <li key={field.id}>
                      {field.name}: {field.dataType}
                      {field.isPk ? " · PK" : ""}
                      {field.isUnique ? " · unique" : ""}
                      {field.isFk ? ` · FK → ${entityName(field.referencesEntityId)}` : ""}
                      {field.nullable ? "" : " · not null"}
                      {field.sensitiveClass !== "NONE" ? ` · ${field.sensitiveClass}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quiet">No fields yet.</p>
              )}
              <ActionForm action={updateSystemEntityAction} submitLabel="Save entity">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={entity.id} />
                <label className="field">
                  <span>Name</span>
                  <input name="name" defaultValue={entity.name} required />
                </label>
                <label className="field">
                  <span>Purpose</span>
                  <textarea name="purpose" defaultValue={entity.purpose} />
                </label>
                <label className="field">
                  <span>Ownership field</span>
                  <input name="ownershipField" defaultValue={entity.ownershipField} />
                </label>
                <label className="field">
                  <span>RLS expectation</span>
                  <textarea name="rlsExpectation" defaultValue={entity.rlsExpectation} />
                </label>
                <label className="field">
                  <span>Retention note</span>
                  <textarea name="retentionNote" defaultValue={entity.retentionNote} />
                </label>
                <label className="field">
                  <span>Sensitive class</span>
                  <select name="sensitiveClass" defaultValue={entity.sensitiveClass}>
                    {options(SENSITIVE_CLASSES)}
                  </select>
                </label>
                <label className="field">
                  <span>Approval</span>
                  <select name="status" defaultValue={entity.status}>
                    {options(SYSTEM_RECORD_STATUSES)}
                  </select>
                </label>
              </ActionForm>
              {entityFields.map((field) => (
                <ActionForm key={field.id} action={updateSystemFieldAction} submitLabel={`Save field ${field.name}`}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="fieldId" value={field.id} />
                  <label className="field">
                    <span>Field name</span>
                    <input name="name" defaultValue={field.name} required />
                  </label>
                  <label className="field">
                    <span>Data type</span>
                    <input name="dataType" defaultValue={field.dataType} />
                  </label>
                  <label>
                    <input type="checkbox" name="nullable" defaultChecked={field.nullable} /> Nullable
                  </label>
                  <label>
                    <input type="checkbox" name="isPk" defaultChecked={field.isPk} /> Primary key
                  </label>
                  <label>
                    <input type="checkbox" name="isUnique" defaultChecked={field.isUnique} /> Unique
                  </label>
                  <label>
                    <input type="checkbox" name="isFk" defaultChecked={field.isFk} /> Foreign key
                  </label>
                  <label className="field">
                    <span>References entity</span>
                    <select name="referencesEntityId" defaultValue={field.referencesEntityId ?? ""}>
                      <option value="">None</option>
                      {liveEntities.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.humanId} {target.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Default (never a secret)</span>
                    <input name="defaultValue" defaultValue={field.defaultValue} />
                  </label>
                  <label className="field">
                    <span>Sensitive class</span>
                    <select name="sensitiveClass" defaultValue={field.sensitiveClass}>
                      {options(SENSITIVE_CLASSES)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Note</span>
                    <input name="note" defaultValue={field.note} />
                  </label>
                </ActionForm>
              ))}
              <ActionForm action={createSystemFieldAction} submitLabel="Add field">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={entity.id} />
                <label className="field">
                  <span>Field name</span>
                  <input name="name" required maxLength={120} />
                </label>
                <label className="field">
                  <span>Data type</span>
                  <input name="dataType" defaultValue="text" />
                </label>
                <label>
                  <input type="checkbox" name="nullable" defaultChecked /> Nullable
                </label>
                <label>
                  <input type="checkbox" name="isPk" /> Primary key
                </label>
                <label>
                  <input type="checkbox" name="isUnique" /> Unique
                </label>
                <label>
                  <input type="checkbox" name="isFk" /> Foreign key
                </label>
                <label className="field">
                  <span>References entity</span>
                  <select name="referencesEntityId" defaultValue="">
                    <option value="">None</option>
                    {liveEntities.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.humanId} {target.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Default (never a secret)</span>
                  <input name="defaultValue" />
                </label>
                <label className="field">
                  <span>Sensitive class</span>
                  <select name="sensitiveClass" defaultValue="NONE">
                    {options(SENSITIVE_CLASSES)}
                  </select>
                </label>
              </ActionForm>
            </article>
          );
        })}
        <ActionForm action={createSystemEntityAction} submitLabel="Propose entity">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={120} />
          </label>
          <label className="field">
            <span>Purpose</span>
            <textarea name="purpose" />
          </label>
          <label className="field">
            <span>Ownership field (for owner-scoped rows)</span>
            <input name="ownershipField" placeholder="owner_id" />
          </label>
          <label className="field">
            <span>RLS expectation</span>
            <textarea name="rlsExpectation" />
          </label>
          <label className="field">
            <span>Retention note</span>
            <textarea name="retentionNote" />
          </label>
          <label className="field">
            <span>Sensitive class</span>
            <select name="sensitiveClass" defaultValue="NONE">
              {options(SENSITIVE_CLASSES)}
            </select>
          </label>
        </ActionForm>

        <h3>Relationships</h3>
        {relationships.length === 0 ? <EmptyState>No relationships designed yet.</EmptyState> : null}
        {relationships.map((relationship) => (
          <article className="list-item" key={relationship.id}>
            <h3>
              {relationship.humanId}: {entityName(relationship.sourceEntityId)} → {entityName(relationship.targetEntityId)}
            </h3>
            <p className="quiet">
              {relationship.status} · {relationship.cardinality}
              {relationship.junctionStrategy ? ` · junction ${relationship.junctionStrategy}` : ""}
            </p>
            <p>{relationship.rationale}</p>
            <ActionForm action={updateSystemRelationshipAction} submitLabel="Save relationship">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="relationshipId" value={relationship.id} />
              <label className="field">
                <span>Cardinality</span>
                <select name="cardinality" defaultValue={relationship.cardinality}>
                  {options(RELATIONSHIP_CARDINALITIES)}
                </select>
              </label>
              <label className="field">
                <span>FK strategy</span>
                <input name="fkStrategy" defaultValue={relationship.fkStrategy} />
              </label>
              <label className="field">
                <span>Delete behavior</span>
                <input name="deleteBehavior" defaultValue={relationship.deleteBehavior} />
              </label>
              <label className="field">
                <span>Junction strategy (required for many-to-many)</span>
                <input name="junctionStrategy" defaultValue={relationship.junctionStrategy} />
              </label>
              <label className="field">
                <span>Rationale</span>
                <textarea name="rationale" defaultValue={relationship.rationale} />
              </label>
              <label className="field">
                <span>Approval</span>
                <select name="status" defaultValue={relationship.status}>
                  {options(SYSTEM_RECORD_STATUSES)}
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemRelationshipAction} submitLabel="Propose relationship">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Source entity</span>
            <select name="sourceEntityId" defaultValue="" required>
              <option value="" disabled>
                Choose entity
              </option>
              {liveEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.humanId} {entity.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Target entity</span>
            <select name="targetEntityId" defaultValue="" required>
              <option value="" disabled>
                Choose entity
              </option>
              {liveEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.humanId} {entity.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Cardinality</span>
            <select name="cardinality" defaultValue="ONE_TO_MANY">
              {options(RELATIONSHIP_CARDINALITIES)}
            </select>
          </label>
          <label className="field">
            <span>FK strategy</span>
            <input name="fkStrategy" />
          </label>
          <label className="field">
            <span>Delete behavior</span>
            <input name="deleteBehavior" placeholder="cascade, restrict, set null" />
          </label>
          <label className="field">
            <span>Junction strategy (required for many-to-many)</span>
            <input name="junctionStrategy" />
          </label>
          <label className="field">
            <span>Rationale</span>
            <textarea name="rationale" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Interfaces (designed, not live)">
        {interfaces.length === 0 ? <EmptyState>No interfaces designed yet.</EmptyState> : null}
        {interfaces.map((iface) => (
          <article className="list-item" key={iface.id}>
            <h3>
              {iface.humanId}: {iface.name}
            </h3>
            <p className="quiet">
              {iface.status} · {iface.caller || "unknown"} → {iface.receiver || "unknown"} · auth{" "}
              {iface.authRequired ? "required" : "not required"} · linked requirements {iface.requirementIds.length}
            </p>
            <p>{iface.operation}</p>
            <p className="quiet">Failure behavior: {iface.failureBehavior || "unknown"}</p>
            <ActionForm action={updateSystemInterfaceAction} submitLabel="Save interface">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="interfaceId" value={iface.id} />
              <input type="hidden" name="requirementsPresent" value="1" />
              <input type="hidden" name="authRequiredPresent" value="1" />
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={iface.name} required />
              </label>
              <label className="field">
                <span>Purpose</span>
                <textarea name="purpose" defaultValue={iface.purpose} />
              </label>
              <label className="field">
                <span>Caller</span>
                <input name="caller" defaultValue={iface.caller} />
              </label>
              <label className="field">
                <span>Receiver</span>
                <input name="receiver" defaultValue={iface.receiver} />
              </label>
              <label className="field">
                <span>Operation</span>
                <input name="operation" defaultValue={iface.operation} />
              </label>
              <label className="field">
                <span>Input shape (JSON or description)</span>
                <textarea name="inputShape" defaultValue={Object.keys(iface.inputShape).length ? JSON.stringify(iface.inputShape) : ""} />
              </label>
              <label className="field">
                <span>Output shape (JSON or description)</span>
                <textarea name="outputShape" defaultValue={Object.keys(iface.outputShape).length ? JSON.stringify(iface.outputShape) : ""} />
              </label>
              <label>
                <input type="checkbox" name="authRequired" defaultChecked={iface.authRequired} /> Authentication required
              </label>
              <label className="field">
                <span>Failure behavior</span>
                <textarea name="failureBehavior" defaultValue={iface.failureBehavior} />
              </label>
              <fieldset className="field">
                <legend>Supports accepted requirements</legend>
                {bundle.requirements
                  .filter((requirement) => requirement.approvalStatus === "ACCEPTED")
                  .map((requirement) => (
                    <label key={requirement.id}>
                      <input
                        type="checkbox"
                        name="requirementIds"
                        value={requirement.id}
                        defaultChecked={iface.requirementIds.includes(requirement.id)}
                      />{" "}
                      {requirement.humanId}
                    </label>
                  ))}
              </fieldset>
              <label className="field">
                <span>Approval</span>
                <select name="status" defaultValue={iface.status}>
                  {options(SYSTEM_RECORD_STATUSES)}
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemInterfaceAction} submitLabel="Propose interface">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="authRequiredPresent" value="1" />
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={200} />
          </label>
          <label className="field">
            <span>Purpose</span>
            <textarea name="purpose" />
          </label>
          <label className="field">
            <span>Caller</span>
            <input name="caller" />
          </label>
          <label className="field">
            <span>Receiver</span>
            <input name="receiver" />
          </label>
          <label className="field">
            <span>Operation</span>
            <input name="operation" placeholder="POST /receipts" />
          </label>
          <label className="field">
            <span>Input shape (JSON or description)</span>
            <textarea name="inputShape" />
          </label>
          <label className="field">
            <span>Output shape (JSON or description)</span>
            <textarea name="outputShape" />
          </label>
          <label>
            <input type="checkbox" name="authRequired" defaultChecked /> Authentication required
          </label>
          <label className="field">
            <span>Failure behavior</span>
            <textarea name="failureBehavior" />
          </label>
          <fieldset className="field">
            <legend>Supports accepted requirements</legend>
            {bundle.requirements
              .filter((requirement) => requirement.approvalStatus === "ACCEPTED")
              .map((requirement) => (
                <label key={requirement.id}>
                  <input type="checkbox" name="requirementIds" value={requirement.id} /> {requirement.humanId}
                </label>
              ))}
          </fieldset>
        </ActionForm>
      </Panel>

      <Panel title="Data flows">
        {dataFlows.length === 0 ? <EmptyState>No data flows designed yet.</EmptyState> : null}
        {dataFlows.map((flow) => (
          <article className="list-item" key={flow.id}>
            <h3>
              {flow.humanId}: {flow.name}
            </h3>
            <p className="quiet">
              {flow.status} · {flow.sourceLabel || "?"} → {flow.processLabel || "?"} → {flow.storageLabel || "?"} →{" "}
              {flow.resultLabel || "?"}
            </p>
            <ol>
              {flow.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <ActionForm action={updateSystemDataFlowAction} submitLabel="Save data flow">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="flowId" value={flow.id} />
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={flow.name} required />
              </label>
              <label className="field">
                <span>Source</span>
                <input name="sourceLabel" defaultValue={flow.sourceLabel} />
              </label>
              <label className="field">
                <span>Process</span>
                <input name="processLabel" defaultValue={flow.processLabel} />
              </label>
              <label className="field">
                <span>Storage</span>
                <input name="storageLabel" defaultValue={flow.storageLabel} />
              </label>
              <label className="field">
                <span>Result</span>
                <input name="resultLabel" defaultValue={flow.resultLabel} />
              </label>
              <label className="field">
                <span>Steps (one per line)</span>
                <textarea name="steps" defaultValue={flow.steps.join("\n")} />
              </label>
              <label className="field">
                <span>Component refs (one per line)</span>
                <textarea name="componentRefs" defaultValue={flow.componentRefs.join("\n")} />
              </label>
              <label className="field">
                <span>Approval</span>
                <select name="status" defaultValue={flow.status}>
                  {options(SYSTEM_RECORD_STATUSES)}
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemDataFlowAction} submitLabel="Propose data flow">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={200} />
          </label>
          <label className="field">
            <span>Source</span>
            <input name="sourceLabel" />
          </label>
          <label className="field">
            <span>Process</span>
            <input name="processLabel" />
          </label>
          <label className="field">
            <span>Storage</span>
            <input name="storageLabel" />
          </label>
          <label className="field">
            <span>Result</span>
            <input name="resultLabel" />
          </label>
          <label className="field">
            <span>Steps (one per line)</span>
            <textarea name="steps" />
          </label>
          <label className="field">
            <span>Component refs (one per line, e.g. COMP-001)</span>
            <textarea name="componentRefs" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Integrations">
        <p className="quiet">Secret NAMES only. Ghost never stores secret values.</p>
        {integrations.length === 0 ? <EmptyState>No integrations designed yet.</EmptyState> : null}
        {integrations.map((integration) => (
          <article className="list-item" key={integration.id}>
            <h3>
              {integration.humanId}: {integration.provider}
            </h3>
            <p className="quiet">
              {integration.status} · {integration.required ? "required" : "optional"} · secret names:{" "}
              {integration.secretNames.join(", ") || "none"}
            </p>
            <p>{integration.purpose}</p>
            <p className="quiet">
              Failure impact: {integration.failureImpact || "unknown"} · Fallback: {integration.fallbackBehavior || "none"}
            </p>
            <ActionForm action={updateSystemIntegrationAction} submitLabel="Save integration">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="integrationId" value={integration.id} />
              <input type="hidden" name="requiredPresent" value="1" />
              <label className="field">
                <span>Provider</span>
                <input name="provider" defaultValue={integration.provider} required />
              </label>
              <label className="field">
                <span>Purpose</span>
                <textarea name="purpose" defaultValue={integration.purpose} />
              </label>
              <label>
                <input type="checkbox" name="required" defaultChecked={integration.required} /> Required
              </label>
              <label className="field">
                <span>Data exchanged (one per line)</span>
                <textarea name="dataExchanged" defaultValue={integration.dataExchanged.join("\n")} />
              </label>
              <label className="field">
                <span>Secret names (one per line, names only)</span>
                <textarea name="secretNames" defaultValue={integration.secretNames.join("\n")} />
              </label>
              <label className="field">
                <span>Failure impact</span>
                <textarea name="failureImpact" defaultValue={integration.failureImpact} />
              </label>
              <label className="field">
                <span>Fallback behavior</span>
                <textarea name="fallbackBehavior" defaultValue={integration.fallbackBehavior} />
              </label>
              <label className="field">
                <span>Cost note</span>
                <input name="costNote" defaultValue={integration.costNote} />
              </label>
              <label className="field">
                <span>Approval</span>
                <select name="status" defaultValue={integration.status}>
                  {options(SYSTEM_RECORD_STATUSES)}
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemIntegrationAction} submitLabel="Propose integration">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Provider</span>
            <input name="provider" required maxLength={200} />
          </label>
          <label className="field">
            <span>Purpose</span>
            <textarea name="purpose" />
          </label>
          <label>
            <input type="checkbox" name="required" defaultChecked /> Required
          </label>
          <label className="field">
            <span>Data exchanged (one per line)</span>
            <textarea name="dataExchanged" />
          </label>
          <label className="field">
            <span>Secret names (one per line, names only)</span>
            <textarea name="secretNames" placeholder="STRIPE_API_KEY" />
          </label>
          <label className="field">
            <span>Failure impact</span>
            <textarea name="failureImpact" />
          </label>
          <label className="field">
            <span>Fallback behavior</span>
            <textarea name="fallbackBehavior" />
          </label>
          <label className="field">
            <span>Cost note</span>
            <input name="costNote" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Environment configuration">
        <p className="quiet">Variable NAMES and classification only. Values live outside Ghost.</p>
        {envConfigs.length === 0 ? <EmptyState>No environment variables designed yet.</EmptyState> : null}
        {envConfigs.map((config) => (
          <article className="list-item" key={config.id}>
            <h3>{config.variableName}</h3>
            <p className="quiet">
              {config.status} · {config.classification} · {config.requiredEnvironments.join(", ")}
            </p>
            <p>{config.purpose}</p>
            <ActionForm action={updateSystemEnvConfigAction} submitLabel="Save variable">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="envConfigId" value={config.id} />
              <label className="field">
                <span>Purpose</span>
                <textarea name="purpose" defaultValue={config.purpose} />
              </label>
              <label className="field">
                <span>Classification</span>
                <select name="classification" defaultValue={config.classification}>
                  {options(CONFIG_CLASSIFICATIONS)}
                </select>
              </label>
              <label className="field">
                <span>Required environments (one per line)</span>
                <textarea name="requiredEnvironments" defaultValue={config.requiredEnvironments.join("\n")} />
              </label>
              <label className="field">
                <span>Approval</span>
                <select name="status" defaultValue={config.status}>
                  {options(SYSTEM_RECORD_STATUSES)}
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemEnvConfigAction} submitLabel="Add variable name">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Variable name (never a value)</span>
            <input name="variableName" required maxLength={128} placeholder="SUPABASE_URL" />
          </label>
          <label className="field">
            <span>Purpose</span>
            <textarea name="purpose" />
          </label>
          <label className="field">
            <span>Classification</span>
            <select name="classification" defaultValue="SERVER_SECRET">
              {options(CONFIG_CLASSIFICATIONS)}
            </select>
          </label>
          <label className="field">
            <span>Required environments (one per line)</span>
            <textarea name="requiredEnvironments" defaultValue="production" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Technical risks">
        {risks.length === 0 ? <EmptyState>No technical risks recorded yet.</EmptyState> : null}
        {risks.map((risk) => (
          <article className="list-item" key={risk.id}>
            <h3>
              {risk.humanId} · {risk.severity}
            </h3>
            <p className="quiet">
              {risk.status} · likelihood {risk.likelihood} · {risk.provenance}
            </p>
            <p>{risk.description}</p>
            <p className="quiet">Mitigation: {risk.mitigation || "none recorded"}</p>
            <ActionForm action={updateSystemRiskAction} submitLabel="Save risk">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="riskId" value={risk.id} />
              <label className="field">
                <span>Description</span>
                <textarea name="description" defaultValue={risk.description} required />
              </label>
              <label className="field">
                <span>Severity</span>
                <select name="severity" defaultValue={risk.severity}>
                  {options(TECH_RISK_SEVERITIES)}
                </select>
              </label>
              <label className="field">
                <span>Likelihood</span>
                <input name="likelihood" defaultValue={risk.likelihood} />
              </label>
              <label className="field">
                <span>Mitigation</span>
                <textarea name="mitigation" defaultValue={risk.mitigation} />
              </label>
              <label className="field">
                <span>Linked components (one per line)</span>
                <textarea name="linkedComponentRefs" defaultValue={risk.linkedComponentRefs.join("\n")} />
              </label>
              <label className="field">
                <span>Approval</span>
                <select name="status" defaultValue={risk.status}>
                  {options(SYSTEM_RECORD_STATUSES)}
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemRiskAction} submitLabel="Propose risk">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Description</span>
            <textarea name="description" required />
          </label>
          <label className="field">
            <span>Severity</span>
            <select name="severity" defaultValue="MEDIUM">
              {options(TECH_RISK_SEVERITIES)}
            </select>
          </label>
          <label className="field">
            <span>Likelihood</span>
            <input name="likelihood" placeholder="UNKNOWN" />
          </label>
          <label className="field">
            <span>Mitigation</span>
            <textarea name="mitigation" />
          </label>
          <label className="field">
            <span>Linked components (one per line)</span>
            <textarea name="linkedComponentRefs" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Technical constraints">
        {constraints.length === 0 ? <EmptyState>No technical constraints recorded yet.</EmptyState> : null}
        {constraints.map((constraint) => (
          <article className="list-item" key={constraint.id}>
            <h3>{constraint.statement}</h3>
            <p className="quiet">
              {constraint.authoritative ? "Authoritative" : "Not authoritative"} · source {constraint.constraintSource} ·{" "}
              {constraint.provenance}
            </p>
            <ActionForm action={updateSystemConstraintAction} submitLabel="Save constraint">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="constraintId" value={constraint.id} />
              <input type="hidden" name="authoritativePresent" value="1" />
              <label className="field">
                <span>Statement</span>
                <textarea name="statement" defaultValue={constraint.statement} required />
              </label>
              <label className="field">
                <span>Source</span>
                <input name="constraintSource" defaultValue={constraint.constraintSource} />
              </label>
              <label>
                <input type="checkbox" name="authoritative" defaultChecked={constraint.authoritative} /> Founder-confirmed
                (authoritative)
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createSystemConstraintAction} submitLabel="Add constraint">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Statement</span>
            <textarea name="statement" required />
          </label>
          <label className="field">
            <span>Source</span>
            <input name="constraintSource" defaultValue="founder" />
          </label>
          <label>
            <input type="checkbox" name="authoritative" /> Founder-confirmed (authoritative)
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Traceability">
        <p className="quiet">
          Accepted product requirements and how the system design covers them. Coverage: {coverageSummary.COVERED} covered ·{" "}
          {coverageSummary.PARTIALLY_COVERED} partial · {coverageSummary.NOT_COVERED} not covered ·{" "}
          {coverageSummary.NOT_APPLICABLE} not applicable. Covered means designed, not built.
        </p>
        {matrix.length === 0 ? <EmptyState>No accepted product requirements to trace.</EmptyState> : null}
        {matrix.map((row) => (
          <article className="list-item" key={row.requirementId}>
            <h3>
              {row.humanId}: {row.title}
            </h3>
            <p className="quiet">
              {row.priority} · {row.coverage} · components {row.componentRefs.join(", ") || "none"} · interfaces{" "}
              {row.interfaceRefs.join(", ") || "none"}
              {row.supportingRefs.length ? ` · refs ${row.supportingRefs.join(", ")}` : ""}
            </p>
            {row.gapNote ? <p>{row.gapNote}</p> : null}
            <ActionForm action={saveRequirementCoverageAction} submitLabel="Save coverage">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="requirementId" value={row.requirementId} />
              <label className="field">
                <span>Coverage</span>
                <select name="coverage" defaultValue={row.coverage}>
                  {options(COVERAGE_STATUSES)}
                </select>
              </label>
              <label className="field">
                <span>Supporting refs (one per line, e.g. COMP-001)</span>
                <textarea name="supportingRefs" defaultValue={row.supportingRefs.join("\n")} />
              </label>
              <label className="field">
                <span>Gap note</span>
                <textarea name="gapNote" defaultValue={row.gapNote} />
              </label>
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Unresolved questions / decisions">
        {openQuestions.length === 0 ? <EmptyState>No open system questions.</EmptyState> : null}
        {openQuestions.map((question) => (
          <article className="list-item" key={question.id}>
            <h3>{question.question}</h3>
            <p className="quiet">{question.status}</p>
            <ActionForm action={resolveSystemQuestionAction} submitLabel="Resolve question">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="questionId" value={question.id} />
              <input type="hidden" name="status" value="RESOLVED" />
              <label className="field">
                <span>Resolution</span>
                <textarea name="resolution" required />
              </label>
            </ActionForm>
            {question.status === "OPEN" ? (
              <ActionForm action={escalateSystemQuestionToDecisionAction} submitLabel="Send to Decision Inbox">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="questionId" value={question.id} />
                <input type="hidden" name="question" value={question.question} />
                <label className="field">
                  <span>Option A</span>
                  <input name="optionA" />
                </label>
                <label className="field">
                  <span>Option B</span>
                  <input name="optionB" />
                </label>
              </ActionForm>
            ) : null}
          </article>
        ))}
        <ActionForm action={createSystemQuestionAction} submitLabel="Add unresolved question">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Question</span>
            <textarea name="question" required />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="History">
        {historyRows.length === 0 ? <EmptyState>No transitions yet.</EmptyState> : null}
        {historyRows.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.fromStatus ?? "none"} → {row.toStatus}
            </h3>
            <p className="quiet">
              {row.reason} · {formatTimestamp(row.changedAt)}
            </p>
          </article>
        ))}
      </Panel>
    </div>
  );
}
