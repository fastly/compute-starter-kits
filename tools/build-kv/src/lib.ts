import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseToml } from 'smol-toml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CatalogFile {
  filename: string;
  content_type: string;
}

interface GlobalManifestEntry {
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
    // Previously-used identities that must keep resolving. `alt_names` are per-language and
    // cover the `:name` in /kits/:lang/:name; `alt_slugs` are global and cover the docs URL.
    alt_names: string[];
    alt_slugs: string[];
  };
}

// A kit that has been pulled. The directory stays (its continued existence is what reserves the
// name and slug), holding only a `retired.toml` -- no fastly.toml, so Dependabot finds no
// manifest to update and the CI kit matrix skips it. Emitted in the manifest's own top-level
// `retired` array rather than mixed into `kits`, so a consumer that hasn't been taught about
// retirement ignores these instead of listing a dead kit.
interface RetiredManifestEntry {
  id: string;
  // Deliberately no `name`: in a live entry that field is the human-readable title out of
  // fastly.toml, and a retired kit has no fastly.toml to take one from. Consumers get the
  // directory name from the last segment of `path`, exactly as they would for a live kit.
  path: string;
  language: string;
  catalog: {
    slug: string;
    alt_names: string[];
    alt_slugs: string[];
    // Slug of the kit that supersedes this one, if any, so consumers can 301 rather than 410.
    replaced_by?: string;
    retired_on?: string;
  };
}

interface MockKVIndex {
  // Matches the Fastly local_server KV store JSON format exactly (`file`/`metadata` are the
  // real field names Viceroy reads -- see `[local_server.kv_stores]` in edge/fastly.toml), so
  // this file is directly usable both as `fastly compute serve`'s local KV data AND as the
  // source publish-kv uploads to the real store. `metadata` is a JSON-encoded string (matching
  // the real KV API's raw-UTF-8-string metadata format) carrying `content_type`, which the edge
  // app reads directly off the KV entry's own metadata at request time -- see
  // GET /kits/:lang/:name/file/:filename -- rather than cross-referencing the manifest.
  [key: string]: string | { file: string; metadata?: string };
}

export interface RunOptions {
  starterKitsDir?: string;
  edgeAppDir?: string;
  tempStageDir?: string;
}

