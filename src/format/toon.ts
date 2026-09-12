import { encode } from '@toon-format/toon';
import { assemble, type Output } from './output.js';

/** TOON (Token-Oriented Object Notation) output for token-lean agent consumption. */
export function formatToon(out: Output, opts: { noMeta?: boolean } = {}): string {
  return `${encode(assemble(out, opts))}\n`;
}
