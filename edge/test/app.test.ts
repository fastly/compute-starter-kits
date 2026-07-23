import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

// Minimal stand-in for @fastly/js-compute's KVStoreEntry, just enough of the
// surface area this app actually uses: body (ReadableStream), text(), json(), metadata().
function fakeEntry(content: string, metadata: Record<string, unknown> | null = null): any {
  return {
    get body() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        }
      });
    },
    bodyUsed: false,
    text: async () => content,
    json: async () => JSON.parse(content),
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
    metadata: () => (metadata ? new TextEncoder().encode(JSON.stringify(metadata)).buffer : null)
  };
}

type FakeKvValue = string | { content: string; metadata?: Record<string, unknown> };

function fakeKvStore(entries: Record<string, FakeKvValue>) {
  return {
    get: async (key: string) => {
      if (!(key in entries)) return null;
      const value = entries[key];
      return typeof value === 'string' ? fakeEntry(value) : fakeEntry(value.content, value.metadata);
    }
  };
}

const SAMPLE_MANIFEST = JSON.stringify({
  generated_at: '2026-07-09T00:00:00.000Z',
  kits: [
    { id: 'go-default', name: 'Go Default', path: 'starter-kits/go/default', language: 'go', description: '', catalog: { show_on_docs: true, show_on_cli: true, tags: [], topics: [], files: [{ filename: 'screenshot.png', content_type: 'image/png' }], min_cli_version: '16.0.0' } },
    { id: 'go-hidden', name: 'Go Hidden', path: 'starter-kits/go/hidden', language: 'go', description: '', catalog: { show_on_docs: false, show_on_cli: false, tags: [], topics: [], files: [], min_cli_version: '16.0.0' } },
    { id: 'rust-default', name: 'Rust Default', path: 'starter-kits/rust/default', language: 'rust', description: '', catalog: { show_on_docs: true, show_on_cli: true, tags: [], topics: [], files: [], min_cli_version: '16.0.0' } }
  ]
});

describe('GET /kits', () => {
  it('returns the full manifest with no filters', async () => {
    const res = await app.request('/kits', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.generated_at).toBe('2026-07-09T00:00:00.000Z');
    expect(body.kits).toHaveLength(3);
  });

  it('filters by lang case-insensitively', async () => {
    const res = await app.request('/kits?lang=GO', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    const body = await res.json() as any;
    expect(body.kits.map((k: any) => k.id).sort()).toEqual(['go-default', 'go-hidden']);
  });

  it('filters by cli=true', async () => {
    const res = await app.request('/kits?cli=true', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    const body = await res.json() as any;
    expect(body.kits.map((k: any) => k.id).sort()).toEqual(['go-default', 'rust-default']);
  });

  it('filters by docs=true', async () => {
    const res = await app.request('/kits?docs=true', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    const body = await res.json() as any;
    expect(body.kits.map((k: any) => k.id).sort()).toEqual(['go-default', 'rust-default']);
  });

  it('combines lang and cli filters', async () => {
    const res = await app.request('/kits?lang=go&cli=true', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    const body = await res.json() as any;
    expect(body.kits.map((k: any) => k.id)).toEqual(['go-default']);
  });

  it('returns 500 when the manifest key is missing', async () => {
    const res = await app.request('/kits', {}, { kitsStorage: fakeKvStore({}) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Global manifest catalog not found' });
  });
});

describe('GET /kits/:lang/:name', () => {
  it('returns a single kit\'s manifest entry', async () => {
    const res = await app.request('/kits/go/default', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 'go-default', name: 'Go Default', path: 'starter-kits/go/default', language: 'go', description: '',
      catalog: { show_on_docs: true, show_on_cli: true, tags: [], topics: [], files: [{ filename: 'screenshot.png', content_type: 'image/png' }], min_cli_version: '16.0.0' }
    });
  });

  it('404s when the kit does not exist', async () => {
    const res = await app.request('/kits/go/missing', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the manifest key is missing', async () => {
    const res = await app.request('/kits/go/default', {}, { kitsStorage: fakeKvStore({}) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Global manifest catalog not found' });
  });
});

describe('GET /kits/:lang/:name/file', () => {
  it('lists the declared catalog.files for a kit', async () => {
    const res = await app.request('/kits/go/default/file', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [{ filename: 'screenshot.png', content_type: 'image/png' }] });
  });

  it('returns an empty list for a kit with no declared files', async () => {
    const res = await app.request('/kits/go/hidden/file', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [] });
  });

  it('404s when the kit itself does not exist', async () => {
    const res = await app.request('/kits/go/missing/file', {}, { kitsStorage: fakeKvStore({ manifest: SAMPLE_MANIFEST }) });
    expect(res.status).toBe(404);
  });
});

describe('GET /kits/:lang/:name/file/:filename', () => {
  it('streams a file with the content type carried in its own KV metadata', async () => {
    const res = await app.request('/kits/go/default/file/screenshot.png', {}, {
      kitsStorage: fakeKvStore({
        'file:go:default:screenshot.png': { content: 'fake-png-bytes', metadata: { content_type: 'image/png' } }
      })
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('fake-png-bytes');
  });

  it('falls back to application/octet-stream when the entry has no metadata', async () => {
    const res = await app.request('/kits/go/default/file/screenshot.png', {}, {
      kitsStorage: fakeKvStore({ 'file:go:default:screenshot.png': 'fake-png-bytes' })
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('404s when the file is not present in the KV store', async () => {
    const res = await app.request('/kits/go/default/file/screenshot.png', {}, { kitsStorage: fakeKvStore({}) });
    expect(res.status).toBe(404);
  });
});

describe('GET /kits/:lang/:name/readme', () => {
  it('streams the readme with a markdown content type', async () => {
    const res = await app.request('/kits/go/default/readme', {}, {
      kitsStorage: fakeKvStore({ 'readme:go:default': '# Hello' })
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await res.text()).toBe('# Hello');
  });

  it('404s when the readme key does not exist', async () => {
    const res = await app.request('/kits/go/missing/readme', {}, { kitsStorage: fakeKvStore({}) });
    expect(res.status).toBe(404);
  });
});

describe('GET /kits/:lang/:name/tarball', () => {
  it('streams the tarball with download headers', async () => {
    const res = await app.request('/kits/go/default/tarball', {}, {
      kitsStorage: fakeKvStore({ 'tarball:go:default': 'fake-gzip-bytes' })
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="go-default.tar.gz"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await res.text()).toBe('fake-gzip-bytes');
  });

  it('404s when the tarball key does not exist', async () => {
    const res = await app.request('/kits/go/missing/tarball', {}, { kitsStorage: fakeKvStore({}) });
    expect(res.status).toBe(404);
  });
});