// Returns the line range [startIdx, endIdx) of a top-level TOML section, e.g. "[catalog]",
// including its header line, up to (but not including) the next top-level section header
// or the end of the file. Returns null if the section isn't present.
export function findTomlSectionRange(lines: string[], sectionName: string): { start: number; end: number } | null {
  const start = lines.findIndex(line => line.trim() === `[${sectionName}]`);
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

// Strips a top-level TOML section (header + body) out of the file contents entirely.
export function stripTomlSection(content: string, sectionName: string): string {
  const lines = content.split('\n');
  const range = findTomlSectionRange(lines, sectionName);
  if (!range) return content;
  return [...lines.slice(0, range.start), ...lines.slice(range.end)].join('\n');
}

// A kit's two independent public identities, gathered for collision checking.
//
// `name` is the directory name. It is the `<kit>` in the `readme:`/`tarball:`/`file:` KV keys
// and the `:name` in the edge app's `/kits/:lang/:name` routes, so it only has to be unique
// *within a language* -- javascript/auth and rust/auth genuinely don't collide.
//
// `slug` is the docs site's URL segment (`/documentation/solutions/starters/<slug>/`), which
// is one flat namespace, so slugs must be unique across every language.
export interface KitIdentity {
  language: string;
  name: string;
  slug: string;
  altNames: string[];
  altSlugs: string[];
  retired: boolean;
  // Path of the TOML file that declared this identity, so collision errors can point at it.
  source: string;
}

// Kits that don't declare a slug still get a docs URL, constructed from their language and
// directory name -- so those constructed values occupy the same global namespace as declared
// ones and have to take part in collision checking. Otherwise a newly declared slug (or
// alt_slug) could silently shadow another kit's existing docs URL.
//
// This is the exact inverse of the mapping that laid `starter-kits/<lang>/<name>` out from the
// original standalone `compute-starter-kit-*` repo names, so it reproduces the URLs the docs
// site already serves.
//
// The one wrinkle is TypeScript: those kits live under `javascript/` but keep `typescript-` in
// their directory name, so the language segment is already present and must not be repeated --
// `javascript/typescript-hono` is `compute-starter-kit-typescript-hono`, not
// `compute-starter-kit-javascript-typescript-hono`.
//
// Note the two kits that *do* declare a slug for a real reason (`compute-js-auth`,
// `compute-rust-auth`) predate the `compute-starter-kit-*` naming convention entirely, which is
// why they can't be constructed and have to be spelled out.
export function derivedSlug(language: string, name: string): string {
  const segment = language === 'javascript' && name.startsWith('typescript-') ? name : `${language}-${name}`;
  return `compute-starter-kit-${segment}`;
}

// Reads every kit's identity without doing any of the expensive build work, so the same rules
// can gate a PR cheaply and still backstop the publish. Covers both live kits (`fastly.toml`)
// and retired ones (`retired.toml`); a directory with neither is ignored.
export function collectKitIdentities(starterKitsDir: string): KitIdentity[] {
  const identities: KitIdentity[] = [];
  if (!fs.existsSync(starterKitsDir)) return identities;

  const languages = fs.readdirSync(starterKitsDir).filter(f => fs.statSync(path.join(starterKitsDir, f)).isDirectory());

  for (const language of languages) {
    const langPath = path.join(starterKitsDir, language);
    const names = fs.readdirSync(langPath).filter(f => fs.statSync(path.join(langPath, f)).isDirectory());

    for (const name of names) {
      const livePath = path.join(langPath, name, 'fastly.toml');
      const retiredPath = path.join(langPath, name, 'retired.toml');
      const retired = !fs.existsSync(livePath) && fs.existsSync(retiredPath);
      const source = retired ? retiredPath : livePath;
      if (!fs.existsSync(source)) continue;

      const catalog = ((parseToml(fs.readFileSync(source, 'utf8')) as Record<string, any>).catalog ?? {}) as Record<string, any>;

      identities.push({
        language,
        name,
        // An explicitly declared slug replaces the constructed one rather than adding to it.
        // The constructed value needs no reservation once replaced: only a kit at this exact
        // <lang>/<name> could ever produce it, and that's this kit.
        slug: catalog.slug ?? derivedSlug(language, name),
        altNames: catalog.alt_names ?? [],
        altSlugs: catalog.alt_slugs ?? [],
        retired,
        source
      });
    }
  }

  return identities;
}

// Enforces that no public identity is ambiguous. Returns one message per collision; an empty
// array means the catalog is valid. Retired kits participate fully: their names and slugs stay
// reserved forever, so a future kit can never claim a URL that used to mean something else.
export function validateCatalogIdentities(identities: KitIdentity[]): string[] {
  const errors: string[] = [];

  // Names: unique per language, across both canonical names and alt_names.
  const namesByLanguage = new Map<string, Map<string, string[]>>();
  for (const identity of identities) {
    if (!namesByLanguage.has(identity.language)) namesByLanguage.set(identity.language, new Map());
    const seen = namesByLanguage.get(identity.language)!;
    for (const name of [identity.name, ...identity.altNames]) {
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name)!.push(identity.source);
    }
  }
  for (const [language, seen] of namesByLanguage) {
    for (const [name, sources] of seen) {
      if (sources.length > 1) {
        errors.push(`Duplicate kit name "${name}" in language "${language}", declared by: ${sources.sort().join(', ')}`);
      }
    }
  }

  // Slugs: unique globally, across canonical (declared or constructed) slugs and alt_slugs.
  const slugs = new Map<string, string[]>();
  for (const identity of identities) {
    for (const slug of [identity.slug, ...identity.altSlugs]) {
      if (!slugs.has(slug)) slugs.set(slug, []);
      slugs.get(slug)!.push(identity.source);
    }
  }
  for (const [slug, sources] of slugs) {
    if (sources.length > 1) {
      errors.push(`Duplicate slug "${slug}" declared by: ${sources.sort().join(', ')}`);
    }
  }

  return errors.sort();
}

