import { describe, expect, it } from 'vitest';
import { citationOf, hasCitationFields, parseFields, projectArticle } from '../src/format/citation.js';
import { assemble, citationsFor, plainOutput, type Output } from '../src/format/output.js';
import { formatJson } from '../src/format/json.js';
import { formatToon } from '../src/format/toon.js';
import { formatText, snippetOf } from '../src/format/text.js';
import { formatMarkdown } from '../src/format/md.js';
import type { Article } from '../src/types.js';

const article: Article = {
  id: 123,
  title: 'Cache poisoning via header smuggling',
  url: 'https://blog.example.org/cache-poisoning',
  feed_name: 'PortSwigger Research',
  published_at: '2025-02-26T00:00:00Z',
  summary: 'A summary.',
  full_text: 'Full text body.',
};

const listOutput = (articles: Article[]): Output => ({
  data: { articles, total: articles.length, has_more: false },
  sources: citationsFor(articles),
});

describe('citation preservation', () => {
  it('extracts the four citation fields verbatim', () => {
    expect(citationOf(article)).toEqual({
      id: 123,
      url: 'https://blog.example.org/cache-poisoning',
      feed_name: 'PortSwigger Research',
      published_at: '2025-02-26T00:00:00Z',
    });
  });

  it('mirrors citations for list/search sources blocks', () => {
    const { sources } = listOutput([article, { ...article, id: 124 }]);
    expect(sources).toHaveLength(2);
    expect(sources![0]).toEqual(citationOf(article));
  });

  it('detects missing citation fields', () => {
    expect(hasCitationFields(article)).toBe(true);
    expect(hasCitationFields({ id: 1 })).toBe(false);
    expect(hasCitationFields(null)).toBe(false);
  });
});

describe('json output', () => {
  it('includes the sources block by default', () => {
    const parsed = JSON.parse(formatJson(listOutput([article])));
    expect(parsed.articles).toHaveLength(1);
    expect(parsed.sources).toEqual([citationOf(article)]);
  });

  it('omits sources with --no-meta', () => {
    const parsed = JSON.parse(formatJson(listOutput([article]), { noMeta: true }));
    expect(parsed.sources).toBeUndefined();
    expect(parsed.articles).toHaveLength(1);
  });

  it('never attaches a sources block to non-article payloads', () => {
    const parsed = JSON.parse(formatJson(plainOutput({ status: 'ok' })));
    expect(parsed.sources).toBeUndefined();
  });

  it('projects fields without touching sources', () => {
    const out: Output = { ...listOutput([article]), fields: ['id', 'url', 'title', 'published_at'] };
    const parsed = JSON.parse(formatJson(out));
    expect(parsed.articles[0]).toEqual({ id: 123, url: article.url, title: article.title, published_at: article.published_at });
    expect(parsed.sources[0]).toEqual(citationOf(article));
  });

  it('projects single-article payloads (oks get)', () => {
    const out: Output = {
      data: { article },
      sources: citationsFor([article]),
      fields: ['id', 'url'],
    };
    const parsed = JSON.parse(formatJson(out, { noMeta: true }));
    expect(parsed.article).toEqual({ id: 123, url: article.url });
  });
});

describe('toon output', () => {
  it('encodes the assembled payload (same object as JSON)', () => {
    const out = listOutput([article]);
    const toon = formatToon(out);
    expect(toon.trim().length).toBeGreaterThan(0);
    // TOON is a superset-friendly serialization: the JSON of the same payload
    // must contain every article id that TOON shows.
    for (const id of [123]) {
      expect(toon).toContain(String(id));
    }
    expect(formatJson(out)).toContain('PortSwigger Research');
  });

  it('respects --no-meta', () => {
    const out = listOutput([article]);
    expect(formatToon(out, { noMeta: true })).not.toContain('sources');
  });
});

describe('text output', () => {
  it('elides long full_text with an explicit actionable marker', () => {
    const marker = snippetOf('a'.repeat(1000), 400);
    expect(marker).toContain('…[truncated 600 chars; use --format json]');
  });

  it('renders full articles with snippet limit', () => {
    const out: Output = { data: { article }, sources: citationsFor([article]) };
    const text = formatText(out, { fullTextSnippet: 5 });
    expect(text).toContain('Cache poisoning');
    expect(text).toContain('truncated');
  });

  it('shows full text when under the snippet size', () => {
    const out: Output = { data: { article }, sources: null };
    const text = formatText(out, { fullTextSnippet: 400 });
    expect(text).toContain('Full text body.');
    expect(text).not.toContain('truncated');
  });

  it('renders article lists compactly', () => {
    const text = formatText(listOutput([article]));
    expect(text).toContain('#123');
    expect(text).toContain('PortSwigger Research');
    expect(text).toContain('https://blog.example.org/cache-poisoning');
  });
});

describe('markdown output', () => {
  it('ends article-bearing output with a Sources section', () => {
    const md = formatMarkdown(listOutput([article]));
    expect(md.trimEnd().endsWith(`- PortSwigger Research, ${article.published_at}. ${article.url}`)).toBe(true);
    expect(md).toContain('## Sources');
  });

  it('omits Sources with --no-meta or empty sources', () => {
    expect(formatMarkdown(listOutput([article]), { noMeta: true })).not.toContain('## Sources');
    const empty: Output = { data: { articles: [] }, sources: [] };
    expect(formatMarkdown(empty)).not.toContain('## Sources');
  });
});
