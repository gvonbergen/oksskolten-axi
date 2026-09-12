import type { Article, Citation } from '../types.js';
import type { Output } from './output.js';
import { snippetOf } from './text.js';

export interface MdOptions {
  noMeta?: boolean;
  fullTextSnippet?: number;
}

/** Markdown output with a trailing Sources section on article-bearing results. */
export function formatMarkdown(out: Output, opts: MdOptions = {}): string {
  const { data, sources } = out;
  const chunks: string[] = [];

  if (typeof data.article === 'object' && data.article !== null) {
    chunks.push(renderFullArticleMd(data.article as Article, opts));
  } else if (Array.isArray(data.articles)) {
    chunks.push(renderArticleListMd(data.articles as Article[]));
  } else {
    chunks.push(renderPlainMd(data));
  }

  if (sources && sources.length > 0 && !opts.noMeta) {
    chunks.push(renderSources(sources));
  }
  return `${chunks.join('\n').trimEnd()}\n`;
}

function renderArticleListMd(articles: Article[]): string {
  if (articles.length === 0) return '_No results._';
  return articles
    .map((a) => {
      const title = a.title ?? '(untitled)';
      const link = a.url ? `[${title}](${a.url})` : title;
      return `- **#${a.id}** — ${link} · ${a.feed_name ?? '?'} · ${a.published_at ?? '?'}`;
    })
    .join('\n');
}

function renderFullArticleMd(article: Article, opts: MdOptions): string {
  const lines: string[] = [];
  lines.push(`# ${article.title ?? '(untitled)'}`);
  lines.push('');
  lines.push(
    `**#${article.id}** · ${article.feed_name ?? '?'} · ${article.published_at ?? '?'}${
      typeof article.lang === 'string' && article.lang ? ` · lang=${article.lang}` : ''
    }`,
  );
  if (article.url) lines.push(`\n<${article.url}>`);
  if (typeof article.summary === 'string' && article.summary) {
    lines.push('', article.summary);
  }
  const fullText = typeof article.full_text === 'string' ? article.full_text : '';
  if (fullText) {
    lines.push('', snippetOf(fullText, opts.fullTextSnippet ?? 400));
  }
  return lines.join('\n');
}

function renderSources(sources: Citation[]): string {
  const items = sources.map((s) => {
    const label = s.feed_name ?? '?';
    const date = s.published_at ?? '?';
    const url = s.url ?? '(no url)';
    return `- ${label}, ${date}. ${url}`;
  });
  return ['## Sources', '', ...items].join('\n');
}

function renderPlainMd(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`## ${key}`, '');
      if (value.length === 0) lines.push('_None._');
      for (const item of value) {
        lines.push(`- ${JSON.stringify(item)}`);
      }
      lines.push('');
    } else if (typeof value === 'object') {
      lines.push(`## ${key}`, '', '```json', JSON.stringify(value, null, 2), '```', '');
    } else {
      lines.push(`- **${key}:** ${String(value)}`);
    }
  }
  return lines.join('\n');
}
