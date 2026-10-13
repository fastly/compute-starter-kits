// Bumps one dependency across every starter kit that declares it.
//
//   node tools/bump-deps.mts @fastly/js-compute 4.0.1
//   node tools/bump-deps.mts @fastly/js-compute 4.0.1 --dry-run
//   node tools/bump-deps.mts @fastly/js-compute 4.0.1 javascript
//   node tools/bump-deps.mts fastly 0.14.0 rust/default
//
// Dependabot caps routine updates at minor/patch, so coordinated major bumps
// across every kit at once are driven from here instead.
//
// The lockfiles ship inside the published tarball, so they are never edited
// directly -- every bump is delegated to the real package manager, which writes
// the manifest and the lockfile together.
//
// Safety: refuses to run on a dirty working tree, so everything it touches is
// attributable to this run and revertible with a single `git checkout`. Use
// --dry-run first; it reports the same plan and changes nothing.
//
// It deliberately does not build anything. Commit the sweep to a branch, open a
// PR and add the `all-kits` label: test-starter-kits.yml then builds every kit
// through the real Fastly CLI rather than only the changed ones.
//
// `npm install` leaves a node_modules/ in each kit it touches -- run
// `node tools/clean-kits.mts` afterwards to reclaim the space.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

type Section = 'prod' | 'dev' | 'build' | 'optional';
type Declaration = { section: Section; current: string };

type Driver = {
  // Returns null when the kit does not declare the package. Nothing is bumped in
  // that case -- a bump must never silently add a dependency a kit never had.
  detect: (kitDir: string, pkg: string) => Promise<Declaration | null>;
  argv: (pkg: string, version: string, section: Section) => string[];
};

const javascript: Driver = {
  async detect(kitDir, pkg) {
    const manifest = path.join(kitDir, 'package.json');
    if (!existsSync(manifest)) return null;
    const json = JSON.parse(await readFile(manifest, 'utf8'));
    const fields: [string, Section][] = [
      ['dependencies', 'prod'],
      ['devDependencies', 'dev'],
      ['optionalDependencies', 'optional'],
    ];
    for (const [field, section] of fields) {
      const current = json[field]?.[pkg];
      if (typeof current === 'string') return { section, current };
    }
    return null;
  },
  argv(pkg, version, section) {
    // npm keeps an already-declared package in whichever section it is in, so this
    // is belt and braces rather than a fix for current behaviour. It is stated
    // explicitly because several kits carry @fastly/cli under devDependencies, and
    // a bump that silently moved one would restructure the manifest unnoticed.
    const save =
      section === 'dev' ? ['--save-dev'] : section === 'optional' ? ['--save-optional'] : [];
    return ['npm', 'install', `${pkg}@${version}`, ...save, '--no-audit', '--no-fund'];
  },
};

const go: Driver = {
  async detect(kitDir, pkg) {
    if (!existsSync(path.join(kitDir, 'go.mod'))) return null;
    const { stdout } = await execFileAsync('go', ['mod', 'edit', '-json'], { cwd: kitDir });
    const mod = JSON.parse(stdout);
    for (const req of mod.Require ?? []) {
      // Indirect requirements are resolved transitively; bumping one directly
      // would pin something the kit never asked for.
      if (req.Path === pkg && !req.Indirect) return { section: 'prod', current: req.Version };
    }
    return null;
  },
  argv(pkg, version) {
    return ['go', 'get', `${pkg}@${version.startsWith('v') ? version : `v${version}`}`];
  },
};

const rust: Driver = {
  async detect(kitDir, pkg) {
    if (!existsSync(path.join(kitDir, 'Cargo.toml'))) return null;
    const { stdout } = await execFileAsync(
      'cargo',
      ['metadata', '--no-deps', '--format-version', '1'],
      { cwd: kitDir, maxBuffer: 32 * 1024 * 1024 },
    );
    for (const p of JSON.parse(stdout).packages ?? []) {
      for (const dep of p.dependencies ?? []) {
        if (dep.name !== pkg) continue;
        const section: Section =
          dep.kind === 'dev' ? 'dev' : dep.kind === 'build' ? 'build' : 'prod';
        return { section, current: dep.req };
      }
    }
    return null;
  },
  argv(pkg, version, section) {
    const kind = section === 'dev' ? ['--dev'] : section === 'build' ? ['--build'] : [];
    return ['cargo', 'add', `${pkg}@${version}`, ...kind];
  },
};

// python has a single kit and uv is not a given on a maintainer's machine; cpp has
// no dependency manager at all. Both report as unsupported rather than being
// skipped silently, so a sweep never claims to have covered them.
const DRIVERS: Record<string, Driver> = { javascript, go, rust };

type Outcome = {
  kit: string;
  status: 'bumped' | 'failed' | 'skipped' | 'unsupported';
  from?: string;
  to?: string;
  detail?: string;
  output?: string;
};

// Package managers put the cause near the top and the boilerplate at the bottom,
// so the last line of a failure is almost always "a complete log can be found
// in ...". Pick the first line that states a cause instead.
const NOISE = /^(npm error|npm ERR!)$|a complete log of this run|^info |^warning /i;

function salientLine(output: string): string | null {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.test(l));
  return lines.find((l) => /error|fail|cannot|unable|conflict|denied/i.test(l)) ?? lines[0] ?? null;
}

