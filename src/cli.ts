#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { ApiClient } from './client.js';
import {
  DEFAULT_BASE_URL,
  isConfigKey,
  loadConfig,
  normalizeConfigValue,
  redactKey,
  requireApiKey,
  resolveApiKey,
  resolveBaseUrl,
  saveConfig,
  unsetConfigKey,
  configPath,
} from './config.js';
import {
  cmdCategories,
  cmdCheck,
  cmdFeeds,
  cmdGet,
  cmdHealth,
  cmdList,
  cmdSearch,
  cmdSimilar,
  cmdStats,
  clampLimit,
  LIST_MAX_LIMIT,
  SEARCH_MAX_LIMIT,
  type CommandContext,
  type ListOptions,
  type SearchOptions,
} from './commands.js';
import { OksError, EXIT_CODES } from './errors.js';
import { formatJson } from './format/json.js';
import { formatToon } from './format/toon.js';
import { formatText } from './format/text.js';
import { formatMarkdown } from './format/md.js';
import type { Output } from './format/output.js';
import { parseFields } from './format/citation.js';
import { parsePositiveInt } from './util.js';

const VERSION = '0.1.0';

type Format = 'json' | 'toon' | 'text' | 'md';

export interface GlobalOptions {
  format?: Format;
  fields?: string;
  meta: boolean;
  apiKey?: string;
  baseUrl?: string;
  retry: number;
  timeoutMs: number;
  insecureTransport: boolean;
  fullTextSnippet: number;
  all?: boolean;
  maxItems?: number;
  pageDelay?: number;
}

function defaultFormat(): Format {
  return process.stdout.isTTY ? 'text' : 'json';
}

function formatArg(value: string): Format {
  if (value === 'json' || value === 'toon' || value === 'text' || value === 'md') return value;
  throw new InvalidArgumentError(`expected json, toon, text, or md (got ${JSON.stringify(value)})`);
}

function intArg(name: string, min = 1): (value: string) => number {
  return (value: string): number => {
    try {
      const n = parsePositiveInt(value, name);
      if (n < min) throw new RangeError(name);
      return n;
    } catch {
      throw new InvalidArgumentError(`${name} must be an integer >= ${min}`);
    }
  };
}

const program = new Command();

program
  .name('oks')
  .description(
    'Agent-optimized read-only CLI for the Oksskolten article archive.\n' +
      'Retrieves and formats research inputs; synthesis stays with the calling agent.',
  )
  .version(VERSION, '--version', 'show oks version')
  .configureHelp({ sortSubcommands: true })
  .exitOverride();

program
  .option('--format <fmt>', 'output format: json | toon | text | md (default: json when stdout is piped, text on a TTY)', formatArg)
  .option('--fields <list>', 'project article objects to these comma-separated fields (json/toon), e.g. id,url,title,published_at')
  .option('--no-meta', 'omit the trailing sources block from structured output')
  .option('--api-key <key>', 'API key (ok_…); prefer OKS_API_KEY or `oks config set api_key` — a flag value leaks to shell history')
  .option('--base-url <url>', `API base URL (default: ${DEFAULT_BASE_URL}; persist with \`oks config set base_url\`)`)
  .option('--retry <n>', 'automatic retries for 429/503/network failures', intArg('--retry', 0), 1)
  .option('--timeout <ms>', 'per-request timeout in milliseconds', intArg('--timeout'), 30000)
  .option('--full-text-snippet <n>', 'max full_text characters shown in text/md mode (0 = full)', intArg('--full-text-snippet', 0), 400)
  .option('--insecure-transport', 'allow plain http:// to non-localhost hosts (explicit opt-in)', false);

function warn(message: string): void {
  process.stderr.write(`oks: ${message}\n`);
}

