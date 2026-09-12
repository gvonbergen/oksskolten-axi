import { vi, type Mock } from 'vitest';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export interface MockResponseSpec {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Build a fetch mock recording every call and returning queued responses
 * (the last spec repeats). No real network is involved.
 */
export function mockFetch(specs: MockResponseSpec[] = [{ status: 200, body: {} }]): {
  fetch: typeof fetch;
  calls: RecordedCall[];
  url: (i: number) => URL;
} {
  const calls: RecordedCall[] = [];
  const mock: Mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init: init ?? {} });
    const spec = specs[Math.min(calls.length - 1, specs.length - 1)] ?? {};
    return new Response(spec.body === undefined ? '' : JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: spec.headers ?? { 'Content-Type': 'application/json' },
    });
  }) as unknown as Mock & typeof fetch;
  return {
    fetch: mock as typeof fetch,
    calls,
    url: (i: number) => new URL(calls[i]!.url),
  };
}
