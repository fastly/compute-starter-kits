import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MockKVIndex {
  // Matches the Fastly local_server KV store JSON format (see edge/fastly.toml's
  // [local_server.kv_stores]) -- `metadata` is the JSON-encoded string build-kv wrote,
  // carrying `content_type`.
  [key: string]: string | { file: string; metadata?: string };
}

export interface RunOptions {
  mockIndexFile?: string;
  edgeAppDir?: string;
  apiToken?: string;
  kvStoreId?: string;
  /** Refuse to delete more than this many stale remote keys in a single run without `force`. */
  maxDeleteCount?: number;
  /** Bypasses maxDeleteCount. Deletions are always logged either way. */
  force?: boolean;
}

const DEFAULT_MAX_DELETE_COUNT = 10;

// Computes a deterministic SHA-256 string signature for local files
export function computeFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// Inline helper to calculate string-buffer hashes (used for the global manifest JSON string)
export function computeStringHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Pages through GET /resources/stores/kv/{store_id}/keys via its cursor-based
// pagination (response shape: { data: string[], meta: { next_cursor, limit } })
// to collect every key currently present in the remote KV store.
export async function listAllRemoteKeys(baseApiUrl: string, apiToken: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;

  do {
    const url = new URL(baseApiUrl);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, {
      headers: {
        'Fastly-Key': apiToken,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list KV store keys: ${response.statusText} (${response.status})`);
    }

    const body = await response.json() as { data: string[]; meta?: { next_cursor?: string } };
    body.data.forEach(key => keys.add(key));
    cursor = body.meta?.next_cursor;
  } while (cursor);

  return keys;
}

export async function run(options: RunOptions = {}): Promise<void> {
  console.log('Initiating smart production deployment upload pass...');

  const edgeAppDir = options.edgeAppDir ?? path.join(__dirname, '../../../edge');
  const mockIndexFile = options.mockIndexFile ?? path.join(edgeAppDir, './test-data/kv_store_mock.json');
  const apiToken = options.apiToken ?? process.env.FASTLY_API_TOKEN;
  const kvStoreId = options.kvStoreId ?? process.env.FASTLY_KV_STORE_ID;
  const maxDeleteCount = options.maxDeleteCount ?? DEFAULT_MAX_DELETE_COUNT;

  if (!apiToken || !kvStoreId) {
    console.error('Error: Deployment requires FASTLY_API_TOKEN and FASTLY_KV_STORE_ID environment variables.');
    process.exit(1);
  }

  if (!fs.existsSync(mockIndexFile)) {
    console.error(`Error: Compiled workspace manifest not found at ${mockIndexFile}. Run build-kv first.`);
    process.exit(1);
  }

  const rawMockData = fs.readFileSync(mockIndexFile, 'utf8');
  const mockStoreIndex = JSON.parse(rawMockData) as MockKVIndex;

  const baseApiUrl = `https://api.fastly.com/resources/stores/kv/${kvStoreId}/keys`;

  for (const [key, value] of Object.entries(mockStoreIndex)) {
    let filePayload: Buffer | string;
    let localHash = '';
    let contentType: string;

    // Extract exact data maps and evaluate hashes based on pointer structure. Each
    // file-pointer entry declares its own content_type via its local `metadata` string (set
    // by build-kv) -- self-describing rather than guessed from the key name, since new key
    // prefixes (e.g. "file:") can carry arbitrary types (image/png, etc.) that a hardcoded
    // switch can't anticipate.
    if (typeof value === 'object' && 'file' in value) {
      // Resolve path relative to the test-data parent folder layer
      const absoluteFilePath = path.resolve(edgeAppDir, value.file);
      filePayload = fs.readFileSync(absoluteFilePath);
      localHash = computeFileHash(absoluteFilePath);
      const localMetadata = value.metadata ? JSON.parse(value.metadata) : {};
      contentType = localMetadata.content_type ?? 'application/octet-stream';
    } else {
      // Direct raw global manifest entry parsing string path hook
      filePayload = value as string;
      localHash = computeStringHash(filePayload);
      contentType = 'application/json';
    }

    const targetKeyUrl = `${baseApiUrl}/${encodeURIComponent(key)}`;
    console.log(`Checking remote sync validation state for key: [${key}]...`);

    let shouldUpload = true;

    try {
      // HEAD isn't in Fastly's published OpenAPI spec for this endpoint yet, but the KV
      // Store team confirmed directly (2026-07-09) that it's intentional -- it returns the
      // same "metadata"/"generation" headers as GET with zero body bytes, which is exactly
      // the cheap existence/metadata check we want here. Docs to follow on their end.
      const checkResponse = await fetch(targetKeyUrl, {
        method: 'HEAD',
        headers: {
          'Fastly-Key': apiToken,
          'Accept': 'application/json'
        }
      });

      if (checkResponse.status === 200) {
        // Fastly returns user metadata as a raw UTF-8 string in the "metadata" response header
        const remoteMetadataText = checkResponse.headers.get('metadata');
        if (remoteMetadataText) {
          const remoteMeta = JSON.parse(remoteMetadataText);

          // Re-upload if the content_type changed too, even if the bytes didn't -- e.g. a
          // fastly.toml edit correcting a declared content_type with no file content change.
          if (remoteMeta.sha256 === localHash && remoteMeta.content_type === contentType) {
            console.log(`> Cache Hit! File hashes match (${localHash}). Skipping upload for [${key}].`);
            shouldUpload = false;
          }
        }
      }
    } catch (err) {
      console.log(`> Key metadata check unavailable or entry does not exist yet. Proceeding with insert.`);
    }

    if (shouldUpload) {
      console.log(`> Cache Miss. Uploading fresh contents and updating metadata hash for [${key}]...`);

      const metadataPayload = JSON.stringify({ sha256: localHash, content_type: contentType, updated_at: new Date().toISOString() });

      const uploadResponse = await fetch(targetKeyUrl, {
        method: 'PUT',
        headers: {
          'Fastly-Key': apiToken,
          'metadata': metadataPayload,
          'Content-Type': contentType
        },
        body: typeof filePayload === 'string' ? filePayload : new Uint8Array(filePayload),
      });

      if (!uploadResponse.ok) {
        console.error(`Failed to upload key [${key}]: ${uploadResponse.statusText} (${uploadResponse.status})`);
        process.exit(1);
      }
      console.log(`> Successfully synchronized asset [${key}].`);
    }
  }

  console.log('\nChecking for stale keys no longer present in the local build output...');

  const remoteKeys = await listAllRemoteKeys(baseApiUrl, apiToken);
  const localKeys = new Set(Object.keys(mockStoreIndex));
  const staleKeys = [...remoteKeys].filter(key => !localKeys.has(key));

  if (staleKeys.length === 0) {
    console.log('> No stale keys found.');
  } else {
    console.log(`> Found ${staleKeys.length} stale key(s) to delete: ${staleKeys.join(', ')}`);

    if (!options.force && staleKeys.length > maxDeleteCount) {
      console.error(
        `Refusing to delete ${staleKeys.length} keys in a single run (limit is ${maxDeleteCount}). ` +
        `This is a safety guard against a bug producing an empty/incomplete local build wiping the ` +
        `remote store. Re-run with force: true (or --force on the CLI) if this is genuinely intended.`
      );
      process.exit(1);
    }

    for (const key of staleKeys) {
      console.log(`> Deleting stale key [${key}]...`);
      const deleteResponse = await fetch(`${baseApiUrl}/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { 'Fastly-Key': apiToken }
      });

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        console.error(`Failed to delete stale key [${key}]: ${deleteResponse.statusText} (${deleteResponse.status})`);
        process.exit(1);
      }
    }
  }

  console.log('\nProduction KV Store data synchronization fully complete!');
}
