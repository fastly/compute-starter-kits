import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeFileHash, computeStringHash, listAllRemoteKeys, run } from '../src/lib.ts';

describe('computeStringHash / computeFileHash', () => {
  it('computeStringHash is a deterministic sha256 of the given string', () => {
    const a = computeStringHash('hello');
    const b = computeStringHash('hello');
    const c = computeStringHash('world');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeFileHash hashes file contents, not the path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-'));
    const fileA = path.join(dir, 'a.txt');
    const fileB = path.join(dir, 'b.txt');
    fs.writeFileSync(fileA, 'same content');
    fs.writeFileSync(fileB, 'same content');
    expect(computeFileHash(fileA)).toBe(computeFileHash(fileB));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('listAllRemoteKeys', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows meta.next_cursor until it is absent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: ['a', 'b'], meta: { next_cursor: 'page2' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: ['c'], meta: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const keys = await listAllRemoteKeys('https://api.fastly.com/resources/stores/kv/store1/keys', 'token');

    expect([...keys].sort()).toEqual(['a', 'b', 'c']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = fetchMock.mock.calls[1][0] as URL;
    expect(secondCallUrl.searchParams.get('cursor')).toBe('page2');
  });

  it('throws when the API responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Server Error' })));
    await expect(listAllRemoteKeys('https://api.fastly.com/resources/stores/kv/store1/keys', 'token')).rejects.toThrow(/Failed to list KV store keys/);
  });
});

// A tiny in-memory stand-in for the real Fastly KV Store API, exercising the exact
// contract confirmed against the real API this session: metadata header is literally
// "metadata" (not "Fastly-Metadata") on both PUT and HEAD/GET, unencoded UTF-8 JSON.
function makeFakeKvStore(initial: Record<string, { body: string; metadata: string }> = {}) {
  const store = new Map(Object.entries(initial));
  const baseApiUrl = 'https://api.fastly.com/resources/stores/kv/store1/keys';

  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? new URL(input) : input;
    const method = (init.method ?? 'GET').toUpperCase();

    if (url.pathname === '/resources/stores/kv/store1/keys' && method === 'GET') {
      return new Response(JSON.stringify({ data: [...store.keys()], meta: {} }), { status: 200 });
    }

    const key = decodeURIComponent(url.pathname.split('/').pop()!);

    if (method === 'HEAD') {
      const entry = store.get(key);
      if (!entry) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { metadata: entry.metadata } });
    }

    if (method === 'PUT') {
      const headers = init.headers as Record<string, string>;
      const metadata = headers['metadata'];
      expect(headers['Fastly-Metadata']).toBeUndefined(); // regression: this is not the real header name
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as Uint8Array).toString('utf8');
      store.set(key, { body, metadata });
      return new Response(null, { status: 200 });
    }

    if (method === 'DELETE') {
      store.delete(key);
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  return { store, fetchMock, baseApiUrl };
}

