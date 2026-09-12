import { describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import {
  CHECK_MAX_URLS,
  cmdCheck,
  cmdGet,
  cmdList,
  cmdSearch,
  cmdSimilar,
  clampLimit,
  safeUrl,
} from '../src/commands.js';
import { ValidationError } from '../src/errors.js';
import type { Article } from '../src/types.js';
import { mockFetch } from './helpers/mock-fetch.js';

const KEY = 'ok_0123456789abcdef';
function api(fetchImpl: typeof fetch): ApiClient {
  return new ApiClient({ baseUrl: 'https://api.test', apiKey: KEY, retry: 0, throttleMs: 0, fetchImpl });
}

describe('validation', () => {
  it('rejects invalid URLs for get/check with exit code 2', () => {
    for (const bad of ['not-a-url', 'ftp://x.example', 'javascript:alert(1)']) {
      expect(() => safeUrl(bad)).toThrow(ValidationError);
      expect(() => safeUrl(bad)).toThrow(/http/);
    }
    expect(safeUrl('https://blog.example.org/post')).toMatch(/\/post$/);
  });

  it('rejects check calls over the 200-URL cap and empty calls', async () => {
    const m = mockFetch();
    const tooMany = Array.from({ length: CHECK_MAX_URLS + 1 }, (_, i) => `https://x.example/${i}`);
    await expect(cmdCheck({ client: api(m.fetch), warn: () => {} }, tooMany)).rejects.toThrow(ValidationError);
    await expect(cmdCheck({ client: api(m.fetch), warn: () => {} }, [])).rejects.toThrow(ValidationError);
    expect(m.calls).toHaveLength(0); // rejected before any network I/O
  });
});

describe('clampLimit', () => {
  it('clamps with a warning for list (100) and search (50)', () => {
    const warns: string[] = [];
    expect(clampLimit(500, 100, 'list', (w) => warns.push(w))).toBe(100);
    expect(clampLimit(500, 50, 'search', (w) => warns.push(w))).toBe(50);
    expect(warns).toHaveLength(2);
    expect(warns[0]).toContain('100');
    expect(clampLimit(undefined, 100, 'list')).toBeUndefined();
    expect(clampLimit(10, 100, 'list')).toBe(10);
  });
});

describe('command payloads', () => {
  it('get returns the full record plus one matching source', async () => {
    const fixture = (await import('./fixtures/article.by-url.json')).default;
    const m = mockFetch([{ status: 200, body: fixture }]);
    const out = await cmdGet({ client: api(m.fetch), warn: () => {} }, 'https://blog.example.org/cache-poisoning');
    const parsed = out.data.article as Record<string, unknown>;
    expect(parsed.full_text).toBeTruthy();
    expect(parsed.feed_name).toBe('PortSwigger Research');
    expect(out.sources).toEqual([
      { id: fixture.id, url: fixture.url, feed_name: fixture.feed_name, published_at: fixture.published_at },
    ]);
    expect(m.url(0).pathname).toBe('/api/articles/by-url');
    expect(m.url(0).searchParams.get('url')).toBe('https://blog.example.org/cache-poisoning');
  });

  it('search normalizes hits into articles and mirrors citations', async () => {
    const fixture = (await import('./fixtures/articles.search.json')).default;
    const m = mockFetch([{ status: 200, body: fixture }]);
    const out = await cmdSearch({ client: api(m.fetch), warn: () => {} }, 'search infrastructure', {});
    expect(m.url(0).pathname).toBe('/api/articles/search');
    expect(m.url(0).searchParams.get('q')).toBe('search infrastructure');
    const articles = out.data.articles as Article[];
    expect(articles).toHaveLength(2);
    for (const a of articles) expect(a.id > 0 && typeof a.url === 'string').toBe(true);
    expect(out.sources).toHaveLength(2);
    expect(out.data.search_mode).toBe('hybrid');
  });

  it('list --all implies no_floor and walks pages', async () => {
    const page = (ids: number[], hasMore: boolean) => ({
      articles: ids.map((id) => ({
        id,
        title: `t${id}`,
        url: `https://x.example/${id}`,
        feed_name: 'F',
        published_at: '2025-01-01T00:00:00Z',
      })),
      has_more: hasMore,
    });
    const m = mockFetch([
      { status: 200, body: page([1, 2], true) },
      { status: 200, body: page([3], false) },
    ]);
    const warns: string[] = [];
    const out = await cmdList(
      { client: api(m.fetch), warn: (w) => warns.push(w) },
      { all: true, maxItems: 2000, pageDelayMs: 0 },
    );
    expect((out.data.articles as Article[]).map((a) => a.id)).toEqual([1, 2, 3]);
    expect(m.url(0).searchParams.get('no_floor')).toBe('true');
    expect(out.sources).toHaveLength(3);
  });

  it('similar returns neighbor articles with citations', async () => {
    const fixture = (await import('./fixtures/article.similar.json')).default;
    const m = mockFetch([{ status: 200, body: fixture }]);
    const out = await cmdSimilar({ client: api(m.fetch), warn: () => {} }, '123');
    expect(m.url(0).pathname).toBe('/api/articles/123/similar');
    expect(out.sources).toHaveLength(2);
  });
});
