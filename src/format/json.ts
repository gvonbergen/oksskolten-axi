import { assemble, type Output } from './output.js';

/** JSON output: lossless default; sources block included unless --no-meta. */
export function formatJson(out: Output, opts: { noMeta?: boolean } = {}): string {
  return `${JSON.stringify(assemble(out, opts), null, 2)}\n`;
}
