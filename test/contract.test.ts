import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasCitationFields } from '../src/format/citation.js';

/**
 * Fixture contract tests: the fixtures are JSON snapshots of each documented
 * endpoint response. If the server API drifts from what the CLI's typed
 * client expects, these assertions fail in CI.
 */

const fixturesDir = join(import.meta.dirname, 'fixtures');

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8'));
}

function collectArticles(value: unknown, path: string): Array<{ record: Record<string, unknown>; path: string }> {
  const found: Array<{ record: Record<string, unknown>; path: string }> = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...collectArticles(item, `${path}[${i}]`)));
    return found;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'number' && hasCitationFields(record)) {
      found.push({ record, path });
    }
    for (const [key, child] of Object.entries(record)) {
      found.push(...collectArticles(child, `${path}.${key}`));
    }
  }
  return found;
}

const articleBearingFixtures = [
  'articles.list',
  'articles.search',
  'article.by-url',
  'article.similar',
] as const;

describe('fixture contract: citation fields on every article-bearing record', () => {
  for (const name of articleBearingFixtures) {
    it(`${name}.json carries id/url/feed_name/published_at on every article`, () => {
      const fixture = load(name);
      const articles = collectArticles([fixture], name);
      expect(articles.length).toBeGreaterThan(0);
      for (const { record, path } of articles) {
        expect(record, path).toHaveProperty('id');
        expect(record, path).toHaveProperty('url');
        expect(record, path).toHaveProperty('feed_name');
        expect(record, path).toHaveProperty('published_at');
        expect(typeof record.url, path).toBe('string');
        expect(typeof record.published_at, path).toBe('string');
      }
    });
  }

  it('every article id is unique within a fixture', () => {
    for (const name of articleBearingFixtures) {
      const fixture = load(name);
      const ids = collectArticles([fixture], name).map((a) => a.record.id);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });
});

describe('fixture contract: response envelope shapes', () => {
  it('list response exposes articles/total/has_more', () => {
    const list = load('articles.list');
    expect(Array.isArray(list.articles)).toBe(true);
    expect(typeof list.has_more).toBe('boolean');
    expect('total' in list).toBe(true);
  });

  it('search response exposes has_more and search_mode', () => {
    const search = load('articles.search');
    expect(typeof search.has_more).toBe('boolean');
    expect(typeof search.search_mode).toBe('string');
    // Server may return hits or articles; the CLI accepts both.
    expect(Array.isArray(search.hits) || Array.isArray(search.articles)).toBe(true);
  });

  it('health exposes status and searchReady', () => {
    const health = load('health');
    expect(typeof health.searchReady).toBe('boolean');
    expect(health.status).toBe('ok');
  });

  it('check-urls response is a results array with exists flags', () => {
    const check = load('check-urls');
    expect(Array.isArray(check.results)).toBe(true);
    for (const entry of check.results as Array<Record<string, unknown>>) {
      expect(typeof entry.url).toBe('string');
      expect(typeof entry.exists).toBe('boolean');
    }
  });
});
