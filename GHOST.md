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

## Development server

The app used for this check is http://localhost:3001.
Port 3000 is occupied by another process, so Next.js chose 3001.
An earlier dev-server process was stopped on purpose so the app could reload `.env.local`. That stop is not an application crash and is not a blocker.

## Current Blockers

- Public sign-up through the Ghost form on port 3001 reached Supabase and returned `email rate limit exceeded`. No account was created by that attempt, and a confirmation code was not exchanged at `/auth/callback`.
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

Evidence from the running app at http://localhost:3001:

- Connectivity: `/login` returned 200 with the sign-in form and without the unconfigured notice. The page is aimed at `wzwrrleqfylhuxfbukfu.supabase.co`. Unsigned `/dashboard` returned 307 to `/login`.
- Authentication: the sign-up form displayed `email rate limit exceeded` and created no user. Confirmed test users signed in through `/login`, stayed signed in across `/dashboard`, `/projects`, `/projects/[id]`, `/memory`, and `/settings`, remained signed in after a settings reload, signed out to `/login`, and were returned to `/login` when opening `/dashboard`. User A's profile display name was `Recheck A`. `/auth/callback` with no code redirected to `/login?reason=confirm-failed`. A confirmation code was not exchanged.
- RLS: User A created a company, project, requirement, decision, milestone, blocker, next action, and proposal, and could read that project. User B's selects on those resources returned zero rows. User B's update and delete changed zero project rows, and the name stayed `Project A`. User B's inserts into User A's knowledge, blockers, and next actions were denied. User B could insert User B's own company.
- Memory approval: a direct ACTIVE founder-rule insert was denied with `active founder rules must be created by review_memory_proposal`. User A's own approval created an ACTIVE rule. User B's review was denied and the proposal stayed `APPROVED`.
- Verification records: VERIFIED with empty evidence was denied. VERIFIED with evidence and `checked_at` succeeded.
- Signed-in UI: those workspace routes rendered for User A. User B's browser opened User A's project URL and showed "Project not found." without the project name or a mention of another account. At 390px width the menu opened and the dashboard did not scroll horizontally.
- Disposable auth users were deleted. Auth users, profiles, companies, projects, proposals, founder rules, and verification records were then counted at zero. The Supabase CLI query role returned 403 on this pass; those counts came from the service-role API.

`npm run lint`, `npx tsc --noEmit`, and `npm run build` passed on this machine after that check. No automated test suite exists. No production host was contacted.

## Last Updated

2026-09-28