/** Print a structured or plain error to stderr and exit with the documented code. */
function fail(err: OksError): never {
  const format = program.opts<GlobalOptions>().format;
  const structured = format === 'json' || format === 'toon';
  const payload: Record<string, unknown> = { error: err.message };
  if (err.status !== undefined) payload.status = err.status;
  if (err.hint) payload.hint = err.hint;
  if (structured) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`error: ${err.message}\n`);
    if (err.hint) process.stderr.write(`hint: ${err.hint}\n`);
  }
  process.exit(err.exitCode);
}

function makeClient(opts: GlobalOptions): ApiClient {
  const apiKey = requireApiKey(opts.apiKey);
  const baseUrl = resolveBaseUrl(opts.baseUrl, opts.insecureTransport);
  return new ApiClient({ baseUrl, apiKey, retry: opts.retry, timeoutMs: opts.timeoutMs });
}

function emit(out: Output, opts: GlobalOptions): void {
  const format = opts.format ?? defaultFormat();
  const noMeta = opts.meta === false;
  // Field projection applies to json/toon article objects only.
  const structuredOut: Output = { ...out, fields: parseFields(opts.fields) };
  switch (format) {
    case 'json':
      process.stdout.write(formatJson(structuredOut, { noMeta }));
      break;
    case 'toon':
      process.stdout.write(formatToon(structuredOut, { noMeta }));
      break;
    case 'md':
      process.stdout.write(formatMarkdown(out, { noMeta, fullTextSnippet: opts.fullTextSnippet }));
      break;
    default:
      process.stdout.write(formatText(out, { noMeta, fullTextSnippet: opts.fullTextSnippet }));
  }
}

async function runCommand(opts: GlobalOptions, action: (ctx: CommandContext) => Promise<Output>): Promise<void> {
  const client = makeClient(opts);
  const ctx: CommandContext = { client, warn };
  const out = await action(ctx);
  emit(out, opts);
}

// ── health ────────────────────────────────────────────────────────────────────
program
  .command('health')
  .description('Check API reachability and searchReady preflight (GET /api/health)')
  .action(async () => {
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdHealth(ctx));
  });

// ── feeds / categories ────────────────────────────────────────────────────────
program
  .command('feeds')
  .description('List feeds with topic→category mapping and article counts (GET /api/feeds)')
  .action(async () => {
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdFeeds(ctx));
  });

program
  .command('categories')
  .description('List the topic taxonomy (GET /api/categories)')
  .action(async () => {
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdCategories(ctx));
  });