// Reads the same identities out of a git revision instead of the working tree, so a PR can be
// compared against its merge base. Uses `git show` rather than checking the ref out, to avoid
// touching the working tree at all.
export function collectKitIdentitiesAtRef(ref: string, prefix = 'starter-kits'): KitIdentity[] {
  // `--full-tree` is load-bearing: without it `git ls-tree`'s pathspec resolves relative to the
  // current directory, so running this from tools/build-kv silently matches nothing and the
  // comparison set comes back empty -- which reads as "everything still resolves" and passes.
  const listing = execSync(`git ls-tree -r --name-only --full-tree "${ref}" -- "${prefix}"`, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString('utf8')
    .split('\n')
    .filter(Boolean);

  if (listing.length === 0) {
    throw new Error(`No kit manifests found under "${prefix}" at ref "${ref}" -- refusing to report continuity as OK against an empty comparison set.`);
  }

  // A directory can contain both files mid-retirement; live wins, matching the working-tree rule.
  const sources = new Map<string, { language: string; name: string; path: string; retired: boolean }>();
  for (const filePath of listing) {
    const match = filePath.match(/^(?:.*\/)?([^/]+)\/([^/]+)\/(fastly|retired)\.toml$/);
    if (!match) continue;
    const [, language, name, kind] = match;
    const key = `${language}/${name}`;
    if (kind === 'fastly' || !sources.has(key)) {
      sources.set(key, { language, name, path: filePath, retired: kind === 'retired' });
    }
  }

  const identities: KitIdentity[] = [];
  for (const { language, name, path: filePath, retired } of sources.values()) {
    const content = execSync(`git show "${ref}:${filePath}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
    const catalog = ((parseToml(content) as Record<string, any>).catalog ?? {}) as Record<string, any>;
    identities.push({
      language,
      name,
      slug: catalog.slug ?? derivedSlug(language, name),
      altNames: catalog.alt_names ?? [],
      altSlugs: catalog.alt_slugs ?? [],
      retired,
      source: `${ref}:${filePath}`
    });
  }

  return identities;
}

// The rule that actually makes renames followable: every public identity that exists in `base`
// must still resolve in `head` -- as a canonical value, via alt_names/alt_slugs, or through a
// retired.toml tombstone. Internal consistency alone can't tell a rename from a deletion, so
// without this a PR could drop a name entirely and still pass.
export function validateIdentityContinuity(base: KitIdentity[], head: KitIdentity[]): string[] {
  const errors: string[] = [];

  const headNames = new Set<string>();
  const headSlugs = new Set<string>();
  for (const identity of head) {
    for (const name of [identity.name, ...identity.altNames]) headNames.add(`${identity.language}/${name}`);
    for (const slug of [identity.slug, ...identity.altSlugs]) headSlugs.add(slug);
  }

  for (const identity of base) {
    for (const name of [identity.name, ...identity.altNames]) {
      if (!headNames.has(`${identity.language}/${name}`)) {
        errors.push(`Kit name "${identity.language}/${name}" no longer resolves. Renaming? add it to the new kit's catalog.alt_names. Retiring? leave a retired.toml carrying it.`);
      }
    }
    for (const slug of [identity.slug, ...identity.altSlugs]) {
      if (!headSlugs.has(slug)) {
        errors.push(`Slug "${slug}" no longer resolves, which would break https://www.fastly.com/documentation/solutions/starters/${slug}/. Renaming? add it to the new catalog.alt_slugs. Retiring? leave a retired.toml carrying it.`);
      }
    }
  }

  return [...new Set(errors)].sort();
}

