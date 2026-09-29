# Memory Proposal to Founder Approval

## Purpose

Let a conversation suggest memory without making it trusted. The founder approves, rejects, or keeps it on one project.

## Use When

Ghost or the founder wants to remember a rule or a project fact.

## Do Not Use When

The text is an ordinary remark, or someone tries to insert an ACTIVE founder rule directly.

## Preconditions

`memory_proposals` starts PENDING. `review_memory_proposal` is the only path that creates an ACTIVE founder rule.

## Implementation

`src/lib/memory/actions.ts` calls `review_memory_proposal`. The database trigger rejects a direct ACTIVE insert. Conversation remember-commands create proposals in `src/lib/conversation/actions.ts`.

## Verification

A direct ACTIVE insert was denied. The migration-verification proposal was approved through the memory page and became an active rule. A rejected proposal created no rule. Observed in Ghost only.

## Risks

Approving a proposal makes it trusted context. Retirement must be explicit.

## Provenance

Project: GHOST. Repository branch: ghost-alpha. Evidence commit: b00dc39. Relevant files: src/lib/memory/actions.ts and supabase/migrations/20260929015943_alpha_foundation.sql. This has not been shown in a second product.

## Status

DRAFT
