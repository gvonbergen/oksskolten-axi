/**
 * Hand-copied API response types for the documented Oksskolten API
 * (docs/spec/20_api.md). Duplicated intentionally so this package stays
 * decoupled from the server build; contract fixtures in test/fixtures/
 * keep the shapes pinned against spec drift.
 */

export interface Feed {
  id: number;
  name: string;
  category_id?: number | null;
  category_name?: string | null;
  article_count?: number | null;
  [key: string]: unknown;
}

export interface Category {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** Citation fields carried verbatim on every article-bearing record. */
export interface Citation {
  id: number;
  url: string | null;
  feed_name: string | null;
  published_at: string | null;
}

export interface Article extends Citation {
  title?: string | null;
  [key: string]: unknown;
}

export interface ArticleFull extends Article {
  lang?: string | null;
  summary?: string | null;
  full_text?: string | null;
  full_text_ja?: string | null;
  [key: string]: unknown;
}

export interface ListResponse {
  articles: Article[];
  total?: number | null;
  has_more?: boolean;
  total_without_floor?: number | null;
  [key: string]: unknown;
}

export interface SearchResponse {
  /** Server may return either `articles` or `hits` (Meilisearch). */
  articles?: Article[];
  hits?: Article[];
  total?: number | null;
  estimatedTotalHits?: number | null;
  has_more?: boolean;
  search_mode?: string | null;
  query?: string | null;
  [key: string]: unknown;
}

export interface HealthResponse {
  status?: string;
  searchReady?: boolean;
  [key: string]: unknown;
}

export interface CheckUrlsResponse {
  [key: string]: unknown;
}

export interface StatsResponse {
  [key: string]: unknown;
}

/** Normalize a search response to a plain articles array. */
export function searchArticles(res: SearchResponse): Article[] {
  return res.articles ?? res.hits ?? [];
}
