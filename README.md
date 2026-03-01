# Althea

CardPress is a Vue + Neon app for composing ordered card-based pages, saving drafts, and publishing to shareable URLs.

Quick start:

1. Apply `sql/001_cardpress.sql` to your Neon database.
2. Create a `.env` from `.env.example` and set `DATABASE_URL`.
3. Install deps: `npm install`
4. Run API server: `npm run server`
5. Run client: `npm run dev`

Published pages are viewable at `/p/:published_slug`.

## Netlify deploy guard (avoid burning deploys)

This repo uses `build.ignore` in `netlify.toml` via `scripts/netlify-ignore.sh`.
Netlify also rewrites `/api/*` to the `server` function and rewrites SPA routes to `index.html`.

Default behavior:
- `production` context: build allowed.
- `deploy-preview` context: skipped unless `ALLOW_DEPLOY_PREVIEWS=true`.
- `branch-deploy` context: skipped unless branch is listed in `ALLOWED_BRANCH_DEPLOYS`.
- any other context: skipped.

Netlify environment variables to control this:
- `ALLOW_DEPLOY_PREVIEWS=true` to allow PR deploy previews.
- `ALLOWED_BRANCH_DEPLOYS=cardpress,main` to allow branch deploys only for listed branches.

Suggested low-burn setup:
1. Keep `ALLOW_DEPLOY_PREVIEWS` unset (or `false`).
2. Keep `ALLOWED_BRANCH_DEPLOYS` unset unless you explicitly need branch deploys.
3. Use production deploys from your primary branch only.
