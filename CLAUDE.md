# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

This monorepo is the canonical source for Fastly Compute starter kits, replacing the set of individually-managed `fastly/compute-starter-kit-*` GitHub repos.

This repo is public, and its git history starts from a squashed initial commit. `CLAUDE.md` is provided publicly on the basis that it's contextual repo documentation rather than a disclosure of anything sensitive. Keep it that way — setup-specific values (service IDs, KV store IDs, tokens, temporary/preview hostnames such as `*.edgecompute.app`) must never be written here; document the env var *name* and where the value lives instead, as the "Secrets" section does. The production domain `compute-starter-kits.fastly.dev` is *not* in that category — it's public, discoverable from the Fastly CLI's own source, and documented in `README.md`.

Kit sources under `starter-kits/` are maintained directly in this repo — edit them in place. The legacy repos are no longer a source of truth, and nothing here syncs from them.

## Layout

- `starter-kits/<language>/<kit-name>/` — kit sources (`cpp`, `go`, `javascript`, `rust`), each a self-contained Compute project with its own `fastly.toml`.
- `tools/build-kv/`, `tools/publish-kv/`, `edge/` — three **independent** npm packages, each `"type": "module"`, pinned to Node ≥24 via `engines`. `npm install` must be run inside each one separately, and there's no root-level command that touches all of them at once.
- No lint/format config (ESLint/Prettier/etc.) exists in any package yet.
- `tools/build-kv`, `tools/publish-kv`, and `edge/` each have a Vitest suite (`npm test`). Each package splits its side-effecting entry point (`index.ts`, which runs its `run()`/`fire()` unconditionally at module load) from a `lib.ts`/`app.ts` holding the actual exported, testable logic — importing `index.ts` directly would otherwise trigger the whole pipeline (or, for `edge/`, throw at import time: `@fastly/hono-fastly-compute` statically imports `fastly:*` virtual modules that only exist inside the real Compute runtime). Keep new logic in `lib.ts`/`app.ts` and keep `index.ts` thin, or it becomes untestable the same way.

## The pipeline: build-kv → publish-kv, served by edge

1. **`tools/build-kv`** (`node src/index.ts`): the build step. Reads every kit's `fastly.toml` (via `smol-toml` — see below), builds a per-kit README copy, a sanitized tarball (lockfiles and the `[catalog]` table stripped), and a global manifest, then writes all of it as `edge/test-data/kv_store_mock.json` + `edge/test-data/{readmes,tarballs}/`. That output also happens to be directly consumable by Fastly's local dev server (Viceroy) via `edge/fastly.toml`'s `[local_server.kv_stores]` — that's a convenience, not the reason the tool exists.
   - Lockfiles are committed in `starter-kits/` so Dependabot can track this repo's own copies and so builds here are reproducible, but they're deliberately excluded from the shipped tarball: a starter kit should resolve current dependency versions on the customer's first `npm install`/`go build`/`cargo build`, rather than freezing to whatever this repo happens to have pinned.
