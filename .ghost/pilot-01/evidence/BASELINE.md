# Pilot 01 — baseline inventory (preparation session)

## Cloud / current branch baseline

| Location | Head | Contents relevant to Pilot 01 |
|----------|------|-------------------------------|
| `ghost` checkout `ghost-operations-09` | `243bf65` | Approvals through Build 09.5 only — **no** remote-development, agent-runtime, or 09.9E/F migrations |
| Worktree prep branch `cursor/pilot-01-supervised-coding-prep` | based on `5029993` (09.9C) | Builds 09.6–09.13 durable/remote/agent-runtime + local 09.9E match migration + Pilot 01 additions |

## Available on this prep branch

- Founder Approval Center + immutable scope
- Agent-task approval binding + queue/checkpoints
- Remote development durable workflow + review
- Isolated Docker pilot executor (disabled by default)
- 09.9E authorization field-match migration
- Pilot 01 revoked/expired INSERT gate migration (local-only, not hosted-applied)
- Pilot 01 harness + disposable sample landing page

## Not claimed in this session

- Ghost live autonomous worker execution
- Disposable DB apply of Pilot 01 migration (Windows/founder step)
- Real Docker pilot container verification for Pilot 01 sample (optional Windows step)
