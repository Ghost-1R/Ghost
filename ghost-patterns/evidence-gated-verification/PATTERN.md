# Evidence-Gated Verification

## Purpose

Treat a record as verified only when it has evidence and a check time. A label by itself is not proof.

## Use When

The product records claimed, observed, verified, or not verified work.

## Do Not Use When

The statement is only a conversation claim or a file existing in the repository.

## Preconditions

Verification rows store state, evidence, and checked time. The database rejects verified rows with empty evidence.

## Implementation

`src/lib/brain/verification.ts` accepts VERIFIED only when evidence is present and `checkedAt` is set. The table constraint is in `supabase/migrations/20260929015943_alpha_foundation.sql`.

## Verification

Empty VERIFIED inserts were denied. VERIFIED with evidence and a check time succeeded. Production remains NOT_VERIFIED for Ghost. Observed in Ghost only.

## Risks

Repository files and a passing build can be mistaken for production verification.

## Provenance

Project: GHOST. Repository branch: ghost-alpha. Evidence commit: b00dc39. Relevant file: src/lib/brain/verification.ts. This has not been shown in a second product.

## Status

DRAFT
