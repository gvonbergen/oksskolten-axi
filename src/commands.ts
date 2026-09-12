import type { ApiClient } from './client.js';
import type { Output } from './format/output.js';
import { citationsFor, plainOutput } from './format/output.js';
import type { Article, ArticleFull } from './types.js';
import { ValidationError } from './errors.js';
import { walkPages } from './pagination.js';
import { assertHttpUrl, assertIsoDate } from './util.js';

/** Clamp a --limit to the server cap, reporting the clamp via warn. */
export function clampLimit(
  requested: number | undefined,
  max: number,
  scope: string,
  warn: (message: string) => void = () => {},
): number | undefined {
  if (requested === undefined) return undefined;
  if (requested > max) {
    warn(`limit ${requested} exceeds the ${scope} maximum of ${max}; clamping to ${max}`);
    return max;
  }
  return requested;
}

/** Server caps (docs/spec/20_api.md). */
export const LIST_MAX_LIMIT = 100;
export const SEARCH_MAX_LIMIT = 50;
export const CHECK_MAX_URLS = 200;
export const DEFAULT_MAX_ITEMS = 2000;
export const DEFAULT_PAGE_DELAY_MS = 250;

export interface ListOptions {
  feed?: number;
  category?: number;
  unread?: boolean;
  bookmarked?: boolean;
  liked?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
  noFloor?: boolean;
  all?: boolean;
  maxItems?: number;
  pageDelayMs?: number;
}

export interface SearchOptions {
  feed?: number;
  category?: number;
  since?: string;
  until?: string;
  unread?: boolean;
  liked?: boolean;
  bookmarked?: boolean;
  limit?: number;
  offset?: number;
  all?: boolean;
  maxItems?: number;
  pageDelayMs?: number;
}

export interface CommandContext {
  client: ApiClient;
  /** Emit a diagnostic to stderr. */
  warn: (message: string) => void;
}

export async function cmdHealth(ctx: CommandContext): Promise<Output> {
  return plainOutput(asRecord(await ctx.client.get('/api/health')));
}

export async function cmdFeeds(ctx: CommandContext): Promise<Output> {
  return plainOutput(asRecord(await ctx.client.get('/api/feeds')));
}

export async function cmdCategories(ctx: CommandContext): Promise<Output> {
  return plainOutput(asRecord(await ctx.client.get('/api/categories')));
}

export async function cmdList(ctx: CommandContext, opts: ListOptions): Promise<Output> {
  const params = listParams(opts);
  if (!opts.all) {
    const res = asRecord(await ctx.client.get('/api/articles', params));
    const articles = articleArray(res.articles);
    return {
      data: { ...res, articles },
      sources: citationsFor(articles),
    };
  }
  // Corpus-wide walk must see past the smart floor (documented behavior).
  const walkParams = { ...params, no_floor: true as const };
  const { items, pages, truncatedByCap } = await walkPages<Article>(
    async (offset, limit) => {
      const res = asRecord(
        await ctx.client.get('/api/articles', { ...walkParams, limit, offset }),
      );
      return {
        items: articleArray(res.articles),
        hasMore: res.has_more === true,
        total: (res.total as number | undefined) ?? null,
      };
    },
    {
      limit: opts.limit ?? LIST_MAX_LIMIT,
      maxItems: opts.maxItems,
      delayMs: opts.pageDelayMs,
      onProgress: (n) => ctx.warn(`fetched ${n} articles…`),
    },
  );
  if (truncatedByCap) {
    ctx.warn(`stopped at --max-items cap; raise --max-items to walk further`);
  }
  return {
    data: { articles: items, pages, has_more: false, all: true },
    sources: citationsFor(items),
  };
}

