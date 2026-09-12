import { apiErrorForStatus, NetworkError, SearchBuildingError } from './errors.js';
import { USER_AGENT } from './config.js';

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Automatic retries for retryable failures (429/503/network). Default 1. */
  retry?: number;
  /** Per-request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
  /** Minimum spacing between request starts (self-throttle). Default 500 (~120 req/min). */
  throttleMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin, faithful fetch wrapper over the documented Oksskolten API.
 * Self-throttles, honors Retry-After on 429, and maps failures to
 * typed errors with the documented exit codes.
 */
export class ApiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly retry: number;
  private readonly timeoutMs: number;
  private readonly throttleMs: number;
  private readonly fetchImpl: typeof fetch;
  private lastRequestAt = 0;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.retry = Math.max(0, opts.retry ?? 1);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.throttleMs = opts.throttleMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async get(path: string, params?: RequestOptions['params']): Promise<unknown> {
    return this.request('GET', path, { params });
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', path, { body });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    { params, body }: RequestOptions = {},
  ): Promise<unknown> {
    const url = new URL(path, `${this.baseUrl}/`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    let attempt = 0;
    for (;;) {
      attempt += 1;
      await this.throttle();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            'User-Agent': USER_AGENT,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (attempt <= this.retry) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new NetworkError(`request failed: ${message}`, 'check the base URL with `oks health`');
      }

      if (response.ok) {
        if (response.status === 204) return null;
        const text = await response.text();
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          throw new NetworkError('server returned malformed JSON');
        }
      }

      const serverMessage = await errorMessage(response);
      const isSearchBuilding =
        response.status === 503 && /search index is building/i.test(serverMessage);

      if (RETRYABLE_STATUS.has(response.status) && attempt <= this.retry) {
        if (isSearchBuilding) continue; // retry quietly; mapped error only when exhausted
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000 + jitter()
            : backoffMs(attempt),
        );
        continue;
      }

      if (isSearchBuilding) {
        throw new SearchBuildingError(
          serverMessage || 'Search index is building',
          'run `oks health` to check searchReady, then retry',
        );
      }
      throw apiErrorForStatus(response.status, serverMessage);
    }
  }

  /** Enforce minimum spacing between request starts. */
  private async throttle(): Promise<void> {
    if (this.throttleMs <= 0) return;
    const now = Date.now();
    const earliest = this.lastRequestAt + this.throttleMs;
    if (now < earliest) await sleep(earliest - now);
    this.lastRequestAt = Date.now();
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (payload && typeof payload.error === 'string') return payload.error;
  } catch {
    // fall through to generic message
  }
  return `HTTP ${response.status}`;
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 2 ** (attempt - 1) * 500) + jitter();
}

function jitter(): number {
  return Math.floor(Math.random() * 250);
}
