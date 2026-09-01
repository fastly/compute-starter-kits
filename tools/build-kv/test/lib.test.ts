import { describe, expect, it, vi, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findTomlSectionRange,
  stripTomlSection,
  run,
  derivedSlug,
  collectKitIdentities,
  validateCatalogIdentities,
  validateIdentityContinuity,
  type KitIdentity
} from '../src/lib.ts';

describe('findTomlSectionRange / stripTomlSection', () => {
  it('strips a single-line section', () => {
    const toml = ['name = "x"', '[catalog]', 'tags = ["a"]', '[scripts]', 'build = "y"'].join('\n');
    expect(stripTomlSection(toml, 'catalog')).toBe(['name = "x"', '[scripts]', 'build = "y"'].join('\n'));
  });

  it('strips a multi-line array section without disturbing later sections', () => {
    const toml = [
      'name = "x"',
      '[catalog]',
      'tags = [',
      '  "a", # primary',
      '  "b"',
      ']',
      'min_cli_version = "10.5.0"',
      '[scripts]',
      'build = "y"'
    ].join('\n');
    expect(stripTomlSection(toml, 'catalog')).toBe(['name = "x"', '[scripts]', 'build = "y"'].join('\n'));
  });

  it('returns the content unchanged when the section is absent', () => {
    const toml = ['name = "x"', '[scripts]', 'build = "y"'].join('\n');
    expect(stripTomlSection(toml, 'catalog')).toBe(toml);
  });

  it('returns null from findTomlSectionRange when the section is absent', () => {
    expect(findTomlSectionRange(['name = "x"'], 'catalog')).toBeNull();
  });

  it('treats a section at the end of the file as extending to EOF', () => {
    const toml = ['name = "x"', '[catalog]', 'tags = ["a"]'].join('\n');
    expect(stripTomlSection(toml, 'catalog')).toBe('name = "x"');
  });
});

