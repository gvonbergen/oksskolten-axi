import { describe, expect, it } from 'vitest';
import { walkPages } from '../src/pagination.js';

function seq(pages: Array<{ ids: number[]; hasMore: boolean }>) {
  let call = 0;
  return async (offset: number, limit: number) => {
    const page = pages[call++]!;
    return {
      items: page.ids.map((id) => ({ id, offset, limit })),
      hasMore: page.hasMore,
      total: null,
    };
  };
}

describe('walkPages', () => {
  it('walks until has_more is false, advancing offset', async () => {
    const result = await walkPages<{ id: number }>(
      seq([
        { ids: [1, 2], hasMore: true },
        { ids: [3], hasMore: false },
      ]),
      { limit: 2, delayMs: 0 },
    );
    expect(result.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(result.pages).toBe(2);
  });

  it('honors the hard max-items cap and reports truncation', async () => {
    const result = await walkPages<{ id: number }>(
      async (_offset, limit) => ({
        items: [1, 2, 3, 4, 5].map((id) => ({ id, limit })),
        hasMore: true,
      }),
      { limit: 5, maxItems: 8, delayMs: 0 },
    );
    expect(result.items).toHaveLength(8);
    expect(result.truncatedByCap).toBe(true);
  });

  it('stops on an empty page', async () => {
    const result = await walkPages<{ id: number }>(
      seq([{ ids: [], hasMore: true }]),
      { limit: 10, delayMs: 0 },
    );
    expect(result.items).toEqual([]);
    expect(result.pages).toBe(1);
  });

  it('delays between pages', async () => {
    const start = Date.now();
    await walkPages<{ id: number }>(
      seq([
        { ids: [1], hasMore: true },
        { ids: [2], hasMore: false },
      ]),
      { limit: 1, delayMs: 80 },
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(75);
  }, 10_000);
});
