/// <reference types="@fastly/js-compute" />
import { Hono } from 'hono';

// Manifest schema
export interface CatalogFile {
  filename: string;
  content_type: string;
}

export interface StarterKitEntry {
  id: string;
  name: string;
  path: string;
  language: string;
  description: string;
  catalog: {
    show_on_docs: boolean;
    show_on_cli: boolean;
    tags: string[];
    topics: string[];
    files: CatalogFile[];
    min_cli_version: string;
    slug?: string;
    // Identities this kit used to be published under and must keep answering for. `alt_names`
    // are the `:name` in these routes (per-language); `alt_slugs` are docs URLs (global).
    alt_names?: string[];
    alt_slugs?: string[];
  };
}

// A kit that has been deliberately pulled. Kept in the manifest so these routes can distinguish
// "retired" (410) from "never existed" (404) -- see the `retired` array below.
export interface RetiredKitEntry {
  id: string;
  path: string;
  language: string;
  catalog: {
    slug: string;
    alt_names?: string[];
    alt_slugs?: string[];
    replaced_by?: string;
    retired_on?: string;
  };
}

export interface GlobalManifest {
  generated_at: string;
  kits: StarterKitEntry[];
  // Optional on purpose: a manifest published before retirement support existed has no such
  // array, and this app must keep serving that manifest unchanged rather than 500ing on it.
  retired?: RetiredKitEntry[];
}

// Bindings shape kept in sync by hand with what `buildFire({ kitsStorage: 'KVStore:...' })`
// in index.ts infers (`typeof fire.Bindings`). Deliberately NOT importing `buildFire` here:
// @fastly/hono-fastly-compute (via @fastly/compute-js-context) statically imports the
// `fastly:*` virtual modules (e.g. `fastly:kv-store`) that only exist inside the real
// Fastly Compute runtime -- importing it at all breaks loading this file under plain
// Node/Vitest. `import('fastly:kv-store').KVStore` below is a type-only reference (erased
// at compile time), so it carries no such runtime dependency.
export type Env = {
  Bindings: {
    kitsStorage: import('fastly:kv-store').KVStore;
    clientInfo: ClientInfo;
    serverInfo: ServerInfo;
  };
};
export const app = new Hono<Env>();

// Fetches and parses the global manifest, or a Response to return immediately on failure.
async function getManifest(c: any): Promise<GlobalManifest | Response> {
  const entry = await c.env.kitsStorage.get('manifest');
  if (!entry) {
    return c.json({ error: 'Global manifest catalog not found' }, 500);
  }
  return (await entry.json()) as GlobalManifest;
}

// The kit's directory name -- the `:name` in these routes and the `<kit>` in its KV keys. Taken
// from `path` because the entry's own `name` field is the display title out of fastly.toml.
function kitDirName(entry: { path: string }): string {
  return entry.path.split('/').pop() ?? '';
}

// Looks up a single kit by {lang}/{name} within an already-fetched manifest. A name the kit was
// previously published under redirects to its current URL; a retired kit reports 410; anything
// else is a genuine 404.
function findKit(c: any, manifest: GlobalManifest, lang: string, name: string, suffix = ''): StarterKitEntry | Response {
  const kit = manifest.kits.find((k) => k.id === `${lang}-${name}`);
  if (kit) return kit;
  return resolveUnknownKit(c, manifest, lang, name, suffix);
}

// Shared fallback for a {lang}/{name} that isn't a live kit. `suffix` is the part of the path
// after the kit name (e.g. '/readme'), so a redirect lands on the equivalent sub-resource.
function resolveUnknownKit(c: any, manifest: GlobalManifest, lang: string, name: string, suffix: string): Response {
  const renamed = manifest.kits.find(
    (k) => k.language === lang && (k.catalog.alt_names ?? []).includes(name)
  );
  if (renamed) {
    // Redirect to the kit's *directory* name, which lives in `path` -- `name` is the human
    // readable title from fastly.toml ("OAuth 2.0 in JavaScript"), not a URL segment.
    //
    // 308, not 301: both are permanent, but 301 permits a client to rewrite the request method
    // to GET, whereas 308 requires the method and body be preserved. Every route here is GET
    // today so it makes no observable difference, which is exactly why it's worth using the
    // precise code now -- it can't quietly become wrong if a non-GET route is ever added.
    return c.redirect(`/kits/${lang}/${kitDirName(renamed)}${suffix}`, 308);
  }

  const retired = (manifest.retired ?? []).find(
    (r) => r.language === lang && (kitDirName(r) === name || (r.catalog.alt_names ?? []).includes(name))
  );
  if (retired) {
    // 410 rather than 404 so crawlers and clients can tell this was deliberate, and rather than
    // a 308 to `replaced_by` because that field is a docs *slug*: mapping a slug back to a
    // {lang}/{name} path would mean reimplementing build-kv's slug construction rule here, and
    // that rule living in two codebases is exactly how it drifts. Consumers get the successor's
    // slug in the body and can resolve it themselves.
    return c.json(
      {
        error: `Starter kit ${lang}/${name} has been retired`,
        retired_on: retired.catalog.retired_on,
        replaced_by: retired.catalog.replaced_by
      },
      410
    );
  }

  return c.text(`Starter kit not found for: ${lang}/${name}`, 404);
}

