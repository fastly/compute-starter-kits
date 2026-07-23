# compute-starter-kits

Monorepo containing starter kits for the Fastly Compute platform.

## What's here

`starter-kits/` holds ready-to-deploy Fastly Compute starter kits, organized by language:

- `starter-kits/cpp/`
- `starter-kits/go/`
- `starter-kits/javascript/`
- `starter-kits/rust/`

Each `starter-kits/<language>/<kit-name>/` directory is a self-contained Compute project (its own `fastly.toml`, `README.md`, and source) that you can deploy as-is or use as a starting point for your own project.

This catalog of kits — descriptions, tags, and downloadable scaffolding archives — is served by a small Fastly Compute service in `edge/`, which is what powers kit discovery in the Fastly CLI (`fastly compute init`) and the Fastly developer documentation.

## Development

This section is for people working on the monorepo's tooling itself, not just using a kit.

**Layout:**
- `starter-kits/` — the kit sources (see above)
- `tools/build-kv/` — compiles `starter-kits/` into the dataset (per-kit READMEs, tarballs, and a global manifest) that the catalog service serves
- `tools/publish-kv/` — publishes that dataset to the production Fastly KV store
- `edge/` — the Fastly Compute service (Hono on `@fastly/js-compute`) that serves the catalog

Each of the three is an independent npm package (no root workspace) — run `npm install` inside whichever one you're working on.

**Local setup:**
1. Copy `.env.example` to `.env` at the repo root and fill in your Fastly credentials. This is shared by `tools/publish-kv` and by `edge/` deploys.
2. `cd tools/build-kv && npm install && node src/index.ts` — generates local KV data under `edge/test-data/`.
3. `cd edge && npm install && fastly compute serve` — runs the catalog service locally against that data (requires the [Fastly CLI](https://developer.fastly.com/reference/cli/)).

**Testing:** `tools/build-kv`, `tools/publish-kv`, and `edge/` each have a Vitest suite — run `npm test` inside any of them. No lint/format tooling is configured yet in any package.

**CI:** GitHub Actions runs the test suites above on every PR and push to `main`, and builds/smoke-tests whichever starter kit(s) a PR touches. On merge to `main`, `tools/build-kv` + `tools/publish-kv` run automatically to keep the production KV store in sync; `edge/` is deployed automatically too, but only when `edge/` itself changed (or the workflow is triggered manually).

## License

MIT — see [LICENSE](./LICENSE).
