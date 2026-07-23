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
  };
}

export interface GlobalManifest {
  generated_at: string;
  kits: StarterKitEntry[];
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

// Looks up a single kit by {lang}/{name} within an already-fetched manifest, or a 404 Response.
function findKit(c: any, manifest: GlobalManifest, lang: string, name: string): StarterKitEntry | Response {
  const kit = manifest.kits.find((k) => k.id === `${lang}-${name}`);
  if (!kit) {
    return c.text(`Starter kit not found for: ${lang}/${name}`, 404);
  }
  return kit;
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

  return c.json({
    generated_at: manifest.generated_at,
    kits
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

  const kit = findKit(c, manifest, lang, name);
  if (kit instanceof Response) return kit;

  return c.json({ files: kit.catalog.files });
});

// GET /kits/:lang/:name/file/:filename (Streams the raw content of one declared file)
app.get('/kits/:lang/:name/file/:filename', async (c) => {
  const { lang, name, filename } = c.req.param();
  const cacheKey = `file:${lang}:${name}:${filename}`;

  const entry = await c.env.kitsStorage.get(cacheKey);
  if (!entry) {
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
    return c.text(`Starter kit readme template not found for: ${lang}/${name}`, 404);
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
    return c.text(`Scaffolding archive target bundle not found for: ${lang}/${name}`, 404);
  }

  // Explicit headers required to feed the streamed client extraction loop securely
  c.header('Content-Type', 'application/gzip');
  c.header('Content-Disposition', `attachment; filename="${lang}-${name}.tar.gz"`);
  c.header('Cache-Control', 'public, max-age=3600');

  // Pipe the raw background binary stream directly out of the KV store layer
  return c.body(entry.body);
});
