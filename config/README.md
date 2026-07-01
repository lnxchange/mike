# Deployment configuration layer

This directory documents the configuration/extension-point pattern used across this repo
to keep it a clean, self-hostable, standalone open-source service — while leaving an
obvious, low-risk place to plug in a future mode.law-specific configuration later, without
hardcoding any proprietary branding, prompts, or business logic into this repo today.

## Why this exists

The objective for this fork is:

1. This repo stays the open-source AGPL component, usable standalone.
2. It can run as a separate service from proprietary mode.law systems (see
   `API_BOUNDARY.md`).
3. Future mode.law-specific customization (branding, prompts, feature flags) plugs in
   through config, not through scattered hardcoded strings or `if (isModeLaw)` branches in
   application code.

## Where the actual config lives

There is no root-level build tool tying `frontend/` and `backend/` together (no
turborepo/pnpm workspaces — see `SETUP_AUDIT.md`), and each app deploys independently
(frontend to Vercel, backend elsewhere). Sharing a single imported config module across
both would require path references that reach outside each app's own directory, which
breaks the moment either app is deployed with a scoped "Root Directory" (as Vercel is,
for `frontend/`). So each app has its own **real, imported** config module with the same
shape and the same profile-selection pattern:

- `backend/src/config/` — `types.ts` (the `DeploymentProfile` shape), `profiles/oss.ts`
  (default), `profiles/mode-law.ts` (placeholder, no proprietary content), and `index.ts`
  (resolves the active profile from the `DEPLOYMENT_PROFILE` env var and exports
  `appConfig`).
- `frontend/src/config/` — the same structure, resolved from
  `NEXT_PUBLIC_DEPLOYMENT_PROFILE` (must be `NEXT_PUBLIC_`-prefixed because branding is
  inherently client-visible).

This directory (`/config`) is documentation only — it is not imported by either app. Treat
it as the spec both per-app config modules follow.

## What a profile controls today

Both `oss` profiles (the only ones with real values) currently customize:

- **Branding**: app name, tagline, canonical app URL, marketing/landing URL (frontend);
  the name the AI assistant refers to itself as in system prompts (backend).
- **External links**: terms of use, privacy policy (frontend).
- **Support contact**: a support email address (both).
- **Allowed document categories**: an array of practice-area/document-category labels a
  deployment wants to restrict or suggest. Empty by default (no restriction — matches
  current OSS behavior of free-text practice areas).
- **Feature flags**: currently just `modeLawIntegration` (boolean, off by default) —
  reserved for future code that needs to branch on "is this a mode.law deployment",
  without needing to know anything else about what that means.

## What a profile deliberately does NOT control

No proprietary mode.law logic, copy, prompts, or workflows exist anywhere in this
repository. `profiles/mode-law.ts` in both apps is a **placeholder with the same generic
OSS-safe values** as `profiles/oss.ts` — it exists to prove the wiring works end-to-end
(profile selection, fallback on unknown profile, TypeScript shape) without checking in
any actual mode.law branding. A future private overlay or fork can either fill in real
values in these files, or replace them entirely — application code never needs to change
either way, since it only ever reads `appConfig.*`.

## How to select a profile

Unset (default): the `oss` profile is used.

```bash
# backend/.env
DEPLOYMENT_PROFILE=oss

# frontend/.env.local
NEXT_PUBLIC_DEPLOYMENT_PROFILE=oss
```

Setting either to `mode-law` activates the placeholder profile (currently identical output
to `oss`, since no real values have been filled in yet). Setting either to an unrecognized
value logs a warning and falls back to `oss` — it never crashes the app.

## Extending this later

To add a new profile field (e.g. a default system-prompt override, a logo URL, a list of
enabled workflows):

1. Add the field to `DeploymentProfile` in both `backend/src/config/types.ts` and
   `frontend/src/config/types.ts` (keep the two in sync manually — there's no shared
   package to enforce this automatically, see "Where the actual config lives" above).
2. Set a value for it in both `profiles/oss.ts` files (the current default behavior).
3. Set a value for it in both `profiles/mode-law.ts` files (real value, or leave matching
   `oss.ts` until there's a real value to put there).
4. Read `appConfig.<field>` wherever the hardcoded value used to be.

Keep changes additive and backward compatible so this fork can continue to track upstream
Mike/MicOS without merge conflicts in application code — only the `config/` directories
should need mode.law-specific edits over time.
