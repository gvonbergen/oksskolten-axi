import { describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import {
  AuthError,
  exitCodeForStatus,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ScopeError,
  SearchBuildingError,
} from '../src/errors.js';
import { mockFetch } from './helpers/mock-fetch.js';

const KEY = 'ok_0123456789abcdef';

function client(fetchImpl: typeof fetch, opts: Partial<{ retry: number; throttleMs: number }> = {}): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    apiKey: KEY,
    retry: opts.retry ?? 1,
    throttleMs: opts.throttleMs ?? 0,
    fetchImpl,
  });
}

describe('ApiClient request basics', () => {
  it('sends Bearer auth, Accept json, and a User-Agent without leaking the key into errors', async () => {
    const m = mockFetch([{ status: 200, body: { ok: true } }]);
    const api = client(m.fetch);
    await api.get('/api/health');
    const init = m.calls[0]!.init as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers['User-Agent']).toMatch(/^oks-cli/);
  });

  it('serializes query params and drops empty values', async () => {
    const m = mockFetch();
    const api = client(m.fetch);
    await api.get('/api/articles', { limit: 5, offset: 10, q: '', unread: undefined });
    const url = m.url(0);
    expect(url.pathname).toBe('/api/articles');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('offset')).toBe('10');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('unread')).toBe(false);
  });

  it('posts JSON bodies', async () => {
    const m = mockFetch([{ status: 200, body: { ok: true } }]);
    const api = client(m.fetch);
    await api.post('/api/articles/check-urls', { urls: ['https://x.example'] });
    const init = m.calls[0]!.init as { method?: string; body?: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body!)).toEqual({ urls: ['https://x.example'] });
  });
});

describe('error mapping', () => {
  const cases: Array<{ status: number; error: string; cls: typeof Error; code: number }> = [
    { status: 400, error: 'bad input', cls: Error, code: 2 },
    { status: 401, error: 'invalid API key', cls: AuthError, code: 3 },
    { status: 403, error: 'API key does not have write scope', cls: ScopeError, code: 4 },
    { status: 404, error: 'not found', cls: NotFoundError, code: 5 },
    { status: 429, error: 'rate limit exceeded', cls: RateLimitError, code: 6 },
  ];
  for (const c of cases) {
    it(`maps HTTP ${c.status} to exit code ${c.code}`, async () => {
      const m = mockFetch([{ status: c.status, body: { error: c.error } }]);
      const api = client(m.fetch, { retry: 0 });
      let caught: unknown;
      try {
        await api.get('/api/articles');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const err = caught as Error;
      expect((err as { exitCode: number }).exitCode).toBe(c.code);
      if (c.cls !== Error) expect(caught).toBeInstanceOf(c.cls);
      expect(err.message).not.toContain(KEY);
    });
  }

  it('maps unmapped 5xx to the network exit code', () => {
    expect(exitCodeForStatus(500)).toBe(8);
    expect(exitCodeForStatus(502)).toBe(8);
  });

  it('raises the search-building error with its own exit code', async () => {
    const m = mockFetch([{ status: 503, body: { error: 'Search index is building' } }]);
    const api = client(m.fetch, { retry: 0 });
    await expect(api.get('/api/articles/search', { q: 'x' })).rejects.toBeInstanceOf(SearchBuildingError);
  });
});

describe('retry and backoff', () => {
  it('retries a 429 honoring Retry-After and then succeeds', async () => {
    const m = mockFetch([
      { status: 429, body: { error: 'slow down' }, headers: { 'Retry-After': '0' } },
      { status: 200, body: { articles: [], has_more: false } },
    ]);
    const api = client(m.fetch, { retry: 1 });
    const res = await api.get('/api/articles', { q: undefined });
    expect(m.calls).toHaveLength(2);
    expect((res as { articles: unknown[] }).articles).toEqual([]);
  });

  it('retries a transient 503 then succeeds', async () => {
    const m = mockFetch([
      { status: 503, body: { error: 'temporary' } },
      { status: 200, body: { status: 'ok' } },
    ]);
    const api = client(m.fetch, { retry: 1 });
    const res = await api.get('/api/health');
    expect((res as { status: string }).status).toBe('ok');
  });

  it('gives up after retry budget and maps to the documented code', async () => {
    const m = mockFetch([
      { status: 429, body: { error: 'slow down' }, headers: { 'Retry-After': '0' } },
      { status: 429, body: { error: 'slow down' }, headers: { 'Retry-After': '0' } },
    ]);
    const api = client(m.fetch, { retry: 1 });
    let caught: unknown;
    try {
      await api.get('/api/feeds');
    } catch (err) {
      caught = err;
    }
    expect(m.calls).toHaveLength(2); // 1 initial + 1 retry
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as { exitCode: number }).exitCode).toBe(6);
  });

  it('wraps network failures in NetworkError (exit 8) after retries', async () => {
    const failing: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const api = client(failing, { retry: 1 });
    await expect(api.get('/api/health')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('self-throttle', () => {
  it('spaces request starts by throttleMs', async () => {
    const m = mockFetch();
    const api = client(m.fetch, { throttleMs: 60 });
    const start = Date.now();
    await api.get('/api/feeds');
    await api.get('/api/feeds');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(55);
    expect(m.calls).toHaveLength(2);
  }, 10_000);
});
