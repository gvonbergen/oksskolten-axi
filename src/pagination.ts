import { sleep } from './util.js';

export interface Page<T> {
  items: T[];
  hasMore: boolean;
  total?: number | null;
}

export interface WalkOptions {
  limit: number;
  /** Hard safety cap on accumulated items. Default 2000. */
  maxItems?: number;
  /** Delay between pages in milliseconds. Default 250. */
  delayMs?: number;
  onProgress?: (fetched: number) => void;
}

export interface WalkResult<T> {
  items: T[];
  pages: number;
  truncatedByCap: boolean;
}

/**
 * Walk offset-based pages until the server reports no more results or the
 * safety cap is hit. Runs sequentially with a per-page delay.
 */
export async function walkPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  opts: WalkOptions,
): Promise<WalkResult<T>> {
  const maxItems = opts.maxItems ?? 2000;
  const delayMs = opts.delayMs ?? 250;
  const items: T[] = [];
  let offset = 0;
  let pages = 0;
  let truncatedByCap = false;

  for (;;) {
    const page = await fetchPage(offset, opts.limit);
    pages += 1;
    items.push(...page.items);
    opts.onProgress?.(items.length);

    let capReached = items.length >= maxItems;
    if (items.length > maxItems) {
      items.length = maxItems;
      truncatedByCap = true;
      capReached = true;
    }
    if (!page.hasMore || capReached || page.items.length === 0) {
      return { items, pages, truncatedByCap };
    }
    offset += page.items.length;
    if (delayMs > 0) await sleep(delayMs);
  }
}

export { sleep };