describe('catalog identities', () => {
  function identity(partial: Partial<KitIdentity> & { language: string; name: string }): KitIdentity {
    return {
      slug: derivedSlug(partial.language, partial.name),
      altNames: [],
      altSlugs: [],
      retired: false,
      source: `${partial.language}/${partial.name}/fastly.toml`,
      ...partial
    };
  }

  it('constructs the docs slug by inverting the original repo-name layout', () => {
    expect(derivedSlug('javascript', 'default')).toBe('compute-starter-kit-javascript-default');
    expect(derivedSlug('rust', 'auth')).toBe('compute-starter-kit-rust-auth');
    expect(derivedSlug('python', 'default')).toBe('compute-starter-kit-python-default');
    // TypeScript kits sit under javascript/ but keep `typescript-` in the directory name, so the
    // language segment is already there and must not be doubled up. These four kits declare the
    // same value explicitly today, so the construction has to agree with them exactly.
    expect(derivedSlug('javascript', 'typescript-hono')).toBe('compute-starter-kit-typescript-hono');
    expect(derivedSlug('javascript', 'typescript-kv-store')).toBe('compute-starter-kit-typescript-kv-store');
    // The prefix is only special under javascript/, matching the layout rule it inverts.
    expect(derivedSlug('rust', 'typescript-ish')).toBe('compute-starter-kit-rust-typescript-ish');
  });

  it('accepts the same kit name in different languages', () => {
    // javascript/auth and rust/auth both exist today: the name axis is the `:name` in
    // /kits/:lang/:name, so it is only required to be unique within a language.
    expect(validateCatalogIdentities([
      identity({ language: 'javascript', name: 'auth', slug: 'compute-js-auth' }),
      identity({ language: 'rust', name: 'auth', slug: 'compute-rust-auth' })
    ])).toEqual([]);
  });

  it('rejects an alt_name colliding with another kit name in the same language', () => {
    const errors = validateCatalogIdentities([
      identity({ language: 'javascript', name: 'queue' }),
      identity({ language: 'javascript', name: 'rate-limit', altNames: ['queue'] })
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate kit name "queue" in language "javascript"');
  });

  it('rejects two kits claiming the same alt_name in one language', () => {
    const errors = validateCatalogIdentities([
      identity({ language: 'go', name: 'a', altNames: ['shared'] }),
      identity({ language: 'go', name: 'b', altNames: ['shared'] })
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate kit name "shared"');
  });

  it('rejects slug collisions across different languages, since docs URLs are one namespace', () => {
    const errors = validateCatalogIdentities([
      identity({ language: 'javascript', name: 'a', slug: 'compute-shared' }),
      identity({ language: 'rust', name: 'b', altSlugs: ['compute-shared'] })
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate slug "compute-shared"');
  });

  it('catches a declared slug shadowing another kit\'s constructed docs URL', () => {
    // The subtle one: 32 of 38 kits declare no slug, so their URL is constructed. A newly
    // declared alt_slug that happens to equal one of those must not silently win.
    const errors = validateCatalogIdentities([
      identity({ language: 'javascript', name: 'default' }),
      identity({ language: 'rust', name: 'other', altSlugs: [derivedSlug('javascript', 'default')] })
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('compute-starter-kit-javascript-default');
  });

  it('keeps retired identities reserved, so a new kit cannot reclaim a retired URL', () => {
    const errors = validateCatalogIdentities([
      identity({ language: 'javascript', name: 'gone', retired: true, slug: 'compute-old-kit', source: 'javascript/gone/retired.toml' }),
      identity({ language: 'javascript', name: 'shiny', altSlugs: ['compute-old-kit'] })
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate slug "compute-old-kit"');
  });

  describe('continuity against a base revision', () => {
    const base = [identity({ language: 'javascript', name: 'queue', slug: 'compute-queue' })];

    it('flags a rename that leaves no alias behind', () => {
      const errors = validateIdentityContinuity(base, [
        identity({ language: 'javascript', name: 'rate-limit', slug: 'compute-rate-limit' })
      ]);
      expect(errors).toHaveLength(2);
      expect(errors.join('\n')).toContain('"javascript/queue" no longer resolves');
      expect(errors.join('\n')).toContain('"compute-queue" no longer resolves');
    });

    it('accepts a rename that carries both aliases', () => {
      expect(validateIdentityContinuity(base, [
        identity({
          language: 'javascript',
          name: 'rate-limit',
          slug: 'compute-rate-limit',
          altNames: ['queue'],
          altSlugs: ['compute-queue']
        })
      ])).toEqual([]);
    });

    it('accepts a retirement that leaves a tombstone carrying the identity', () => {
      expect(validateIdentityContinuity(base, [
        identity({
          language: 'javascript',
          name: 'queue',
          slug: 'compute-queue',
          retired: true,
          source: 'javascript/queue/retired.toml'
        })
      ])).toEqual([]);
    });

    it('flags a retirement that drops the aliases the kit had accumulated', () => {
      const withAlias = [identity({ language: 'javascript', name: 'queue', slug: 'compute-queue', altSlugs: ['compute-ancient-name'] })];
      const errors = validateIdentityContinuity(withAlias, [
        identity({ language: 'javascript', name: 'queue', slug: 'compute-queue', retired: true })
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('compute-ancient-name');
    });
  });
});

describe('run()', () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeKit(starterKitsDir: string, lang: string, kitName: string, fastlyToml: string, files: Record<string, string> = {}) {
    const kitDir = path.join(starterKitsDir, lang, kitName);
    fs.mkdirSync(kitDir, { recursive: true });
    fs.writeFileSync(path.join(kitDir, 'fastly.toml'), fastlyToml);
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(kitDir, name), content);
    }
  }

  // Staging copies what git tracks, so the fixtures have to be a real git work tree with a
  // populated index for these tests to exercise the same path the repo does. No commit is
  // needed -- `git ls-files` reads the index, not HEAD.
  function trackAll(starterKitsDir: string) {
    execSync('git init -q', { cwd: starterKitsDir });
    execSync('git add -A', { cwd: starterKitsDir });
  }

  it('builds a manifest + readme + tarball per kit, applying [catalog] defaults and overrides', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'go', 'with-catalog', [
      'name = "With Catalog"',
      'description = "desc"',
      '[catalog]',
      'show_on_cli = false',
      'tags = [',
      '  "caching",',
      '  "advanced"',
      ']',
      'topics = ["real-time"]',
      'min_cli_version = "11.0.0"',
      'slug = "compute-starter-kit-with-catalog"',
      '[scripts]',
      'build = "go build -o bin/main.wasm ."'
    ].join('\n'), {
      // Every ecosystem's lockfile ships with the kit, so a customer's first build
      // resolves the same dependency versions this repo tests against. Listed together
      // here (rather than one per language kit) to keep the expectation honest.
      'go.sum': 'should-ship',
      'package-lock.json': 'should-ship',
      'yarn.lock': 'should-ship',
      'pnpm-lock.yaml': 'should-ship',
      'Cargo.lock': 'should-ship',
      'uv.lock': 'should-ship',
      'README.md': '# With Catalog\n',
      '.fastlyignore': '/bin\n/pkg\n'
    });
    // .github/ runs CI against the kit's own upstream repo, not the customer's
    // scaffolded project -- it must not ship in the tarball.
    const withCatalogGithubDir = path.join(starterKitsDir, 'go', 'with-catalog', '.github', 'workflows');
    fs.mkdirSync(withCatalogGithubDir, { recursive: true });
    fs.writeFileSync(path.join(withCatalogGithubDir, 'ci.yml'), 'on: push\n');

    writeKit(starterKitsDir, 'go', 'no-catalog', [
      'name = "No Catalog"',
      'description = "desc2"',
      '[scripts]',
      'build = "go build -o bin/main.wasm ."'
    ].join('\n'));

    trackAll(starterKitsDir);
    run({ starterKitsDir, edgeAppDir, tempStageDir });

    const mockIndexFile = path.join(edgeAppDir, 'test-data', 'kv_store_mock.json');
    const mockIndex = JSON.parse(fs.readFileSync(mockIndexFile, 'utf8'));

    expect(Object.keys(mockIndex).sort()).toEqual([
      'manifest',
      'readme:go:no-catalog',
      'readme:go:with-catalog',
      'tarball:go:no-catalog',
      'tarball:go:with-catalog'
    ]);

    const manifest = JSON.parse(mockIndex.manifest);
    const withCatalog = manifest.kits.find((k: any) => k.id === 'go-with-catalog');
    const noCatalog = manifest.kits.find((k: any) => k.id === 'go-no-catalog');

    expect(withCatalog.catalog).toEqual({
      show_on_docs: true,
      show_on_cli: false,
      tags: ['caching', 'advanced'],
      topics: ['real-time'],
      files: [],
      min_cli_version: '11.0.0',
      slug: 'compute-starter-kit-with-catalog',
      alt_names: [],
      alt_slugs: []
    });
    expect(noCatalog.catalog).toEqual({
      show_on_docs: true,
      show_on_cli: true,
      tags: [],
      topics: [],
      files: [],
      min_cli_version: '16.0.0',
      alt_names: [],
      alt_slugs: []
    });

    // README copied verbatim when present
    const readmePath = path.join(edgeAppDir, mockIndex['readme:go:with-catalog'].file);
    expect(fs.readFileSync(readmePath, 'utf8')).toBe('# With Catalog\n');

    // README synthesized from name/description when absent
    const noCatalogReadmePath = path.join(edgeAppDir, mockIndex['readme:go:no-catalog'].file);
    expect(fs.readFileSync(noCatalogReadmePath, 'utf8')).toBe('# No Catalog\n\ndesc2');

    // Tarball: [catalog] stripped, everything else intact -- lockfiles included
    const tarballPath = path.join(edgeAppDir, mockIndex['tarball:go:with-catalog'].file);
    const listing = execSync(`tar -tzf "${tarballPath}"`, { encoding: 'utf8' });
    for (const lockfile of ['go.sum', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'uv.lock']) {
      expect(listing).toContain(lockfile);
    }

    const shippedToml = execSync(`tar -xzOf "${tarballPath}" ./fastly.toml`, { encoding: 'utf8' });
    expect(shippedToml).not.toContain('[catalog]');
    expect(shippedToml).toContain('name = "With Catalog"');

    // Tracked dotfiles (.fastlyignore, .cargo/, etc.) must survive into the shipped
    // tarball -- a plain `cp -R dir/*` glob silently drops them, which is exactly the bug
    // that dropped every kit's .fastlyignore (and Rust kits' .cargo/config.toml) in practice.
    expect(listing).toContain('./.fastlyignore');
    const shippedFastlyignore = execSync(`tar -xzOf "${tarballPath}" ./.fastlyignore`, { encoding: 'utf8' });
    expect(shippedFastlyignore).toBe('/bin\n/pkg\n');

    // .github/ is deliberately excluded, unlike other dotfiles/dotdirs.
    expect(listing).not.toContain('.github');
  });

  it('produces byte-identical tarballs across repeated runs with unchanged source content', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'rust', 'default', [
      'name = "Rust Default"',
      'description = "desc"',
      '[scripts]',
      'build = "cargo build --profile release"'
    ].join('\n'), { 'main.rs': 'fn main() {}' });

    trackAll(starterKitsDir);
    run({ starterKitsDir, edgeAppDir, tempStageDir });
    const mockIndexFile = path.join(edgeAppDir, 'test-data', 'kv_store_mock.json');
    const tarballRelPath = JSON.parse(fs.readFileSync(mockIndexFile, 'utf8'))['tarball:rust:default'].file;
    const tarballPath = path.join(edgeAppDir, tarballRelPath);
    const firstHash = execSync(`shasum -a 256 "${tarballPath}"`, { encoding: 'utf8' }).split(' ')[0];

    // Re-run against the exact same source content; nothing changed on disk.
    run({ starterKitsDir, edgeAppDir, tempStageDir });
    const secondHash = execSync(`shasum -a 256 "${tarballPath}"`, { encoding: 'utf8' }).split(' ')[0];

    expect(secondHash).toBe(firstHash);
  });

  it('copies [[catalog.files]] assets to their own KV-bound location and into the manifest', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'javascript', 'queue', [
      'name = "Queue"',
      'description = "desc"',
      '[catalog]',
      '[[catalog.files]]',
      'filename = "screenshot.png"',
      'content_type = "image/png"',
      '[scripts]',
      'build = "npm run build"'
    ].join('\n'), {
      'screenshot.png': 'fake-png-bytes'
    });

    trackAll(starterKitsDir);
    run({ starterKitsDir, edgeAppDir, tempStageDir });

    const mockIndexFile = path.join(edgeAppDir, 'test-data', 'kv_store_mock.json');
    const mockIndex = JSON.parse(fs.readFileSync(mockIndexFile, 'utf8'));

    expect(mockIndex['file:javascript:queue:screenshot.png']).toBeDefined();
    const fileEntry = mockIndex['file:javascript:queue:screenshot.png'];
    const copiedFilePath = path.join(edgeAppDir, fileEntry.file);
    expect(fs.readFileSync(copiedFilePath, 'utf8')).toBe('fake-png-bytes');
    expect(JSON.parse(fileEntry.metadata)).toEqual({ content_type: 'image/png' });

    const manifest = JSON.parse(mockIndex.manifest);
    const kit = manifest.kits.find((k: any) => k.id === 'javascript-queue');
    expect(kit.catalog.files).toEqual([{ filename: 'screenshot.png', content_type: 'image/png' }]);
  });

  it('keeps untracked working-tree files out of the shipped tarball', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'javascript', 'oauth', [
      'name = "OAuth"',
      'description = "desc"',
      '[scripts]',
      'build = "npm run build"'
    ].join('\n'), { 'index.js': 'export default 1;\n' });

    // Track the real sources only, then dirty the working tree the way a maintainer's
    // checkout gets dirtied by local development.
    trackAll(starterKitsDir);

    const kitDir = path.join(starterKitsDir, 'javascript', 'oauth');
    fs.mkdirSync(path.join(kitDir, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(kitDir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;');
    fs.mkdirSync(path.join(kitDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(kitDir, 'bin', 'main.wasm'), 'compiled-artifact');
    // The sharp case: the OAuth kits read local dev secrets out of `.secret.*` files, and
    // this tarball is served publicly from /kits/:lang/:name/tarball.
    fs.writeFileSync(path.join(kitDir, '.secret.client_secret'), 'REAL-IDP-CLIENT-SECRET');

    run({ starterKitsDir, edgeAppDir, tempStageDir });

    const mockIndex = JSON.parse(fs.readFileSync(path.join(edgeAppDir, 'test-data', 'kv_store_mock.json'), 'utf8'));
    const tarballPath = path.join(edgeAppDir, mockIndex['tarball:javascript:oauth'].file);
    const listing = execSync(`tar -tzf "${tarballPath}"`, { encoding: 'utf8' });

    expect(listing).toContain('./index.js');
    expect(listing).toContain('./fastly.toml');
    expect(listing).not.toContain('node_modules');
    expect(listing).not.toContain('main.wasm');
    expect(listing).not.toContain('.secret');
  });

  it('warns about untracked files it omitted, so a forgotten `git add` is not silent', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'javascript', 'default', [
      'name = "Default"',
      'description = "desc"',
      '[scripts]',
      'build = "npm run build"'
    ].join('\n'), { 'index.js': 'export default 1;\n' });

    trackAll(starterKitsDir);

    const kitDir = path.join(starterKitsDir, 'javascript', 'default');
    // A real source file the author forgot to add -- this used to ship under `cp -R`.
    fs.writeFileSync(path.join(kitDir, 'helper.js'), 'export const help = 1;\n');
    // ...whereas ignored build output must NOT produce warning noise.
    fs.writeFileSync(path.join(kitDir, '.gitignore'), 'ignored-output.txt\n');
    fs.writeFileSync(path.join(kitDir, 'ignored-output.txt'), 'junk');
    execSync('git add .gitignore', { cwd: kitDir });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    run({ starterKitsDir, edgeAppDir, tempStageDir });
    const warnings = warnSpy.mock.calls.map(args => String(args[0])).join('\n');
    warnSpy.mockRestore();

    expect(warnings).toContain('helper.js');
    expect(warnings).toContain('not tracked by git');
    expect(warnings).not.toContain('ignored-output.txt');

    const mockIndex = JSON.parse(fs.readFileSync(path.join(edgeAppDir, 'test-data', 'kv_store_mock.json'), 'utf8'));
    const tarballPath = path.join(edgeAppDir, mockIndex['tarball:javascript:default'].file);
    const listing = execSync(`tar -tzf "${tarballPath}"`, { encoding: 'utf8' });
    expect(listing).not.toContain('helper.js');
    expect(listing).not.toContain('ignored-output.txt');
  });

  it('falls back to copying everything, with a warning, when the kit is not in a git work tree', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    // Deliberately no trackAll() -- nothing is tracked, so staging cannot use git's index.
    writeKit(starterKitsDir, 'go', 'default', [
      'name = "Go Default"',
      'description = "desc"',
      '[scripts]',
      'build = "go build -o bin/main.wasm ."'
    ].join('\n'), { 'main.go': 'package main\n' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    run({ starterKitsDir, edgeAppDir, tempStageDir });
    const warnings = warnSpy.mock.calls.map(args => String(args[0])).join('\n');
    warnSpy.mockRestore();

    expect(warnings).toContain('no git-tracked files');

    const mockIndex = JSON.parse(fs.readFileSync(path.join(edgeAppDir, 'test-data', 'kv_store_mock.json'), 'utf8'));
    const tarballPath = path.join(edgeAppDir, mockIndex['tarball:go:default'].file);
    const listing = execSync(`tar -tzf "${tarballPath}"`, { encoding: 'utf8' });

    // Degraded but not broken: the kit still ships, rather than shipping an empty tarball.
    expect(listing).toContain('./main.go');
    expect(listing).toContain('./fastly.toml');
  });

  it('reads live and retired identities off disk, defaulting the slug when undeclared', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');

    writeKit(starterKitsDir, 'javascript', 'declared', [
      'name = "Declared"',
      '[catalog]',
      'slug = "compute-js-auth"',
      'alt_names = ["old-name"]',
      'alt_slugs = ["compute-older-slug"]'
    ].join('\n'));
    writeKit(starterKitsDir, 'javascript', 'undeclared', 'name = "Undeclared"');

    // A retired kit: directory present, no fastly.toml, only retired.toml.
    const retiredDir = path.join(starterKitsDir, 'go', 'gone');
    fs.mkdirSync(retiredDir, { recursive: true });
    fs.writeFileSync(path.join(retiredDir, 'retired.toml'), '[catalog]\nslug = "compute-gone"\n');

    // A directory with neither file is not a kit at all and must be ignored.
    fs.mkdirSync(path.join(starterKitsDir, 'go', 'not-a-kit'), { recursive: true });

    const identities = collectKitIdentities(starterKitsDir);
    const byName = Object.fromEntries(identities.map(i => [`${i.language}/${i.name}`, i]));

    expect(Object.keys(byName).sort()).toEqual(['go/gone', 'javascript/declared', 'javascript/undeclared']);
    expect(byName['javascript/declared'].slug).toBe('compute-js-auth');
    expect(byName['javascript/declared'].altNames).toEqual(['old-name']);
    expect(byName['javascript/declared'].altSlugs).toEqual(['compute-older-slug']);
    // No declared slug -> the constructed docs URL, which still occupies the global namespace.
    expect(byName['javascript/undeclared'].slug).toBe('compute-starter-kit-javascript-undeclared');
    expect(byName['go/gone'].retired).toBe(true);
    expect(byName['javascript/declared'].retired).toBe(false);
  });

  it('records a retired kit in its own manifest array, with no readme or tarball keys', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'javascript', 'live', [
      'name = "Live"',
      'description = "desc"',
      '[scripts]',
      'build = "npm run build"'
    ].join('\n'), { 'index.js': 'export default 1;\n' });

    const retiredDir = path.join(starterKitsDir, 'javascript', 'gone');
    fs.mkdirSync(retiredDir, { recursive: true });
    fs.writeFileSync(path.join(retiredDir, 'retired.toml'), [
      '[catalog]',
      'slug = "compute-gone"',
      'alt_slugs = ["compute-even-older"]',
      'replaced_by = "compute-starter-kit-javascript-live"',
      'retired_on = "2026-08-26"'
    ].join('\n'));

    trackAll(starterKitsDir);
    run({ starterKitsDir, edgeAppDir, tempStageDir });

    const mockIndex = JSON.parse(fs.readFileSync(path.join(edgeAppDir, 'test-data', 'kv_store_mock.json'), 'utf8'));

    // No sources, so nothing to serve -- the edge app answers from the manifest instead.
    expect(Object.keys(mockIndex).filter(k => k.includes('gone'))).toEqual([]);

    const manifest = JSON.parse(mockIndex.manifest);
    expect(manifest.kits.map((k: any) => k.id)).toEqual(['javascript-live']);
    expect(manifest.retired).toEqual([{
      id: 'javascript-gone',
      path: 'starter-kits/javascript/gone',
      language: 'javascript',
      catalog: {
        slug: 'compute-gone',
        alt_names: [],
        alt_slugs: ['compute-even-older'],
        replaced_by: 'compute-starter-kit-javascript-live',
        retired_on: '2026-08-26'
      }
    }]);
  });

  it('refuses to build a catalog with ambiguous identities', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'javascript', 'a', ['name = "A"', '[catalog]', 'slug = "compute-clash"'].join('\n'));
    writeKit(starterKitsDir, 'rust', 'b', ['name = "B"', '[catalog]', 'slug = "compute-clash"'].join('\n'));
    trackAll(starterKitsDir);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    expect(() => run({ starterKitsDir, edgeAppDir, tempStageDir })).toThrow('process.exit(1)');
    expect(errSpy.mock.calls.map(a => String(a[0])).join('\n')).toContain('compute-clash');

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('fails loudly when a declared [[catalog.files]] asset does not exist on disk', () => {
    const starterKitsDir = makeTmpDir('starter-kits-');
    const edgeAppDir = makeTmpDir('edge-');
    const tempStageDir = makeTmpDir('stage-');

    writeKit(starterKitsDir, 'javascript', 'queue', [
      'name = "Queue"',
      'description = "desc"',
      '[catalog]',
      '[[catalog.files]]',
      'filename = "missing.png"',
      'content_type = "image/png"',
      '[scripts]',
      'build = "npm run build"'
    ].join('\n'));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    expect(() => run({ starterKitsDir, edgeAppDir, tempStageDir })).toThrow('process.exit(1)');

    exitSpy.mockRestore();
  });
});