// ── search ────────────────────────────────────────────────────────────────────
program
  .command('search <query>')
  .description('Full-text + semantic search, ≤50 per page (GET /api/articles/search)')
  .option('--feed <id>', 'restrict to a feed id', intArg('--feed'))
  .option('--category <id>', 'restrict to a category id', intArg('--category'))
  .option('--since <date>', 'ISO-8601 lower bound on published_at')
  .option('--until <date>', 'ISO-8601 upper bound on published_at')
  .option('--unread', 'only unread articles')
  .option('--liked', 'only liked articles')
  .option('--bookmarked', 'only bookmarked articles')
  .option('--limit <n>', `results per page (server max ${SEARCH_MAX_LIMIT})`, intArg('--limit'))
  .option('--offset <n>', 'pagination offset', intArg('--offset'))
  .option('--all', 'walk every page via has_more (safety-capped by --max-items)')
  .option('--max-items <n>', 'hard cap for --all walks', intArg('--max-items'), 2000)
  .option('--page-delay <ms>', 'delay between pages for --all', intArg('--page-delay', 0), 250)
  .action(async (query: string, cmdOpts: Record<string, unknown>) => {
    const opts: SearchOptions = {
      feed: cmdOpts.feed as number | undefined,
      category: cmdOpts.category as number | undefined,
      since: cmdOpts.since as string | undefined,
      until: cmdOpts.until as string | undefined,
      unread: cmdOpts.unread as boolean | undefined,
      liked: cmdOpts.liked as boolean | undefined,
      bookmarked: cmdOpts.bookmarked as boolean | undefined,
      limit: clampLimit(cmdOpts.limit as number | undefined, SEARCH_MAX_LIMIT, 'search', warn),
      offset: cmdOpts.offset as number | undefined,
      all: cmdOpts.all as boolean | undefined,
      maxItems: cmdOpts.maxItems as number | undefined,
      pageDelayMs: cmdOpts.pageDelay as number | undefined,
    };
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdSearch(ctx, query, opts));
  });

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('Browse articles chronologically or by score, ≤100 per page (GET /api/articles)')
  .option('--feed <id>', 'restrict to a feed id', intArg('--feed'))
  .option('--category <id>', 'restrict to a category id', intArg('--category'))
  .option('--unread', 'only unread articles')
  .option('--bookmarked', 'only bookmarked articles')
  .option('--liked', 'only liked articles')
  .option('--sort <field>', 'sort order, e.g. score')
  .option('--limit <n>', `results per page (server max ${LIST_MAX_LIMIT})`, intArg('--limit'))
  .option('--offset <n>', 'pagination offset', intArg('--offset'))
  .option('--no-floor', 'disable the smart floor (the server hides very old articles by default)')
  .option('--all', 'walk every page; implies --no-floor for a complete corpus walk (safety-capped by --max-items)')
  .option('--max-items <n>', 'hard cap for --all walks', intArg('--max-items'), 2000)
  .option('--page-delay <ms>', 'delay between pages for --all', intArg('--page-delay', 0), 250)
  .action(async (cmdOpts: Record<string, unknown>) => {
    const all = cmdOpts.all as boolean | undefined;
    if (all && !cmdOpts.noFloor) {
      warn('--all implies --no-floor so the walk covers the full corpus');
    }
    const opts: ListOptions = {
      feed: cmdOpts.feed as number | undefined,
      category: cmdOpts.category as number | undefined,
      unread: cmdOpts.unread as boolean | undefined,
      bookmarked: cmdOpts.bookmarked as boolean | undefined,
      liked: cmdOpts.liked as boolean | undefined,
      sort: cmdOpts.sort as string | undefined,
      limit: clampLimit(cmdOpts.limit as number | undefined, LIST_MAX_LIMIT, 'list', warn),
      offset: cmdOpts.offset as number | undefined,
      noFloor: (cmdOpts.noFloor as boolean | undefined) || all,
      all,
      maxItems: cmdOpts.maxItems as number | undefined,
      pageDelayMs: cmdOpts.pageDelay as number | undefined,
    };
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdList(ctx, opts));
  });

// ── get ───────────────────────────────────────────────────────────────────────
program
  .command('get <url>')
  .description('Fetch one article incl. full_text by URL (GET /api/articles/by-url)')
  .action(async (url: string) => {
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdGet(ctx, url));
  });

// ── similar ───────────────────────────────────────────────────────────────────
program
  .command('similar <id>')
  .description('Title-similarity neighbors for triangulation (GET /api/articles/:id/similar)')
  .action(async (id: string) => {
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdSimilar(ctx, id));
  });

// ── stats ─────────────────────────────────────────────────────────────────────
program
  .command('stats')
  .description('Corpus-size statistics for a time window (GET /api/stats)')
  .option('--since <date>', 'ISO-8601 lower bound')
  .option('--until <date>', 'ISO-8601 upper bound')
  .action(async (cmdOpts: Record<string, unknown>) => {
    await runCommand(
      program.opts<GlobalOptions>(),
      (ctx) =>
        cmdStats(ctx, {
          since: cmdOpts.since as string | undefined,
          until: cmdOpts.until as string | undefined,
        }),
    );
  });

// ── check ─────────────────────────────────────────────────────────────────────
program
  .command('check <urls...>')
  .description('Check which candidate URLs are already in the corpus (POST /api/articles/check-urls; needs a read,write key)')
  .addHelpText(
    'after',
    'Note: the only non-GET command; requires an API key with write scope.\n' +
      'With a read-only key the server responds 403 and oks exits with code 4.',
  )
  .action(async (urls: string[]) => {
    await runCommand(program.opts<GlobalOptions>(), (ctx) => cmdCheck(ctx, urls));
  });

