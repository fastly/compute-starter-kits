// Removes build artifacts from starter kits, so a 1 GB working tree goes back to
// the few MB of actual source.
//
//   node tools/clean-kits.mts              # clean every kit
//   node tools/clean-kits.mts --dry-run    # show what would be removed, delete nothing
//   node tools/clean-kits.mts rust         # only rust kits
//   node tools/clean-kits.mts rust/auth    # only that one kit
//
// Safety: nothing is deleted unless `git check-ignore` confirms the path is
// ignored. That makes it impossible for this script to remove tracked source --
// if a kit ever legitimately commits a directory named `bin/`, it is skipped
// with a warning instead of destroyed.

import { rm, readdir, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// A `target/` full of build output can hold hundreds of thousands of files, so
// walking it in JS to total up sizes takes far longer than the delete itself.
// Shell out to `du` instead, and just omit sizes if it isn't available.
let duAvailable = true;

// Directories each toolchain drops at the root of a kit. Anything nested deeper
// (a `bin/` inside `target/`, say) disappears along with its parent.
const ARTIFACT_DIRS = [
  'target',        // cargo
  'node_modules',  // npm
  'bin',           // fastly compute build -> bin/main.wasm
  'pkg',           // fastly compute build -> pkg/*.tar.gz
  '.fastly',       // fastly CLI scratch
  'build',         // cmake (cpp kits)
];

type Candidate = { path: string; kit: string };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

async function dirSize(dir: string): Promise<number | null> {
  if (!duAvailable) return null;
  try {
    const { stdout } = await execFileAsync('du', ['-sk', dir]);
    return Number.parseInt(stdout.trim().split(/\s+/)[0], 10) * 1024;
  } catch {
    duAvailable = false;
    return null;
  }
}

// One `git check-ignore` call for every candidate, rather than one per path.
// Uses spawn (not execFile) because the paths go in over stdin, and stdin has to
// be explicitly closed -- otherwise git waits on it forever.
// Exit code 1 just means "none of these are ignored", which is not an error.
function filterToIgnored(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return Promise.resolve(new Set<string>());
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['check-ignore', '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || code === 1) resolve(new Set(out.split('\n').filter(Boolean)));
      else reject(new Error(`git check-ignore exited ${code}: ${err.trim()}`));
    });
    child.stdin.end(paths.join('\n') + '\n');
  });
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filter = args.find((a) => !a.startsWith('--'));

// Run from the repo root regardless of where the caller invoked us.
const { stdout: topLevel } = await execFileAsync('git', ['rev-parse', '--show-toplevel']);
const repoRoot = topLevel.trim();
process.chdir(repoRoot);

const kitsRoot = path.join(repoRoot, 'starter-kits');
const candidates: Candidate[] = [];

for (const lang of await readdir(kitsRoot, { withFileTypes: true })) {
  if (!lang.isDirectory()) continue;
  for (const kit of await readdir(path.join(kitsRoot, lang.name), { withFileTypes: true })) {
    if (!kit.isDirectory()) continue;
    const kitId = `${lang.name}/${kit.name}`;
    if (filter && kitId !== filter && lang.name !== filter) continue;
    for (const artifact of ARTIFACT_DIRS) {
      const abs = path.join(kitsRoot, lang.name, kit.name, artifact);
      // Never follow a symlink out of the tree.
      if (!abs.startsWith(kitsRoot + path.sep)) continue;
      try {
        if ((await stat(abs)).isDirectory()) {
          candidates.push({ path: path.relative(repoRoot, abs), kit: kitId });
        }
      } catch {
        // not present -- the normal case
      }
    }
  }
}

if (filter && candidates.length === 0) {
  const anyKit = await readdir(kitsRoot).catch(() => []);
  if (!anyKit.includes(filter.split('/')[0])) {
    console.error(`No such language or kit: ${filter}`);
    process.exit(1);
  }
}

const ignored = await filterToIgnored(candidates.map((c) => c.path));
const safe = candidates.filter((c) => ignored.has(c.path));
const unsafe = candidates.filter((c) => !ignored.has(c.path));

for (const c of unsafe) {
  console.warn(`skipped (not git-ignored, may be source): ${c.path}`);
}

if (safe.length === 0) {
  console.log('Nothing to clean.');
  process.exit(0);
}

let reclaimed = 0;
let sizesKnown = true;
for (const c of safe) {
  const size = await dirSize(c.path);
  if (size === null) sizesKnown = false;
  else reclaimed += size;
  const suffix = size === null ? '' : `  (${formatBytes(size)})`;
  console.log(`${dryRun ? 'would remove' : 'removing'}  ${c.path}${suffix}`);
  if (!dryRun) await rm(c.path, { recursive: true, force: true });
}

const count = `${safe.length} director${safe.length === 1 ? 'y' : 'ies'}`;
console.log(
  sizesKnown
    ? `\n${dryRun ? 'Would reclaim' : 'Reclaimed'} ${formatBytes(reclaimed)} across ${count}.`
    : `\n${dryRun ? 'Would clean' : 'Cleaned'} ${count}.`,
);