// Copies a kit's sources into `destPath`, using git's index as the allowlist of what may
// ship. Copying the directory wholesale instead (`cp -R kit/.`) also picks up whatever
// untracked junk happens to sit in a maintainer's working tree -- `node_modules/`, `bin/`,
// `pkg/`, and for the OAuth kits the local `.secret.*` files, whose plaintext would then be
// served from the public tarball endpoint. Nothing here reads `.gitignore`/`.fastlyignore`,
// so "what git tracks" is the only allowlist available that can't silently go stale.
//
// Dotfiles still ship: `.fastlyignore`, `.cargo/config.toml` (which sets the Rust kits'
// wasm32-wasip1 target, without which `cargo build` silently targets the host) and friends
// are all tracked. Uncommitted edits to tracked files also flow through, since the bytes are
// read from the working tree -- that's deliberate, so a kit can be previewed before commit.
export function stageKitSources(sourceKitPath: string, destPath: string): void {
  let tracked: string[] = [];
  try {
    tracked = execSync('git ls-files -z', { cwd: sourceKitPath, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
  } catch {
    // Not a git work tree at all (e.g. the kit sources were themselves extracted from an
    // archive). Handled by the same fallback as the nothing-tracked-yet case below.
  }

  if (tracked.length === 0) {
    // A brand-new kit directory that has not been `git add`ed yet lands here too. Copying
    // nothing would ship an empty tarball, so fall back to the whole directory -- but say so,
    // because this is exactly the path that can leak untracked files.
    console.warn(`  WARNING: no git-tracked files under ${sourceKitPath}; copying the entire directory instead. Untracked files WILL be included in the shipped tarball.`);
    fs.mkdirSync(destPath, { recursive: true });
    execSync(`cp -R "${sourceKitPath}/." "${destPath}/"`);
    return;
  }

  const missing: string[] = [];
  for (const rel of tracked) {
    const from = path.join(sourceKitPath, rel);
    if (!fs.existsSync(from)) {
      missing.push(rel);
      continue;
    }
    const to = path.join(destPath, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  // Tracked but absent from the working tree: usually an unstaged deletion, but a sparse
  // checkout looks identical from here. Either way the file drops out of the tarball.
  if (missing.length > 0) {
    console.warn(`  WARNING: ${missing.length} file(s) tracked under ${sourceKitPath} are missing from the working tree and were omitted from the tarball: ${missing.join(', ')}`);
  }

  // The flip side of using the index as the allowlist: a file the author created but never
  // `git add`ed silently will not ship. Ignored paths (node_modules/, bin/, .secret.*) are
  // excluded on purpose and must stay quiet, hence --exclude-standard.
  try {
    const untracked = execSync('git ls-files -z --others --exclude-standard', { cwd: sourceKitPath, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    if (untracked.length > 0) {
      console.warn(`  WARNING: ${untracked.length} file(s) under ${sourceKitPath} are not tracked by git and were omitted from the tarball -- \`git add\` them if they belong in the kit: ${untracked.join(', ')}`);
    }
  } catch {
    // Best-effort advisory only; never fail the build over it.
  }
}

export function run(options: RunOptions = {}): void {
  console.log('Initializing local KV generation workspace...');

  const starterKitsDir = options.starterKitsDir ?? path.join(__dirname, '../../../starter-kits');
  const edgeAppDir = options.edgeAppDir ?? path.join(__dirname, '../../../edge');
  const tempStageDir = options.tempStageDir ?? path.join(__dirname, '..');
  const outputDataDir = path.join(edgeAppDir, './test-data');
  const mockIndexFile = path.join(outputDataDir, './kv_store_mock.json');

  // Ensure clean target build output directory directories exist
  if (fs.existsSync(outputDataDir)) {
    fs.rmSync(outputDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(outputDataDir, 'tarballs'), { recursive: true });
  fs.mkdirSync(path.join(outputDataDir, 'readmes'), { recursive: true });
  fs.mkdirSync(path.join(outputDataDir, 'files'), { recursive: true });

  const mockStoreIndex: MockKVIndex = {};
  const globalKitsCatalog: GlobalManifestEntry[] = [];
  const retiredCatalog: RetiredManifestEntry[] = [];

  if (!fs.existsSync(starterKitsDir)) {
    console.error(`Error: starter kits folder not found at ${starterKitsDir}.`);
    process.exit(1);
  }

  // Ambiguous identities are a publish-time hazard, not just a review nit: two kits claiming
  // one docs URL means whichever consumer resolves first wins. The PR check (src/validate.ts)
  // is the real gate; this is the backstop that stops a bad catalog reaching the KV store if
  // something lands without it.
  const identityErrors = validateCatalogIdentities(collectKitIdentities(starterKitsDir));
  if (identityErrors.length > 0) {
    console.error('Error: the starter kit catalog has ambiguous public identities:');
    for (const message of identityErrors) console.error(`  - ${message}`);
    process.exit(1);
  }

  const languages = fs.readdirSync(starterKitsDir).filter(f => fs.statSync(path.join(starterKitsDir, f)).isDirectory());

  for (const lang of languages) {
    const langPath = path.join(starterKitsDir, lang);
    const kits = fs.readdirSync(langPath).filter(f => fs.statSync(path.join(langPath, f)).isDirectory());

    for (const kitName of kits) {
      const sourceKitPath = path.join(langPath, kitName);
      const tomlPath = path.join(sourceKitPath, 'fastly.toml');
      const readmePath = path.join(sourceKitPath, 'README.md');

      // A retired kit keeps its directory but has only a retired.toml. It still has to appear in
      // the manifest, or consumers can't tell "deliberately pulled" (410, or 301 to a successor)
      // from "never existed" (404) -- and the whole point of keeping the directory is that the
      // old URLs keep meaning something.
      if (!fs.existsSync(tomlPath)) {
        const retiredPath = path.join(sourceKitPath, 'retired.toml');
        if (!fs.existsSync(retiredPath)) continue;

        const retiredCatalogTable = ((parseToml(fs.readFileSync(retiredPath, 'utf8')) as Record<string, any>).catalog ?? {}) as Record<string, any>;
        retiredCatalog.push({
          id: `${lang}-${kitName}`,
          path: `starter-kits/${lang}/${kitName}`,
          language: lang,
          catalog: {
            slug: retiredCatalogTable.slug ?? derivedSlug(lang, kitName),
            alt_names: retiredCatalogTable.alt_names ?? [],
            alt_slugs: retiredCatalogTable.alt_slugs ?? [],
            ...(retiredCatalogTable.replaced_by !== undefined ? { replaced_by: retiredCatalogTable.replaced_by } : {}),
            ...(retiredCatalogTable.retired_on !== undefined ? { retired_on: retiredCatalogTable.retired_on } : {})
          }
        });
        console.log(`Recording retired kit: [${lang}-${kitName}]`);
        continue;
      }

      const tomlContent = fs.readFileSync(tomlPath, 'utf8');
      const tomlDoc = parseToml(tomlContent) as Record<string, any>;

      // show_on_docs / show_on_cli / tags / topics / min_cli_version live in their own
      // [catalog] table in fastly.toml — this metadata is only consumed by services that
      // sit in front of the edge app (edge/) and is stripped from the distributed kit
      // below. Passed through into the manifest under the same "catalog" key, rather than
      // flattened/renamed, since no external consumer depends on a specific shape yet.
      // `tags` are freeform, kit-author-defined labels; `topics` are a curated,
      // cross-repo taxonomy of use-case categories (e.g. "real-time", "authentication")
      // used for a different purpose downstream -- kept as a separate field rather than
      // merged into `tags`.
      const catalog = (tomlDoc.catalog ?? {}) as Record<string, any>;
      const name = tomlDoc.name ?? kitName;
      const description = tomlDoc.description ?? '';
      // [[catalog.files]] declares extra named assets (e.g. a preview screenshot) to expose
      // individually via GET /kits/:lang/:name/file(/:filename), on top of the readme/tarball.
      // Each entry must point at a real file already sitting in the kit's own source dir --
      // fail the build loudly if not, rather than silently shipping a broken KV entry.
      const catalogFiles: CatalogFile[] = catalog.files ?? [];

      const kitId = `${lang}-${kitName}`;

      globalKitsCatalog.push({
        id: kitId,
        name,
        path: `starter-kits/${lang}/${kitName}`,
        language: lang,
        description,
        catalog: {
          show_on_docs: catalog.show_on_docs ?? true,
          show_on_cli: catalog.show_on_cli ?? true,
          tags: catalog.tags ?? [],
          topics: catalog.topics ?? [],
          files: catalogFiles,
          min_cli_version: catalog.min_cli_version ?? '16.0.0',
          ...(catalog.slug !== undefined ? { slug: catalog.slug } : {}),
          alt_names: catalog.alt_names ?? [],
          alt_slugs: catalog.alt_slugs ?? []
        }
      });

      console.log(`Processing compilation maps for kit: [${kitId}]`);

      // Write pristine isolated mock Readme text file out
      const localReadmeMockPath = path.join(outputDataDir, 'readmes', `${kitId}.md`);
      if (fs.existsSync(readmePath)) {
        fs.copyFileSync(readmePath, localReadmeMockPath);
      } else {
        fs.writeFileSync(localReadmeMockPath, `# ${name}\n\n${description}`);
      }

      // Copy each declared [[catalog.files]] asset out to its own KV-bound location.
      if (catalogFiles.length > 0) {
        const localFilesDir = path.join(outputDataDir, 'files', kitId);
        fs.mkdirSync(localFilesDir, { recursive: true });
        for (const { filename, content_type } of catalogFiles) {
          const sourceFilePath = path.join(sourceKitPath, filename);
          if (!fs.existsSync(sourceFilePath)) {
            console.error(`Error: kit [${kitId}] declares [[catalog.files]] "${filename}" but no such file exists at ${sourceFilePath}.`);
            process.exit(1);
          }
          fs.copyFileSync(sourceFilePath, path.join(localFilesDir, filename));
          mockStoreIndex[`file:${lang}:${kitName}:${filename}`] = {
            file: `./test-data/files/${kitId}/${filename}`,
            metadata: JSON.stringify({ content_type })
          };
        }
      }

      // --- Tarball Compilation Sandbox Staging ---
      const tempStagePath = path.join(tempStageDir, `.temp-tarball-stage-${kitId}`);
      fs.mkdirSync(tempStagePath, { recursive: true });
      stageKitSources(sourceKitPath, tempStagePath);

      // 1. Strip .github/ out of the distributed archive -- those workflows run CI against
      // the starter kit's own upstream repo, not against a customer's scaffolded project.
      fs.rmSync(path.join(tempStagePath, '.github'), { recursive: true, force: true });

      // 2. Programmatically sanitize and prune the [catalog] section out of the archive's
      // fastly.toml — that metadata is only needed by services consuming the edge app
      // (edge/) and has no meaning to the customer who downloads/deploys this kit.
      const cleanToml = stripTomlSection(tomlContent, 'catalog');
      fs.writeFileSync(path.join(tempStagePath, 'fastly.toml'), cleanToml);

      // 3. Compress bundle securely, deterministically. Both `tar`'s per-file mtimes
      // (freshly set by the copy/`writeFileSync` steps above) and gzip's own header
      // timestamp default to "now", which makes the archive's bytes -- and therefore
      // its content hash -- differ on every rebuild even when nothing actually changed.
      // Pinning every file's mtime and using `gzip -n` (no name/timestamp in the header)
      // makes the output byte-for-byte reproducible so publish-kv's hash-based skip
      // logic actually works for tarballs.
      execSync(`find "${tempStagePath}" -exec touch -t 202001010000 {} +`);

      const tarballFilename = `${kitId}.tar.gz`;
      const localTarballMockPath = path.join(outputDataDir, 'tarballs', tarballFilename);

      execSync(`tar -cf - -C "${tempStagePath}" . | gzip -n > "${localTarballMockPath}"`);
      fs.rmSync(tempStagePath, { recursive: true, force: true });

      // --- Map Viceroy Index Pointers (relative paths matching edge application root context) ---
      mockStoreIndex[`readme:${lang}:${kitName}`] = {
        file: `./test-data/readmes/${kitId}.md`,
        metadata: JSON.stringify({ content_type: 'text/markdown' })
      };
      mockStoreIndex[`tarball:${lang}:${kitName}`] = {
        file: `./test-data/tarballs/${tarballFilename}`,
        metadata: JSON.stringify({ content_type: 'application/gzip' })
      };
    }
  }

  // Append entry point global-manifest data payload cleanly matching index signature
  mockStoreIndex['manifest'] = JSON.stringify({
    generated_at: new Date().toISOString(),
    kits: globalKitsCatalog,
    retired: retiredCatalog
  }, null, 2);

  fs.writeFileSync(mockIndexFile, JSON.stringify(mockStoreIndex, null, 2));
  console.log(`\nMock KV Compilation complete! Store descriptor generated at: ${mockIndexFile}`);
}
