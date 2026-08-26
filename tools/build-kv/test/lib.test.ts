import { describe, expect, it, vi, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTomlSectionRange, stripTomlSection, run } from '../src/lib.ts';

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
      slug: 'compute-starter-kit-with-catalog'
    });
    expect(noCatalog.catalog).toEqual({
      show_on_docs: true,
      show_on_cli: true,
      tags: [],
      topics: [],
      files: [],
      min_cli_version: '16.0.0'
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
