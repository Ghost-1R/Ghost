# Code-generation architecture (foundation)

## Shortest safe path

1. **Founder objective** recorded with data classification (`PUBLIC` | `INTERNAL` | `CONFIDENTIAL` | `RESTRICTED`)
2. **Founder Approval Center** authorization (`agent_task.develop`, exact scope/fingerprint, ONE_TIME or BOUNDED)
3. **Provider selection** via `resolveCodingProvider` — privacy rank must satisfy classification; **no weaker auto-fallback**
4. **Generation** through `CodingProvider.generate` → validated `FileChangeProposal[]`
5. **Isolated workspace** via existing `createCodeWorkspaceContract` + `materializeProposals`
6. **Tests** in workspace / optional restricted Docker (`network=none`, non-root)
7. **Evidence + checkpoints** persisted for review
8. **Founder review** required — never auto-accepted

## Reused infrastructure

| Layer | Existing | New |
| --- | --- | --- |
| Approvals / execution gate | `assertExecutionAuthorized` | used by supervised workflow |
| Durable remote-dev / agent tasks | Pilot 02 path | not replaced |
| Workspace isolation | `agent-runtime/workspace` | materialize adapter |
| Docker safeguards | pilot executor patterns | optional mock pilot Docker |
| Chat model router | `src/lib/ai/provider.ts` | **not** used for coding live calls |
| Coding adapter | — | `src/lib/codegen/*` |

## Security rules

- API keys: server-side env / Render secrets only; never in Git, bundles, evidence, or logs
- Classify before routing; fail closed on privacy mismatch
- Provider-specific key names + usage fields; live coding invocation **disabled**
- Mock labeled `MOCK_GENERATION` — not real AI coding
- No commit/push/deploy/credentials via generated instructions
- Bounded budgets: tokens, cost (0 for mock), duration, steps, retries, output bytes

## Live AI coding trial (not authorized yet)

Requires a **new** founder authorization that explicitly allows a named live coding provider, spend budget, and `GHOST_CODEGEN_LIVE_ENABLED` under founder control. This foundation refuses live invocation even if chat-model keys exist.
