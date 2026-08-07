---
name: deploy-edge
description: How to deploy the edge/ Hono service to Fastly Compute — the automatic CI path and the manual `fastly compute publish` fallback, including required env vars and the publish-kv ordering constraint. Use when deploying edge/, debugging a deploy, or asked how the service ships to production.
---

# Production deployment

The service is live, and `.github/workflows/main.yml` deploys it automatically on every push to `main`: the `publish-kv` job builds the KV dataset and publishes it first, and `deploy-edge` (`needs: [publish-kv, detect-edge-change]`) runs afterward only if `edge/**` changed in that push, or the workflow was manually dispatched with `force_deploy_edge`. Deliberately one workflow with sequential jobs, not two independently `push`-triggered ones — a merge touching both `starter-kits/**` and `edge/**` at once could otherwise let them race, deploying `edge/` against stale/incomplete KV data.

To do it manually (e.g. for local testing, or if CI is down), from `edge/`:

```bash
set -a && source ../.env && set +a   # exports FASTLY_API_TOKEN, FASTLY_SERVICE_ID
fastly compute publish --verbose
```

`fastly compute publish` builds (runs `fastly.toml`'s `[scripts.build]`, i.e. `npm run build`) and deploys in one step, reading `FASTLY_API_TOKEN`/`FASTLY_SERVICE_ID` from the environment automatically (confirmed via `fastly compute publish --help`) — no explicit `--token`/`--service-id` flags needed. This is a different (broader) command than `edge/package.json`'s `deploy` script (`fastly compute deploy`), which only activates an already-built package and expects `bin/main.wasm` to exist already. CI itself uses the more granular `fastly/compute-actions/build` + `fastly/compute-actions/deploy` (official Fastly-maintained GitHub Actions), matching this same build-then-deploy split rather than the combined `publish` command.

The service ID is deliberately not recorded here — that's what `FASTLY_SERVICE_ID` in the gitignored root `.env` (locally) / the `production` GitHub Environment's secrets (in CI) are for, and `fastly compute publish` reports it on every run. The production domain is public information (`compute-starter-kits.fastly.dev`, documented in the root `README.md`) and is fine to reference. A full deploy must be preceded by a successful `publish-kv` run — the service reads from the KV store, not from `starter-kits/` directly, so stale or empty KV data will make `/kits`, `/kits/:lang/:name/readme`, and `/kits/:lang/:name/tarball` serve wrong or missing results regardless of what's actually in the edge code.