describe('run()', () => {
  let tmpDir: string;
  let mockIndexFile: string;
  let edgeAppDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-kv-'));
    edgeAppDir = path.join(tmpDir, 'edge');
    fs.mkdirSync(path.join(edgeAppDir, 'test-data'), { recursive: true });
    mockIndexFile = path.join(edgeAppDir, 'test-data', 'kv_store_mock.json');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uploads a key that does not exist remotely yet, using the real "metadata" header unencoded', async () => {
    fs.writeFileSync(mockIndexFile, JSON.stringify({ manifest: '{"kits":[]}' }));
    const { store, fetchMock } = makeFakeKvStore();
    vi.stubGlobal('fetch', fetchMock);

    await run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1' });

    expect(store.get('manifest')?.body).toBe('{"kits":[]}');
    const metadata = JSON.parse(store.get('manifest')!.metadata);
    expect(metadata.sha256).toBe(computeStringHash('{"kits":[]}'));
  });

  it('skips upload on a cache hit (matching sha256 already stored remotely)', async () => {
    fs.writeFileSync(mockIndexFile, JSON.stringify({ manifest: 'unchanged' }));
    const { store, fetchMock } = makeFakeKvStore({
      manifest: { body: 'unchanged', metadata: JSON.stringify({ sha256: computeStringHash('unchanged'), content_type: 'application/json' }) }
    });
    vi.stubGlobal('fetch', fetchMock);

    await run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1' });

    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCalls).toHaveLength(0);
  });

  it('uploads a file-pointer entry using the content_type from its local metadata string', async () => {
    const assetPath = path.join(edgeAppDir, 'test-data', 'asset.png');
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, 'fake-png-bytes');
    fs.writeFileSync(mockIndexFile, JSON.stringify({
      'file:go:default:screenshot.png': { file: './test-data/asset.png', metadata: JSON.stringify({ content_type: 'image/png' }) }
    }));
    const { store, fetchMock } = makeFakeKvStore();
    vi.stubGlobal('fetch', fetchMock);

    await run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1' });

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')!;
    expect((putCall[1] as RequestInit).headers).toMatchObject({ 'Content-Type': 'image/png' });
    expect(JSON.parse(store.get('file:go:default:screenshot.png')!.metadata).content_type).toBe('image/png');
  });

  it('re-uploads when only the declared content_type changed, even if bytes are unchanged', async () => {
    fs.writeFileSync(mockIndexFile, JSON.stringify({ manifest: 'unchanged' }));
    const { store, fetchMock } = makeFakeKvStore({
      manifest: { body: 'unchanged', metadata: JSON.stringify({ sha256: computeStringHash('unchanged'), content_type: 'text/plain' }) }
    });
    vi.stubGlobal('fetch', fetchMock);

    await run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1' });

    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(JSON.parse(store.get('manifest')!.metadata).content_type).toBe('application/json');
  });

  it('re-uploads on a cache miss (remote hash differs from local content)', async () => {
    fs.writeFileSync(mockIndexFile, JSON.stringify({ manifest: 'new-content' }));
    const { store, fetchMock } = makeFakeKvStore({
      manifest: { body: 'old-content', metadata: JSON.stringify({ sha256: computeStringHash('old-content') }) }
    });
    vi.stubGlobal('fetch', fetchMock);

    await run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1' });

    expect(store.get('manifest')?.body).toBe('new-content');
  });

  it('deletes remote keys no longer present in the local build output', async () => {
    fs.writeFileSync(mockIndexFile, JSON.stringify({ manifest: 'content' }));
    const { store, fetchMock } = makeFakeKvStore({
      manifest: { body: 'content', metadata: JSON.stringify({ sha256: computeStringHash('content') }) },
      'tarball:go:removed-kit': { body: 'stale', metadata: '{}' }
    });
    vi.stubGlobal('fetch', fetchMock);

    await run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1' });

    expect(store.has('tarball:go:removed-kit')).toBe(false);
    expect(store.has('manifest')).toBe(true);
  });

  it('refuses to delete more than maxDeleteCount stale keys without force', async () => {
    const localIndex: Record<string, string> = { manifest: 'content' };
    fs.writeFileSync(mockIndexFile, JSON.stringify(localIndex));

    const remote: Record<string, { body: string; metadata: string }> = {
      manifest: { body: 'content', metadata: JSON.stringify({ sha256: computeStringHash('content') }) }
    };
    for (let i = 0; i < 5; i++) {
      remote[`tarball:go:removed-${i}`] = { body: 'stale', metadata: '{}' };
    }
    const { store, fetchMock } = makeFakeKvStore(remote);
    vi.stubGlobal('fetch', fetchMock);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    await expect(run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1', maxDeleteCount: 2 }))
      .rejects.toThrow('process.exit(1)');

    // Nothing was actually deleted -- the guard fires before any DELETE call.
    expect(store.size).toBe(6);
    exitSpy.mockRestore();
  });

  it('force bypasses the delete-count safety guard', async () => {
    const remote: Record<string, { body: string; metadata: string }> = {
      manifest: { body: 'content', metadata: JSON.stringify({ sha256: computeStringHash('content') }) }
    };
    for (let i = 0; i < 5; i++) {
      remote[`tarball:go:removed-${i}`] = { body: 'stale', metadata: '{}' };
    }
    fs.writeFileSync(mockIndexFile, JSON.stringify({ manifest: 'content' }));
    const { store, fetchMock } = makeFakeKvStore(remote);
    vi.stubGlobal('fetch', fetchMock);

    await run({ mockIndexFile, edgeAppDir, apiToken: 'token', kvStoreId: 'store1', maxDeleteCount: 2, force: true });

    expect(store.size).toBe(1);
    expect(store.has('manifest')).toBe(true);
  });
});