// For the routes that read KV directly (readme/tarball/file) rather than going through the
// manifest. They stay a single lookup on the happy path; this is only called once that lookup
// has already missed, to work out whether the name is an old alias, a retirement, or nothing.
async function resolveMissedKitAsset(c: any, lang: string, name: string, suffix: string, notFoundMessage: string): Promise<Response> {
  const manifest = await getManifest(c);
  if (manifest instanceof Response) {
    // The manifest is consulted only to upgrade a 404 into a 308 or a 410. If it can't be read,
    // fall back to the 404 this route would have returned anyway -- a missing asset shouldn't
    // become a 500 just because the opportunistic lookup failed.
    return c.text(notFoundMessage, 404);
  }
  return resolveUnknownKit(c, manifest, lang, name, suffix);
}

// --- Routes ---

// GET /kits (Serves the global catalog with server-side query filters)
app.get('/kits', async (c) => {
  const cliFilter = c.req.query('cli');   // "true" | "false"
  const docsFilter = c.req.query('docs'); // "true" | "false"
  const langFilter = c.req.query('lang'); // e.g., "rust", "javascript"

  const manifest = await getManifest(c);
  if (manifest instanceof Response) return manifest;

  let kits: StarterKitEntry[] = manifest.kits;

  // Apply server-side evaluation filters matching our design criteria
  if (langFilter) {
    kits = kits.filter((k: any) => k.language === langFilter.toLowerCase());
  }
  if (cliFilter === 'true') {
    kits = kits.filter((k: any) => k.catalog.show_on_cli === true);
  }
  if (docsFilter === 'true') {
    kits = kits.filter((k: any) => k.catalog.show_on_docs === true);
  }

  // Retired kits ride along in their own array rather than in `kits`, so a consumer that hasn't
  // been taught about retirement ignores them instead of listing a kit that can't be installed.
  // The lang filter applies; cli/docs don't, since a retirement has no show_on_* flags -- it is
  // up to each consumer to decide whether to surface a retirement notice.
  let retired: RetiredKitEntry[] = manifest.retired ?? [];
  if (langFilter) {
    retired = retired.filter((r) => r.language === langFilter.toLowerCase());
  }

  return c.json({
    generated_at: manifest.generated_at,
    kits,
    retired
  });
});

// GET /kits/:lang/:name (Serves a single kit's manifest entry)
app.get('/kits/:lang/:name', async (c) => {
  const { lang, name } = c.req.param();

  const manifest = await getManifest(c);
  if (manifest instanceof Response) return manifest;

  const kit = findKit(c, manifest, lang, name);
  if (kit instanceof Response) return kit;

  return c.json(kit);
});

// GET /kits/:lang/:name/file (Lists the kit's declared [[catalog.files]] assets)
app.get('/kits/:lang/:name/file', async (c) => {
  const { lang, name } = c.req.param();

  const manifest = await getManifest(c);
  if (manifest instanceof Response) return manifest;

  const kit = findKit(c, manifest, lang, name, '/file');
  if (kit instanceof Response) return kit;

  return c.json({ files: kit.catalog.files });
});

// GET /kits/:lang/:name/file/:filename (Streams the raw content of one declared file)
app.get('/kits/:lang/:name/file/:filename', async (c) => {
  const { lang, name, filename } = c.req.param();
  const cacheKey = `file:${lang}:${name}:${filename}`;

  const entry = await c.env.kitsStorage.get(cacheKey);
  if (!entry) {
    // A miss here can mean either an unknown kit or a real kit missing that one asset, so only
    // hand off when the kit itself doesn't resolve -- otherwise keep the specific 404.
    const resolved = await resolveMissedKitAsset(c, lang, name, `/file/${filename}`, `File not found for: ${lang}/${name}/${filename}`);
    if (resolved.status !== 404) return resolved;
    return c.text(`File not found for: ${lang}/${name}/${filename}`, 404);
  }

  // content_type travels in the entry's own KV metadata (set by publish-kv from build-kv's
  // declared [[catalog.files]] content_type) rather than via a manifest lookup -- one direct
  // KV read is enough to serve the right header, same as the readme/tarball routes above.
  const metadataBuffer = entry.metadata();
  const metadata = metadataBuffer ? JSON.parse(new TextDecoder().decode(metadataBuffer)) : {};

  c.header('Content-Type', metadata.content_type ?? 'application/octet-stream');
  return c.body(entry.body);
});

// GET /kits/:lang/:name/readme (Streams raw boilerplate markdown text)
app.get('/kits/:lang/:name/readme', async (c) => {
  const { lang, name } = c.req.param();
  const cacheKey = `readme:${lang}:${name}`;

  const entry = await c.env.kitsStorage.get(cacheKey);
  if (!entry) {
    // Only reached on what would otherwise be a 404, so the happy path keeps its single KV
    // lookup and never pays for the manifest fetch.
    return await resolveMissedKitAsset(c, lang, name, '/readme', `Starter kit readme template not found for: ${lang}/${name}`);
  }

  c.header('Content-Type', 'text/markdown; charset=utf-8');
  // Pass the raw text payload stream directly back through Hono
  return c.body(entry.body);
});

// GET /kits/:lang/:name/tarball (Streams raw scaffolding code archive)
app.get('/kits/:lang/:name/tarball', async (c) => {
  const { lang, name } = c.req.param();
  const cacheKey = `tarball:${lang}:${name}`;

  const entry = await c.env.kitsStorage.get(cacheKey);
  if (!entry) {
    return await resolveMissedKitAsset(c, lang, name, '/tarball', `Scaffolding archive target bundle not found for: ${lang}/${name}`);
  }

  // Explicit headers required to feed the streamed client extraction loop securely
  c.header('Content-Type', 'application/gzip');
  c.header('Content-Disposition', `attachment; filename="${lang}-${name}.tar.gz"`);
  c.header('Cache-Control', 'public, max-age=3600');

  // Pipe the raw background binary stream directly out of the KV store layer
  return c.body(entry.body);
});
