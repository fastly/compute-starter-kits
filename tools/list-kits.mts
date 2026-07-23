import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';

type Kit = {
  language: string,
  kit: string,
  skip_smoke_test: boolean
};

function getChangedKits(): Kit[] {
  const files = JSON.parse(process.env.CHANGED_FILES || "[]");
  const seen = new Map();
  for (const f of files) {
    const m = f.match(/^starter-kits\/([^/]+)\/([^/]+)\//);
    const kitpath = m[1] + "/" + m[2];
    if (m && existsSync(kitpath + '/fastly.toml') && !seen.has()) {
      seen.set(kitpath, {
        language: m[1],
        kit: m[2],
        // Fanout needs Pushpin, which is experimental and not bundled with the
        // CLI -- exempt these from the smoke-test step. Auth (js + rust) needs a
        // secret store configured, which CI does not set up yet -- exempt for now too.
        skip_smoke_test: m[2] === "fanout" || m[2] === "fanout-forward" || m[2] === "auth"
      });
    }
  }
  return seen.values();
}

async function getAllKits(): Kit[] {
  const kits = [];

  for await (const entry of glob('starter-kits/*/*')) {
    const m = entry.match(/^starter-kits\/([^/]+)\/([^/]+)/);
    if (m) {
      kits.push({
	language: m[1],
	kit: m[2],
        // Fanout needs Pushpin, which is experimental and not bundled with the
        // CLI -- exempt these from the smoke-test step. Auth (js + rust) needs a
        // secret store configured, which CI does not set up yet -- exempt for now too.
        skip_smoke_test: m[2] === "fanout" || m[2] === "fanout-forward" || m[2] === "auth"
      });
    }
  }

  return kits;
}

let kits = null;
if (Boolean(process.env.ALL_KITS)) {
  kits = await getAllKits();
} else {
  kits = getChangedKits();
}
console.log("kits=" + JSON.stringify(kits));
console.log("has_kits=" + (kits.length > 0 ? "true" : "false"));