export async function cmdSearch(ctx: CommandContext, query: string, opts: SearchOptions): Promise<Output> {
  if (opts.since) validateDate(opts.since, '--since');
  if (opts.until) validateDate(opts.until, '--until');
  const params: Record<string, string | number | boolean | undefined> = {
    q: query,
    feed_id: opts.feed,
    category_id: opts.category,
    since: opts.since,
    until: opts.until,
    unread: opts.unread,
    liked: opts.liked,
    bookmarked: opts.bookmarked,
    limit: opts.limit,
    offset: opts.offset,
  };
  if (!opts.all) {
    const res = asRecord(await ctx.client.get('/api/articles/search', params));
    const articles = articleArray(res.articles ?? res.hits);
    return {
      data: { ...res, articles },
      sources: citationsFor(articles),
    };
  }
  const { items, pages, truncatedByCap } = await walkPages<Article>(
    async (offset, limit) => {
      const res = asRecord(
        await ctx.client.get('/api/articles/search', { ...params, limit, offset }),
      );
      return {
        items: articleArray(res.articles ?? res.hits),
        hasMore: res.has_more === true,
        total: (res.estimatedTotalHits as number | undefined) ?? (res.total as number | undefined) ?? null,
      };
    },
    {
      limit: opts.limit ?? SEARCH_MAX_LIMIT,
      maxItems: opts.maxItems,
      delayMs: opts.pageDelayMs,
      onProgress: (n) => ctx.warn(`fetched ${n} results…`),
    },
  );
  if (truncatedByCap) {
    ctx.warn(`stopped at --max-items cap; raise --max-items to walk further`);
  }
  return {
    data: { articles: items, pages, has_more: false, all: true, query },
    sources: citationsFor(items),
  };
}

export async function cmdGet(ctx: CommandContext, rawUrl: string): Promise<Output> {
  const url = safeUrl(rawUrl);
  const record = asRecord(await ctx.client.get('/api/articles/by-url', { url }));
  const article = record.article ? asRecord(record.article) : record;
  return {
    data: { article: article as ArticleFull },
    sources: citationsFor([article as Article]),
  };
}

export async function cmdSimilar(ctx: CommandContext, id: string): Promise<Output> {
  const articleId = parseId(id);
  const res = asRecord(await ctx.client.get(`/api/articles/${articleId}/similar`));
  const articles = articleArray(
    res.articles ?? res.hits ?? (Array.isArray(res) ? (res as unknown[]) : []),
  );
  return {
    data: Array.isArray(res) ? { articles } : { ...res, articles },
    sources: citationsFor(articles),
  };
}

export async function cmdStats(
  ctx: CommandContext,
  opts: { since?: string; until?: string },
): Promise<Output> {
  if (opts.since) validateDate(opts.since, '--since');
  if (opts.until) validateDate(opts.until, '--until');
  return plainOutput(
    asRecord(
      await ctx.client.get('/api/stats', {
        since: opts.since,
        until: opts.until,
      }),
    ),
  );
}

export async function cmdCheck(ctx: CommandContext, urls: string[]): Promise<Output> {
  if (urls.length === 0) throw new ValidationError('check requires at least one URL');
  if (urls.length > CHECK_MAX_URLS) {
    throw new ValidationError(`check accepts at most ${CHECK_MAX_URLS} URLs per call (got ${urls.length})`);
  }
  const normalized = urls.map((u) => safeUrl(u));
  const res = asRecord(await ctx.client.post('/api/articles/check-urls', { urls: normalized }));
  return plainOutput(res);
}

function listParams(opts: ListOptions): Record<string, string | number | boolean | undefined> {
  return {
    feed_id: opts.feed,
    category_id: opts.category,
    unread: opts.unread,
    bookmarked: opts.bookmarked,
    liked: opts.liked,
    sort: opts.sort,
    limit: opts.limit,
    offset: opts.offset,
    no_floor: opts.noFloor,
  };
}

function validateDate(value: string, flag: string): void {
  try {
    assertIsoDate(value, flag);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : String(err));
  }
}

/** Validate a URL argument with the documented validation error. */
export function safeUrl(raw: string): string {
  try {
    return assertHttpUrl(raw);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : String(err));
  }
}

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`article id must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return { value };
  return value as Record<string, unknown>;
}

function articleArray(value: unknown): Article[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Article => typeof item === 'object' && item !== null && 'id' in (item as object),
  );
}
