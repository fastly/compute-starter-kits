# compute-starter-kits

Monorepo containing starter kits for the Fastly Compute platform.

## What's here

`starter-kits/` holds ready-to-deploy Fastly Compute starter kits, organized by language:

- `starter-kits/cpp/`
- `starter-kits/go/`
- `starter-kits/javascript/`
- `starter-kits/python/`
- `starter-kits/rust/`

Each `starter-kits/<language>/<kit-name>/` directory is a self-contained Compute project (its own `fastly.toml`, `README.md`, and source) that you can deploy as-is or use as a starting point for your own project.

This catalog of kits — descriptions, tags, and downloadable scaffolding archives — is served by a small Fastly Compute service in `edge/`, which is what powers kit discovery in the Fastly CLI (`fastly compute init`) and the Fastly developer documentation.

## Catalog API

The service is live at `https://compute-starter-kits.fastly.dev`. It's read-only and needs no authentication, so you can query it directly:

| Endpoint | Returns |
| --- | --- |
| `GET /kits` | The full manifest of every kit. Filter with `?lang=`, `?cli=true`, or `?docs=true`. |
| `GET /kits/:lang/:name` | A single kit's manifest entry |
| `GET /kits/:lang/:name/readme` | That kit's README (`text/markdown`) |
| `GET /kits/:lang/:name/tarball` | That kit's scaffolding archive (`application/gzip`) |
| `GET /kits/:lang/:name/file` | Extra assets the kit declares (e.g. a screenshot) |
| `GET /kits/:lang/:name/file/:filename` | One of those assets, with its own content type |

```bash
curl https://compute-starter-kits.fastly.dev/kits?lang=rust
curl https://compute-starter-kits.fastly.dev/kits/rust/default/readme
```

## Development

This section is for people working on the monorepo's tooling itself, not just using a kit.

**Layout:**
- `starter-kits/` — the kit sources (see above)
- `tools/build-kv/` — compiles `starter-kits/` into the dataset (per-kit READMEs, tarballs, and a global manifest) that the catalog service serves
- `tools/publish-kv/` — publishes that dataset to the production Fastly KV store
- `tools/*.mts` — standalone helper scripts (see below)
- `edge/` — the Fastly Compute service (Hono on `@fastly/js-compute`) that serves the catalog

`tools/build-kv`, `tools/publish-kv`, and `edge/` are each an independent npm package (no root workspace) — run `npm install` inside whichever one you're working on.

**Scripts:**

The `.mts` files directly under `tools/` are standalone — they have no dependencies and no `package.json`, so they run straight from a checkout with no install step. Node executes them directly using its built-in type stripping. (`tools/tsconfig.json` exists only so editors understand them; nothing consults it at runtime.)

`tools/clean-kits.mts` — removes build artifacts (`target/`, `node_modules/`, `bin/`, `pkg/`, `.fastly/`, `build/`, `.venv/`, `__pycache__/`, `.ruff_cache/`) from every kit. Rust, JavaScript, and Python kits in particular can accumulate over a gigabyte after a few local builds.

```bash
node tools/clean-kits.mts              # clean every kit
node tools/clean-kits.mts --dry-run    # list what would be removed, delete nothing
node tools/clean-kits.mts rust         # only kits in one language
node tools/clean-kits.mts rust/auth    # only one kit
```

It refuses to delete anything `git check-ignore` doesn't report as ignored, so it can't remove tracked source — a directory that isn't ignored is skipped with a warning. Runs from any subdirectory.

`tools/list-kits.mts` — CI helper that resolves which kits a workflow run should build, emitting `kits=<json>` and `has_kits=<bool>` for `$GITHUB_OUTPUT`. Reads a JSON array of changed paths from `CHANGED_FILES`; setting `ALL_KITS=true` enumerates every kit instead, which is how the `all-kits` PR label works. Used by `test-starter-kits.yml`; not something you'd normally run by hand.

```bash
CHANGED_FILES='["starter-kits/rust/auth/main.rs"]' node tools/list-kits.mts
ALL_KITS=true node tools/list-kits.mts
```

**Local setup:**

Requires Node.js 24 or newer (all three packages declare `"engines": {"node": ">=24"}`).

1. Copy `.env.example` to `.env` at the repo root and fill in your Fastly credentials. This is shared by `tools/publish-kv` and by `edge/` deploys.
2. `cd tools/build-kv && npm install && node src/index.ts` — generates local KV data under `edge/test-data/`.
3. `cd edge && npm install && fastly compute serve` — runs the catalog service locally against that data (requires the [Fastly CLI](https://developer.fastly.com/reference/cli/)).

**Testing:** `tools/build-kv`, `tools/publish-kv`, and `edge/` each have a Vitest suite — run `npm test` inside any of them. No lint/format tooling is configured yet in any package.

**CI:** GitHub Actions runs the test suites above on every PR and push to `main`, and builds/smoke-tests whichever starter kit(s) a PR touches. On merge to `main`, `tools/build-kv` + `tools/publish-kv` run automatically to keep the production KV store in sync; `edge/` is deployed automatically too, but only when `edge/` itself changed (or the workflow is triggered manually).

## License

MIT — see [LICENSE](./LICENSE).
