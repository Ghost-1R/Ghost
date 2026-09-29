# Supabase Owner-Scoped RLS

## Purpose

Keep each founder's rows visible only to that founder. Ghost uses this for projects, knowledge, messages, and founder rules.

## Use When

A Supabase table stores user-owned records and the browser uses the signed-in session.

## Do Not Use When

The table is a private schema helper, or the access rule is not ownership.

## Preconditions

The table has an owner column or a parent the owner controls. RLS is enabled and forced.

## Implementation

Policies compare `auth.uid()` to the owner, directly or through `private.owns_project`. Anonymous access is revoked. See `supabase/migrations/20260929015943_alpha_foundation.sql`.

## Verification

On project `wzwrrleqfylhuxfbukfu`, a second founder received zero rows and writes returned SQLSTATE 42501. This was observed for Ghost only.

## Risks

A policy that trusts `user_metadata` is unsafe. A view without `security_invoker` can bypass RLS.

## Provenance

Project: GHOST. Repository branch: ghost-alpha. Evidence commit: b00dc39. Relevant file: supabase/migrations/20260929015943_alpha_foundation.sql. This has not been shown in a second product.

## Status

DRAFT
