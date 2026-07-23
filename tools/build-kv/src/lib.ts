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

  if (!fs.existsSync(starterKitsDir)) {
    console.error(`Error: Ingested starter kits folder not found at ${starterKitsDir}. Run ingest script first.`);
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

      if (!fs.existsSync(tomlPath)) continue;

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
          ...(catalog.slug !== undefined ? { slug: catalog.slug } : {})
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
      // `sourceKitPath/.` (not `/*`) so dotfiles/dotdirs (.fastlyignore, .cargo/, etc.)
      // actually make it into the shipped tarball -- a bare glob silently skips them.
      const tempStagePath = path.join(tempStageDir, `.temp-tarball-stage-${kitId}`);
      fs.mkdirSync(tempStagePath, { recursive: true });
      execSync(`cp -R "${sourceKitPath}/." "${tempStagePath}/"`);

      // 1. Strip .github/ out of the distributed archive -- those workflows run CI against
      // the starter kit's own upstream repo, not against a customer's scaffolded project.
      fs.rmSync(path.join(tempStagePath, '.github'), { recursive: true, force: true });

      // 2. Strip ecosystem lockfiles entirely out of distributed user archive path
      const lockfilesToOmit = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'go.sum'];
      lockfilesToOmit.forEach(file => {
        const p = path.join(tempStagePath, file);
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      });

      // 3. Programmatically sanitize and prune the [catalog] section out of the archive's
      // fastly.toml — that metadata is only needed by services consuming the edge app
      // (edge/) and has no meaning to the customer who downloads/deploys this kit.
      const cleanToml = stripTomlSection(tomlContent, 'catalog');
      fs.writeFileSync(path.join(tempStagePath, 'fastly.toml'), cleanToml);

      // 4. Compress bundle securely, deterministically. Both `tar`'s per-file mtimes
      // (freshly set by the `cp`/`writeFileSync` steps above) and gzip's own header
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
    kits: globalKitsCatalog
  }, null, 2);

  fs.writeFileSync(mockIndexFile, JSON.stringify(mockStoreIndex, null, 2));
  console.log(`\nMock KV Compilation complete! Store descriptor generated at: ${mockIndexFile}`);
}
