import { describe, expect, it } from 'vitest';
import { EXIT_CODES, exitCodeForStatus } from '../src/errors.js';
import { assertIsoDate, assertHttpUrl, parsePositiveInt } from '../src/util.js';

describe('documented exit code table', () => {
  it('maps the documented HTTP statuses', () => {
    expect(exitCodeForStatus(400)).toBe(2);
    expect(exitCodeForStatus(401)).toBe(3);
    expect(exitCodeForStatus(403)).toBe(4);
    expect(exitCodeForStatus(404)).toBe(5);
    expect(exitCodeForStatus(429)).toBe(6);
    expect(exitCodeForStatus(503)).toBe(8); // generic 5xx; search building is detected by message
    expect(exitCodeForStatus(500)).toBe(8);
    expect(exitCodeForStatus(418)).toBe(2); // unmapped 4xx
  });

  it('keeps the reserved codes distinct', () => {
    const codes = Object.values(EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('input validation helpers', () => {
  it('parsePositiveInt rejects non-positive and non-integer input', () => {
    expect(parsePositiveInt('5', 'limit')).toBe(5);
    expect(() => parsePositiveInt('0', 'limit')).toThrow(/positive/);
    expect(() => parsePositiveInt('-2', 'limit')).toThrow();
    expect(() => parsePositiveInt('3.5', 'limit')).toThrow();
    expect(() => parsePositiveInt('abc', 'limit')).toThrow();
  });

  it('assertIsoDate accepts ISO-8601 and rejects other formats', () => {
    for (const ok of ['2025-02-26', '2025-02-26T00:00:00Z', '2025-02-26T10:30:00+01:00']) {
      expect(assertIsoDate(ok, '--since')).toBe(ok);
    }
    for (const bad of ['yesterday', '26/02/2025', '2025-13-40']) {
      expect(() => assertIsoDate(bad, '--since')).toThrow(/ISO-8601/);
    }
  });

  it('assertHttpUrl rejects non-http schemes', () => {
    expect(() => assertHttpUrl('ftp://x')).toThrow(/http/);
    expect(() => assertHttpUrl('/relative')).toThrow();
    expect(assertHttpUrl('https://x.example/a')).toBe('https://x.example/a');
  });
});
