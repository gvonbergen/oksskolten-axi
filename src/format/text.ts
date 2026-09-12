import type { Article } from '../types.js';
import type { Output } from './output.js';

export interface TextOptions {
  noMeta?: boolean;
  /** Max characters of full_text in text mode before eliding. Default 400. */
  fullTextSnippet?: number;
}

/** Human-readable text output. Diagnostics never go here — stdout only. */
export function formatText(out: Output, opts: TextOptions = {}): string {
  const { data } = out;
  if (typeof data.article === 'object' && data.article !== null) {
    return renderFullArticle(data.article as Article, opts);
  }
  if (Array.isArray(data.articles)) {
    return renderArticleList(data.articles as Article[]);
  }
  return `${renderValue(data, 0).trimEnd()}\n`;
}

function renderArticleList(articles: Article[]): string {
  if (articles.length === 0) return '(no results)\n';
  const blocks = articles.map((a) => {
    const head = [`#${a.id}`, a.published_at ?? '?', a.feed_name ?? '?'].join('  ·  ');
    const lines = [head, a.title ?? '(untitled)'];
    if (a.url) lines.push(a.url);
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n`;
}

function renderFullArticle(article: Article, opts: TextOptions): string {
  const snippet = opts.fullTextSnippet ?? 400;
  const lines: string[] = [];
  lines.push(article.title ?? '(untitled)');
  lines.push(
    `#${article.id}  ·  ${article.published_at ?? '?'}  ·  ${article.feed_name ?? '?'}${
      typeof article.lang === 'string' && article.lang ? `  ·  lang=${article.lang}` : ''
    }`,
  );
  if (article.url) lines.push(article.url);
  if (typeof article.summary === 'string' && article.summary) {
    lines.push('', article.summary);
  }
  const fullText = typeof article.full_text === 'string' ? article.full_text : '';
  if (fullText) {
    lines.push('', snippetOf(fullText, snippet));
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Elide long text with an explicit, actionable marker. */
export function snippetOf(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}…[truncated ${omitted} chars; use --format json]`;
}

/** Generic recursive renderer for non-article payloads. */
function renderValue(value: unknown, depth: number): string {
  const pad = '  '.repeat(depth);
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return `${pad}${String(value)}\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}(empty)\n`;
    return value.map((item) => renderValue(item, depth)).join('');
  }
  let out = '';
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      out += `${pad}${key}:\n${renderValue(v, depth + 1)}`;
    } else if (Array.isArray(v)) {
      out += `${pad}${key}:\n${renderValue(v, depth + 1)}`;
    } else {
      out += `${pad}${key}: ${String(v)}\n`;
    }
  }
  return out;
}
