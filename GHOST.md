# GHOST PROJECT STATE

## Project

GHOST

## Product

Your Second Mind

## Mission

Turn ideas into real products while learning how the founder builds.

## Current Milestone

Alpha Foundation

## Status

BUILDING

## Stack

- Next.js
- TypeScript
- React
- Supabase
- PostgreSQL
- Tailwind CSS

## Current Requirements

- Project Brain
- Founder Rules
- Project Knowledge
- Portable project state
- Ground-truth verification
- Memory proposals
- Milestones
- Blockers
- Next actions
- Future Inspector
- Future GitHub integration
- Provider-independent deployment

## Decisions

### DEC-001

Project state must exist inside the repository and not only inside Ghost's database.

### DEC-002

Alpha memory uses only Founder Rules and Project Knowledge.

### DEC-003

Permanent Founder Rules require founder approval.

### DEC-004

Project progress uses milestones and real states rather than arbitrary percentages.

### DEC-005

Verification must eventually rely on external evidence rather than AI self-report.

### DEC-006

Ghost will NOT use Vercel for deployment.
Deployment remains provider-independent until another provider is selected.

## Repository

Git root is this directory, on branch `ghost-alpha`.
The parent `Documents` folder is a separate Ivoire Shop checkout and was not modified.
No git remote is configured. `Ghost-1R/Ghost` on GitHub contains an unrelated initial commit, so this history was not pushed.

## Supabase

Linked project: Ghost-1R's Project (`wzwrrleqfylhuxfbukfu`), region us-west-2.
Ivoire Shop's Supabase project was not used.
Migration `20260929015943_alpha_foundation.sql` was inspected and applied with `db push`. `db reset` was not used.
An activation guard was added before apply so a client cannot insert an ACTIVE founder rule. Only `review_memory_proposal` may set that state.

## Current Blockers

- Public sign-up through the Ghost form reached Supabase and returned `email rate limit exceeded`. A new account was not created by that attempt, and a confirmation code was not exchanged at `/auth/callback`.
- Production is not deployed.
- This repository is not connected to GitHub. The existing `Ghost-1R/Ghost` history does not share this root.

## Next Actions

1. After the auth email rate limit clears, create one account through the Ghost sign-up form and complete the confirmation callback if confirmation stays enabled.
2. Add Ghost conversation only against the verified project records. Do not invent progress or verification.

## Verification

Application:
VERIFIED_LOCAL

Database:
VERIFIED_REMOTE

Authentication:
VERIFIED_REMOTE

RLS:
VERIFIED_REMOTE

Memory approval:
VERIFIED_REMOTE

Verification records:
VERIFIED_REMOTE

Production:
NOT_DEPLOYED

Evidence:

- Database: the Alpha tables, forced RLS, policies, and the founder-rule activation guard were observed on the linked project after `db push`.
- Authentication: a browser signed in through `/login`, kept a session across `/dashboard`, `/projects`, `/projects/new`, `/projects/[id]`, `/memory`, and `/settings`, reloaded a project, signed out, and was sent back to `/login` when opening `/dashboard`. The profile trigger had created a profile row for that user. Missing `/auth/callback` codes redirect to `/login?reason=confirm-failed`. A successful confirmation exchange was not observed.
- RLS: a second founder could not read or mutate the first founder's company, project, knowledge, milestones, blockers, next actions, verification records, proposals, or founder rules. The other founder's project URL rendered "Project not found." and did not include the project name.
- Memory approval: a direct ACTIVE founder-rule insert was denied. Approving one's own proposal created an ACTIVE rule. Reviewing another founder's proposal was denied.
- Verification records: inserting VERIFIED without evidence and `checked_at` was denied by the database. A record with both fields succeeded.
- Disposable auth users and their rows were removed after these checks.

After these fixes, `npm run lint`, `npx tsc --noEmit`, and `npm run build` passed on this machine. No automated test suite exists. No production host was contacted.

## Last Updated

2026-09-28
