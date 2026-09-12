import type { Article, Citation } from '../types.js';

/** Citation fields carried on every article-bearing record, verbatim. */
export const CITATION_FIELDS = ['id', 'url', 'feed_name', 'published_at'] as const;

export type CitationField = (typeof CITATION_FIELDS)[number];

export function citationOf(article: Article): Citation {
  return {
    id: article.id,
    url: article.url ?? null,
    feed_name: article.feed_name ?? null,
    published_at: article.published_at ?? null,
  };
}

/** True when the object carries every citation field. */
export function hasCitationFields(article: unknown): article is Article {
  if (article === null || typeof article !== 'object') return false;
  return CITATION_FIELDS.every((f) => f in (article as Record<string, unknown>));
}

/** Project an article object to the requested fields (--fields). */
export function projectArticle(
  article: Article,
  fields: readonly string[] | null,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return article;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in article) out[field] = (article as Record<string, unknown>)[field];
  }
  return out;
}

/** Parse and validate a --fields value; null means "no projection". */
export function parseFields(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const fields = value
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  if (fields.length === 0) {
    throw new TypeError('--fields must name at least one field, e.g. --fields id,url,title,published_at');
  }
  return fields;
}
