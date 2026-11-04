# GHOST

Your second mind. Ghost is a founder operating system for turning an idea into a product while remembering how the founder builds.

This repository is the Alpha foundation. It is not a finished product, and it is not deployed.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The dev server reads `.env.local`. Protected routes stay closed until those values exist. Ghost does not invent a session.

## Environment

`.env.local` is gitignored. Put only the public Supabase values there:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Do not add a service-role or secret key. A `NEXT_PUBLIC_` name would ship it to the browser.

## Supabase

The linked project for this app is Ghost's own project. Do not link or push to another product's Supabase project.

```bash
npx supabase link
npx supabase db push --linked
```

Inspect a migration before applying it. Do not run `db reset` against a remote project.

The Alpha migration is `supabase/migrations/20260929015943_alpha_foundation.sql`. It creates the founder tables, forces row level security, and blocks ACTIVE founder rules unless proposal review sets them.

## Security model

- A founder can read and change only rows owned through their account.
- Project access follows the company owner. Another founder's project URL renders as not found.
- Memory proposals start PENDING. Approval, rejection, and project-only decisions go through database functions.
- A client cannot insert an ACTIVE founder rule.
- A VERIFIED record requires evidence and `checked_at`. The database rejects anything else.
- Server code uses the signed-in user id. Forms do not choose the owner.

## Project truth

| File | Role |
| --- | --- |
| `GHOST.md` | Current milestone, decisions, blockers, and verification labels |
| `FOUNDER.md` | Founder rules that live in the repository |
| `.ghost/state.json` | Portable machine-readable state |

These files are the project record. The database does not replace them.

Ground truth means a label such as `VERIFIED_REMOTE` is used only after an outside check, not because the code exists. `IMPLEMENTED` is not evidence. Production runs on Render. Being deployed does not make it presentation-ready: only the production Presentation Gate for the deployed commit decides that. Ghost does not use Vercel.

The live server never runs the Inspector. From the trusted runner, set `GHOST_PRODUCTION_URL` and use Inspect production. The runner checks that the live `/api/health` commit matches its own clean commit, then records evidence with environment `production`.

## Ghost conversation

Ask Ghost from the dashboard or from a project page. The server loads that founder's records, checks project access, and only then calls a model.

No model key is required to run the app. Groq (`GROQ_API_KEY`) is the free default. OpenAI or Anthropic run only when `GHOST_MODEL_PROVIDER` names them, and Ghost never falls back to a paid provider on its own. Without a configured provider, Ghost stores the question and says that no provider is configured. It does not invent an answer. Keys stay server-side.

Answers render a safe Markdown subset: paragraphs, bold, italic, lists, inline code, and code blocks. Raw HTML in an answer is shown as text.

Conversation does not create founder rules or project knowledge.

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` covers context assembly, verification interpretation, state drift, and the rule that a hidden project is not sent to a model.
