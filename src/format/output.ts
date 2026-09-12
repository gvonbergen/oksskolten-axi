import type { Article, Citation } from '../types.js';
import { citationOf, projectArticle } from './citation.js';

export interface Output {
  /** Payload without the sources block. */
  data: Record<string, unknown>;
  /**
   * null → not article-bearing (no sources block emitted).
   * array → article-bearing; mirrored citation records.
   */
  sources: Citation[] | null;
  /** Field projection for json/toon article objects; null = full objects. */
  fields?: readonly string[] | null;
}

/** Build an Output for a plain (non-article) payload. */
export function plainOutput(data: Record<string, unknown>): Output {
  return { data, sources: null };
}

/**
 * Assemble the final structured payload: --fields projection (json/toon only)
 * plus the sources block unless suppressed or not article-bearing.
 */
export function assemble(out: Output, opts: { noMeta?: boolean; project?: boolean } = {}): Record<string, unknown> {
  const { data, sources } = out;
  const project = out.fields && opts.project !== false;
  const projected = project ? projectPayload(data, out.fields!) : data;
  if (sources === null || opts.noMeta) return projected;
  return { ...projected, sources };
}

function projectPayload(data: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'articles' && Array.isArray(value)) {
      out[key] = value.map((a) => projectArticle(a as Article, fields));
    } else if (key === 'article' && value && typeof value === 'object') {
      out[key] = projectArticle(value as Article, fields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Citations for an articles array (mirrors the records' citation fields). */
export function citationsFor(articles: Article[]): Citation[] {
  return articles.map(citationOf);
}
