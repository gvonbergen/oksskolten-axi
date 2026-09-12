export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a positive integer CLI argument, or throw a TypeError with a message. */
export function parsePositiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new TypeError(`${name} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return n;
}

/** Validate an ISO-8601 date or datetime string. */
export function assertIsoDate(value: string, name: string): string {
  const isoPattern = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!isoPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO-8601 date/datetime, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Validate an absolute http(s) URL. */
export function assertHttpUrl(value: string, name = 'url'): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute http(s) URL, got ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`${name} must be an http(s) URL, got protocol ${parsed.protocol}`);
  }
  return parsed.toString();
}
