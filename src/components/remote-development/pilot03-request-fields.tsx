"use client";

import { useMemo, useState } from "react";
import { centsToUsdDisplay } from "@/lib/allowance/types";
import type { VerifiedCodingOption } from "@/lib/codegen/request-contract";

type AllowanceView = {
  projectId: string;
  projectName: string;
  availableCents: number;
  allowanceCents: number;
  reservedCents: number;
  chargedCents: number;
  alert: string;
  provisioned: boolean;
};

export function Pilot03RequestFields({
  codingOptions,
  allowances,
  defaultProjectId,
  pilot03Objective,
}: {
  codingOptions: VerifiedCodingOption[];
  allowances: AllowanceView[];
  defaultProjectId: string;
  pilot03Objective: string;
}) {
  const [requestKind, setRequestKind] = useState<"REMOTE_DEV" | "CODEGEN_PILOT_03">("REMOTE_DEV");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [optionValue, setOptionValue] = useState(codingOptions[0]?.value ?? "mock:mock-codegen-v1");
  const [maxSpend, setMaxSpend] = useState("1");

  const selected = useMemo(
    () => codingOptions.find((o) => o.value === optionValue) ?? codingOptions[0],
    [codingOptions, optionValue],
  );
  const allowance = allowances.find((a) => a.projectId === projectId) ?? allowances[0];
  const estimatedCents = selected?.providerId === "mock" ? 0 : Math.min(100, Math.ceil(Number(maxSpend) * 100) || 100);
  const maxSpendCents = Math.min(100, Math.round(Number(maxSpend) * 100) || 0);
  const hardStop =
    requestKind === "CODEGEN_PILOT_03" &&
    selected?.providerId !== "mock" &&
    (allowance?.availableCents ?? 0) < maxSpendCents;

  return (
    <>
      <label className="field">
        <span>Request kind</span>
        <select
          name="requestKind"
          value={requestKind}
          onChange={(e) => setRequestKind(e.target.value as "REMOTE_DEV" | "CODEGEN_PILOT_03")}
        >
          <option value="REMOTE_DEV">Standard remote development</option>
          <option value="CODEGEN_PILOT_03">Pilot 03 AI code generation (prep — live off)</option>
        </select>
      </label>

      <label className="field">
        <span>Project</span>
        <select
          name="projectId"
          required
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {allowances.map((a) => (
            <option key={a.projectId} value={a.projectId}>
              {a.projectName}
            </option>
          ))}
        </select>
      </label>

      {requestKind === "CODEGEN_PILOT_03" ? (
        <div className="stack" data-pilot03-fields="1">
          <p className="notice" role="status">
            Pilot 03 binds provider/model into the ONE_TIME authorization fingerprint. Live HTTP
            dispatch stays disabled. Deployment is never granted.
          </p>
          <label className="field">
            <span>Provider / model (verified configured only)</span>
            <select
              name="codingProviderModel"
              required
              value={optionValue}
              onChange={(e) => setOptionValue(e.target.value)}
            >
              {codingOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p className="quiet">{selected?.note}</p>
          <label className="field">
            <span>Data classification</span>
            <select name="classification" defaultValue="PUBLIC">
              <option value="PUBLIC">PUBLIC</option>
              <option value="INTERNAL">INTERNAL (mock only recommended)</option>
            </select>
          </label>
          <label className="field">
            <span>Objective</span>
            <textarea
              name="objective"
              required
              minLength={8}
              maxLength={4000}
              rows={3}
              defaultValue={pilot03Objective}
            />
          </label>
          <label className="field">
            <span>Requested spending ceiling (USD, max $1.00 for Pilot 03)</span>
            <input
              name="maxEstimatedCostUsd"
              type="number"
              min={0}
              max={1}
              step="0.01"
              required
              value={maxSpend}
              onChange={(e) => setMaxSpend(e.target.value)}
            />
          </label>
          <ul className="meta">
            <li>
              Available AI allowance:{" "}
              {allowance?.provisioned
                ? centsToUsdDisplay(allowance.availableCents)
                : "not provisioned ($0.00)"}{" "}
              {allowance ? `(alert: ${allowance.alert})` : null}
            </li>
            <li>
              Allowance / reserved / charged:{" "}
              {allowance
                ? `${centsToUsdDisplay(allowance.allowanceCents)} / ${centsToUsdDisplay(allowance.reservedCents)} / ${centsToUsdDisplay(allowance.chargedCents)}`
                : "n/a"}
            </li>
            <li>
              Estimated cost before authorization: {centsToUsdDisplay(estimatedCents)}{" "}
              {selected?.providerId === "mock" ? "(MOCK — $0 actual)" : "(LIVE_RATE_ESTIMATE — not charged)"}
            </li>
            <li>Requested ceiling: {centsToUsdDisplay(maxSpendCents)}</li>
            <li>Live dispatch: disabled (default)</li>
            <li>Deployment authorized: no</li>
          </ul>
          {hardStop ? (
            <p className="alert" role="alert">
              HARD_STOP: available allowance is below the requested ceiling. Do not authorize live
              spend until the project allowance is set (≥ $1.00 for the first trial).
            </p>
          ) : null}
          <input type="hidden" name="liveDispatch" value="0" />
          <input type="hidden" name="environmentLabel" value="LOCAL_PILOT_03" />
        </div>
      ) : (
        <>
          <label className="field">
            <span>Objective</span>
            <textarea
              name="objective"
              required
              minLength={8}
              maxLength={4000}
              rows={3}
              placeholder="Exact development objective"
            />
          </label>
          <label className="field">
            <span>Development environment</span>
            <input name="environmentLabel" required defaultValue="REMOTE_DEV" maxLength={80} />
          </label>
          <label className="field">
            <span>Max spending budget (USD)</span>
            <input
              name="maxEstimatedCostUsd"
              type="number"
              min={0}
              max={500}
              step="0.01"
              required
              defaultValue="5"
            />
          </label>
          {allowance ? (
            <p className="quiet">
              Project AI allowance (informational):{" "}
              {allowance.provisioned
                ? `${centsToUsdDisplay(allowance.availableCents)} available`
                : "not provisioned"}
            </p>
          ) : null}
          <input type="hidden" name="liveDispatch" value="0" />
        </>
      )}
    </>
  );
}