function usage(message: string): never {
  console.error(message);
  console.error('\nUsage: node tools/bump-deps.mts <package> <version> [language|language/kit] [--dry-run]');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const [pkg, version, selector] = positional;

if (!pkg || !version) usage('A package name and a version are both required.');
if (positional.length > 3) usage(`Unexpected argument: ${positional[3]}`);

const { stdout: topLevel } = await execFileAsync('git', ['rev-parse', '--show-toplevel']);
const repoRoot = topLevel.trim();
process.chdir(repoRoot);

if (!dryRun) {
  const { stdout: status } = await execFileAsync('git', ['status', '--porcelain']);
  if (status.trim()) {
    console.error('The working tree has uncommitted changes.');
    console.error('Commit or stash them first, so that this sweep is the only thing in the diff.');
    process.exit(1);
  }
}

const kitsRoot = path.join(repoRoot, 'starter-kits');
const languages = (await readdir(kitsRoot, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

if (selector && !languages.includes(selector.split('/')[0])) {
  usage(`No such language or kit: ${selector}`);
}

const outcomes: Outcome[] = [];
let matched = 0;

for (const language of languages.sort()) {
  for (const entry of (await readdir(path.join(kitsRoot, language), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const kit = `${language}/${entry.name}`;
    if (selector && kit !== selector && language !== selector) continue;

    // A retired kit keeps its directory to reserve its name and slug, holding only
    // a retired.toml. Without this guard a sweep would try to bump a kit with no
    // sources left. Same test list-kits.mts uses to build the CI matrix.
    const kitDir = path.join(kitsRoot, language, entry.name);
    if (!existsSync(path.join(kitDir, 'fastly.toml'))) continue;

    matched++;
    const driver = DRIVERS[language];
    if (!driver) {
      outcomes.push({ kit, status: 'unsupported', detail: `no driver for ${language}` });
      continue;
    }

    let declared: Declaration | null;
    try {
      declared = await driver.detect(kitDir, pkg);
    } catch (err) {
      outcomes.push({ kit, status: 'failed', detail: `could not read manifest: ${(err as Error).message.trim().split('\n')[0]}` });
      continue;
    }

    if (!declared) {
      outcomes.push({ kit, status: 'skipped', detail: 'does not declare it' });
      continue;
    }

    const [command, ...rest] = driver.argv(pkg, version, declared.section);
    // Name the section unless it is an ordinary dependency: a bump that has to
    // keep something in dev/build is where this can quietly restructure a manifest.
    const where = declared.section === 'prod' ? '' : `  [${declared.section}]`;
    if (dryRun) {
      console.log(`would bump  ${kit.padEnd(32)} ${declared.current} -> ${version}${where}`);
      outcomes.push({ kit, status: 'bumped', from: declared.current, to: version });
      continue;
    }

    console.log(`bumping     ${kit.padEnd(32)} ${declared.current} -> ${version}${where}`);
    try {
      await execFileAsync(command, rest, { cwd: kitDir, maxBuffer: 32 * 1024 * 1024 });
    } catch (err) {
      const output = `${(err as any).stderr ?? ''}${(err as any).stdout ?? ''}`.trim();
      outcomes.push({
        kit,
        status: 'failed',
        from: declared.current,
        detail: salientLine(output) ?? (err as Error).message,
        output,
      });
      continue;
    }

    // Re-read rather than assuming the manager wrote what was asked for.
    const after = await driver.detect(kitDir, pkg).catch(() => null);
    outcomes.push({ kit, status: 'bumped', from: declared.current, to: after?.current ?? version });
  }
}

if (matched === 0) usage(`No kits matched: ${selector}`);

const bumped = outcomes.filter((o) => o.status === 'bumped');
const failed = outcomes.filter((o) => o.status === 'failed');
const skipped = outcomes.filter((o) => o.status === 'skipped');
const unsupported = outcomes.filter((o) => o.status === 'unsupported');

for (const o of failed) console.error(`failed      ${o.kit.padEnd(32)} ${o.detail}`);

// A fail-soft sweep is only useful if the failures can be acted on without
// running the whole thing again, so each one carries enough of its own output.
for (const o of failed) {
  const all = (o.output ?? '').split('\n').filter((l) => l.trim() && !NOISE.test(l.trim()));
  // npm prints a wall of `npm warn` around the actual `npm error` block; when the
  // error lines exist they are the whole story, so don't bury them in warnings.
  const errorsOnly = all.filter((l) => /error/i.test(l));
  const body = errorsOnly.length > 0 ? errorsOnly : all;
  if (body.length === 0) continue;
  console.error(`\n--- ${o.kit} ---`);
  for (const line of body.slice(0, 12)) console.error(`    ${line}`);
  if (body.length > 12) console.error(`    ... ${body.length - 12} more lines`);
}

if (selector && unsupported.length > 0) {
  for (const o of unsupported) console.error(`unsupported ${o.kit.padEnd(32)} ${o.detail}`);
}

console.log(
  `\n${dryRun ? 'Would bump' : 'Bumped'} ${pkg} to ${version} in ${bumped.length} kit${bumped.length === 1 ? '' : 's'}` +
    `, skipped ${skipped.length}` +
    (unsupported.length ? `, ${unsupported.length} unsupported` : '') +
    (failed.length ? `, ${failed.length} FAILED` : '') +
    '.',
);

if (!dryRun && bumped.length > 0) {
  console.log('Review with `git diff --stat`, then commit on a branch and label the PR `all-kits`.');
}

if (failed.length > 0) process.exit(1);