2. **`tools/publish-kv`** (`node src/index.ts`, needs `FASTLY_API_TOKEN` + `FASTLY_KV_STORE_ID`): reads that same generated dataset and `PUT`s it to the real Fastly KV store, skipping keys whose content hash (stored in KV metadata) hasn't changed. It also lists every key currently in the remote store and `DELETE`s any that are no longer present in the local build output, so a full, successful `build-kv` run must precede it — running `publish-kv` against a partial/incomplete local dataset will prune keys it shouldn't. As a backstop against exactly that, it refuses to delete more than `maxDeleteCount` (default 10) stale keys in one run unless called with `force: true` (`--force` on the CLI). Runs automatically on merge to `main` via `.github/workflows/main.yml` — see "Deployment and CI" below.
3. **`edge/`**: a Hono app on the Fastly Compute JS runtime (`@fastly/js-compute`), bound to the KV store (binding name `compute_starter_kits`). Routes: `GET /kits` (manifest, with `?lang=`/`?cli=`/`?docs=` filters — `cli`/`docs` correspond to the Fastly CLI and the Fastly docs site as separate consumers of the same catalog), `GET /kits/:lang/:name` (single kit's manifest entry), `GET /kits/:lang/:name/readme`, `GET /kits/:lang/:name/tarball`, `GET /kits/:lang/:name/file` (lists a kit's declared `[[catalog.files]]` assets, from the manifest), `GET /kits/:lang/:name/file/:filename` (streams one, direct KV lookup — see below). `cd edge && fastly compute serve` runs it locally (the build step runs automatically per `fastly.toml`'s `[scripts]`).

**KV key format is load-bearing across three independent codebases** (`build-kv`, `publish-kv`, `edge`): `readme:<lang>:<kit>`, `tarball:<lang>:<kit>`, `file:<lang>:<kit>:<filename>`, and a single `manifest` key. If you change this format in one place, you must change it in all three.

**Content-Type travels in the KV entry's own metadata, not the manifest.** `build-kv` writes every non-manifest entry as `{ file, metadata }`, matching Fastly's local KV store JSON format exactly (see `[local_server.kv_stores]` in `edge/fastly.toml` — `file`/`metadata` are the real field names Viceroy reads, so this generated file doubles as local dev data with no translation step). `metadata` is a JSON-encoded string containing `content_type`. `publish-kv` reads `content_type` back out of that local `metadata` string, then re-encodes its own metadata payload for the real KV store (`{ sha256, content_type, updated_at }`) and re-uploads whenever either the content hash *or* the declared `content_type` changes. At request time, `edge`'s `/file/:filename` route reads `content_type` straight off the fetched entry's `entry.metadata()` — a single direct KV lookup, no manifest round-trip — the same pattern the readme/tarball routes use (those hardcode their content type inline since it never varies).

## Deployment and CI

- **Deploying `edge/`** (the automatic CI path, and the manual `fastly compute publish` fallback): see the `deploy-edge` skill in `.claude/skills/deploy-edge/`. A full deploy must be preceded by a successful `publish-kv` run — the service reads from the KV store, not from `starter-kits/` directly.
- **CI workflows** (`test-tools.yml`, `test-starter-kits.yml`, `main.yml`) and their per-language toolchain pinning, plus the **Dependabot update policy** (`dependabot.yml` — version updates capped at minor/patch, urgent fixes routed through security updates): see `.github/CLAUDE.md`, which loads automatically when working under `.github/`.
- **Calling the Fastly KV Store REST API directly** (header names, `HEAD` support, metadata encoding, key listing): see the `fastly-kv-api` skill in `.claude/skills/fastly-kv-api/`.

## `[catalog]` table in kit `fastly.toml` files

`show_on_docs`, `show_on_cli`, `tags`, `topics`, `files`, `min_cli_version`, and `slug` are monorepo-only catalog metadata, authored (when present) in a dedicated `[catalog]` table in a kit's `fastly.toml` — they are not real Fastly Compute manifest fields. `tools/build-kv` strips this whole table out of the tarball before it ships, so a customer who downloads the kit never sees it.

- `tags` are freeform, kit-author-defined labels. `topics` are a separate, curated cross-repo taxonomy of use-case categories (e.g. `real-time`, `static-content`, `rate-limiting`) — populated from a source list maintained outside this repo, kept distinct from `tags` because they serve a different downstream purpose. Both are plain string arrays with the same `[]` default.
- `[[catalog.files]]` is an array of tables declaring extra named assets (e.g. a preview screenshot) that live alongside a kit's source but aren't part of the shipped tarball — each entry needs `filename` (must exist in the kit's own source dir; `build-kv` fails the build loudly if it doesn't) and `content_type`. `build-kv` copies each into its own KV-bound location (`file:<lang>:<kit>:<filename>`) rather than bundling it into the tarball or the manifest's bytes. Defaults to `[]`.
- `slug` is an optional string, passed straight through to the manifest's `catalog.slug` unchanged when present (e.g. matching the kit's old standalone repo name, `compute-starter-kit-<name>`) — no other processing or validation. Omitted from the manifest entirely (not even `null`) when absent from a kit's `fastly.toml`, rather than defaulting to an empty string.
- Parse with `smol-toml`, never by hand — regex-based TOML parsing silently mangles multi-line arrays and inline comments.
- Only a handful of kits have a populated `[catalog]` table — the ones with real `topics`/`files`/`slug` values. Missing fields default to `show_on_docs=true`, `show_on_cli=true`, `tags=[]`, `topics=[]`, `files=[]`, `min_cli_version='16.0.0'` (`slug` has no default — it's simply absent).
- The compiled manifest (`build-kv`'s `GlobalManifestEntry`, `edge`'s `StarterKitEntry`) passes this table straight through under a `catalog` key (`{ show_on_docs, show_on_cli, tags, topics, files, min_cli_version }`), rather than flattening/renaming fields — no external consumer (CLI, Developer Hub, etc.) depends on a specific shape yet, so keep it this simple unless one actually needs otherwise. Note `files` here is only for listing/enumeration (`GET /kits/:lang/:name/file`) — its `content_type` is *not* what the edge app trusts when actually serving a file's bytes; see the KV-metadata note above.

## `build-kv` must copy dotfiles, not just visible ones

When staging the shipped tarball, `tools/build-kv` copies `dir/.`, never `dir/*`. A shell glob silently skips dotfiles and dotdirs — `.fastlyignore`, `.cargo/`, `.clang-format`, etc. — so `dir/*` drops `.fastlyignore` from every kit and `.cargo/config.toml` from every Rust kit, and the latter is what sets `[build] target = "wasm32-wasip1"`: without it, `cargo build --profile release` silently targets the host architecture instead of wasm and fails to link. Copying `dir/.` takes everything, dotfiles included, without relying on glob expansion at all.

`.github/` is deliberately stripped from the tarball. A kit's own workflows would run CI against its upstream repo — not relevant here, and not part of what a customer downloads.

## Secrets

Root-level `.env` (gitignored; template in `.env.example`) holds `FASTLY_API_TOKEN`, `FASTLY_KV_STORE_ID`, `FASTLY_SERVICE_ID`, shared across tools:
- `tools/publish-kv` reads `FASTLY_API_TOKEN` + `FASTLY_KV_STORE_ID`.
- Deploying `edge/` (`fastly compute publish` locally, or `deploy-edge` in CI) uses `FASTLY_API_TOKEN` + `FASTLY_SERVICE_ID`.

Nothing in the code loads `.env` automatically — source it into your shell before running these locally.

This repo is public, so these three values are kept out of it entirely (not even as placeholders beyond `.env.example`'s empty template). In CI, they live in the `production` GitHub Environment's secrets (with required-reviewer protection on the `deploy-edge` job specifically, since that's the customer-facing deploy) rather than in a committed file — if any of these values ever change, update them there too, not just in `.env`.

## Known gaps (don't "fix" silently — they're tracked, not accidents)

- No lint/format tooling in any package.
- Initial Fastly service creation, KV store creation, and linking the store to the service are done manually/out-of-band — not scripted anywhere in this repo.
- The optional per-kit test suite plumbing in `test-starter-kits.yml` is untested in practice, since no kit defines any tests.
- Nothing enforces `min_cli_version` at request time; it's catalog metadata that downstream consumers may or may not act on.
