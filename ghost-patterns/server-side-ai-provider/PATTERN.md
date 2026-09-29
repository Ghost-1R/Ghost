# Server-Side AI Provider Configuration

## Purpose

Call a model from the server with a key that never reaches the browser. The model name comes from server configuration.

## Use When

A feature needs a language model and the key must stay off the page.

## Do Not Use When

The task is deterministic, such as duplicate detection, Git status, or an exact file lookup.

## Preconditions

The provider reads `OPENAI_API_KEY`, `GHOST_MODEL_PROVIDER`, and `GHOST_AI_MODEL` on the server. The key is not a public environment variable.

## Implementation

`src/lib/ai/provider.ts` selects the provider and sends only provider, model, and token counts to logs. Ghost has used OpenAI with model gpt-5.4 on localhost.

## Verification

Live Ghost answers on http://localhost:3001 used gpt-5.4. The key was not present in the page HTML. Observed in Ghost only.

## Risks

Logging request bodies or putting the key in message metadata would expose it.

## Provenance

Project: GHOST. Repository branch: ghost-alpha. Evidence commit: b00dc39. Relevant file: src/lib/ai/provider.ts. This has not been shown in a second product.

## Status

DRAFT
