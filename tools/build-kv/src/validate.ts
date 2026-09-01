// Gate for the starter kit catalog's public identities, meant to run as a required PR check.
//
// Deliberately does none of build-kv's expensive work -- no tarballs, no KV output -- so it can
// run on every PR in seconds. Two independent rules:
//
//   1. Nothing is ambiguous: names unique per language, slugs unique globally.
//   2. Nothing silently disappears: every identity on the base ref still resolves here.
//
// Rule 2 only runs when a base ref is given (BASE_REF, or the first CLI argument). Locally,
// `node src/validate.ts origin/main` is the usual invocation.
//
// Always checks every kit rather than only the ones a PR touched: collisions are a global
// property, so a PR editing kit A can be invalidated by kit B.
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  collectKitIdentities,
  collectKitIdentitiesAtRef,
  validateCatalogIdentities,
  validateIdentityContinuity
} from './lib.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const starterKitsDir = path.join(__dirname, '../../../starter-kits');

const head = collectKitIdentities(starterKitsDir);
console.log(`Checked ${head.length} kit identities (${head.filter(k => k.retired).length} retired).`);

const errors = validateCatalogIdentities(head);

const baseRef = process.argv[2] ?? process.env.BASE_REF;
if (baseRef) {
  console.log(`Comparing against ${baseRef} for identity continuity...`);
  errors.push(...validateIdentityContinuity(collectKitIdentitiesAtRef(baseRef), head));
} else {
  console.log('No base ref given, skipping the continuity check (pass one as BASE_REF or argv[1]).');
}

if (errors.length > 0) {
  console.error(`\n${errors.length} catalog identity problem(s):\n`);
  for (const message of errors) console.error(`  - ${message}`);
  console.error('');
  process.exit(1);
}

console.log('Catalog identities OK.');