// ── config ────────────────────────────────────────────────────────────────────
const config = program
  .command('config')
  .description('Persist base_url and api_key (stored 0600 in the oks config file)');

config
  .command('set <key> <value>')
  .description('Set base_url or api_key')
  .action((key: string, value: string) => {
    if (!isConfigKey(key)) {
      throw new OksError(`unknown config key ${JSON.stringify(key)} (expected base_url or api_key)`, EXIT_CODES.badRequest);
    }
    const normalized = normalizeConfigValue(key, value);
    saveConfig({ [key]: normalized });
    if (key === 'api_key') {
      warn(`api_key stored (${redactKey(normalized)})`);
    } else {
      warn(`${key} set to ${normalized}`);
    }
  });

config
  .command('get <key>')
  .description('Print a config value (api_key is redacted)')
  .action((key: string) => {
    if (!isConfigKey(key)) {
      throw new OksError(`unknown config key ${JSON.stringify(key)} (expected base_url or api_key)`, EXIT_CODES.badRequest);
    }
    const value = loadConfig()[key];
    if (value === undefined) {
      process.stderr.write(`${key} is not set\n`);
      process.exit(EXIT_CODES.notFound);
    }
    process.stdout.write(`${key === 'api_key' ? redactKey(value) : value}\n`);
  });

config
  .command('list')
  .description('Print the effective configuration (api_key redacted)')
  .action(() => {
    const stored = loadConfig();
    const effectiveKey = resolveApiKey();
    process.stdout.write(
      `${JSON.stringify(
        {
          base_url: resolveBaseUrl(),
          api_key: effectiveKey ? redactKey(effectiveKey) : '(none)',
          api_key_source: effectiveKey
            ? process.env.OKS_API_KEY
              ? 'OKS_API_KEY'
              : process.env.OKSSKOLTEN_API_KEY
                ? 'OKSSKOLTEN_API_KEY'
                : 'config file'
            : '(none)',
          config_path: configPath(),
          stored: {
            base_url: stored.base_url,
            api_key: stored.api_key ? redactKey(stored.api_key) : undefined,
          },
        },
        null,
        2,
      )}\n`,
    );
  });

config
  .command('unset <key>')
  .description('Remove a config key')
  .action((key: string) => {
    if (!isConfigKey(key)) {
      throw new OksError(`unknown config key ${JSON.stringify(key)} (expected base_url or api_key)`, EXIT_CODES.badRequest);
    }
    if (unsetConfigKey(key)) {
      warn(`${key} removed`);
    } else {
      process.stderr.write(`${key} was not set\n`);
      process.exit(EXIT_CODES.notFound);
    }
  });

// ── dispatch ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help/version print to stdout with code 0; usage errors were already
      // displayed by commander and map to the documented validation code.
      process.exit(err.exitCode === 0 ? EXIT_CODES.ok : EXIT_CODES.badRequest);
    }
    if (err instanceof OksError) fail(err);
    if (err instanceof InvalidArgumentError || err instanceof TypeError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(EXIT_CODES.badRequest);
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT_CODES.unexpected);
  }
}

// Execute only when the entry is invoked directly (bin entry); tests import this
// module without side effects. Compare realpaths, not raw strings: `npm link` and
// global installs reach the bin through a symlink, so process.argv[1] keeps the
// invoked (link) path while import.meta.url is already the entry's realpath — a
// raw comparison failed and every command silently exited 0.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function isDirectEntry(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const entry = fileURLToPath(import.meta.url);
  try {
    return realpathSync(invoked) === realpathSync(entry);
  } catch {
    // argv[1] no longer resolves (deleted file): fall back to the raw comparison.
    return invoked === entry;
  }
}

if (isDirectEntry()) {
  await main();
}
