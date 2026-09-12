/** Exit codes documented in README ("Exit codes"). */
export const EXIT_CODES = {
  ok: 0,
  unexpected: 1,
  badRequest: 2,
  auth: 3,
  scope: 4,
  notFound: 5,
  rateLimited: 6,
  searchBuilding: 7,
  network: 8,
} as const;

export class OksError extends Error {
  readonly exitCode: number;
  readonly hint?: string;
  /** HTTP status when the error originated from a response. */
  readonly status?: number;

  constructor(message: string, exitCode: number, hint?: string, status?: number) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
    this.hint = hint;
    this.status = status;
  }
}

/** Invalid CLI input or server-side 400. */
export class ValidationError extends OksError {
  constructor(message: string, hint?: string, status?: number) {
    super(message, EXIT_CODES.badRequest, hint, status);
  }
}

/** Missing or invalid API key (locally detected or HTTP 401). */
export class AuthError extends OksError {
  constructor(message: string, hint?: string, status?: number) {
    super(message, EXIT_CODES.auth, hint, status);
  }
}

/** Key lacks the required scope (HTTP 403), e.g. read-only key for `oks check`. */
export class ScopeError extends OksError {
  constructor(message: string, hint?: string, status?: number) {
    super(message, EXIT_CODES.scope, hint, status);
  }
}

export class NotFoundError extends OksError {
  constructor(message: string, hint?: string, status?: number) {
    super(message, EXIT_CODES.notFound, hint, status);
  }
}

export class RateLimitError extends OksError {
  constructor(message: string, hint?: string, status?: number) {
    super(message, EXIT_CODES.rateLimited, hint, status);
  }
}

/** Search index still building (HTTP 503). */
export class SearchBuildingError extends OksError {
  constructor(message: string, hint?: string, status?: number) {
    super(message, EXIT_CODES.searchBuilding, hint, status);
  }
}

/** Network, TLS, timeout, or unmapped 5xx failure. */
export class NetworkError extends OksError {
  constructor(message: string, hint?: string, status?: number) {
    super(message, EXIT_CODES.network, hint, status);
  }
}

/** Map an HTTP status to the documented exit code. */
export function exitCodeForStatus(status: number): number {
  switch (status) {
    case 400:
      return EXIT_CODES.badRequest;
    case 401:
      return EXIT_CODES.auth;
    case 403:
      return EXIT_CODES.scope;
    case 404:
      return EXIT_CODES.notFound;
    case 429:
      return EXIT_CODES.rateLimited;
    default:
      return status >= 500 ? EXIT_CODES.network : EXIT_CODES.badRequest;
  }
}

/** Build the right OksError for a failed HTTP response. */
export function apiErrorForStatus(
  status: number,
  serverMessage: string | undefined,
): OksError {
  const message = serverMessage || `HTTP ${status}`;
  switch (status) {
    case 400:
      return new ValidationError(message, undefined, status);
    case 401:
      return new AuthError(
        message || 'invalid API key',
        'create an API key in Oksskolten Settings → Security → API Tokens, then `oks config set api_key ok_…`',
        status,
      );
    case 403:
      return new ScopeError(
        message || 'API key does not have write scope',
        'this command needs a key with write scope (read,write); read-only keys work for every other command',
        status,
      );
    case 404:
      return new NotFoundError(message, 'no article exists at that URL — `oks check` can verify corpus membership', status);
    case 429:
      return new RateLimitError(message, 'the CLI retries automatically; raise --retry if this persists', status);
    default:
      if (status === 503) {
        return new SearchBuildingError(
          message,
          'the search index is still building — run `oks health` and retry',
          status,
        );
      }
      return new NetworkError(message, undefined);
  }
}
