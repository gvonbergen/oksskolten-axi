# @oksskolten/cli — `oks`

Agent-optimized, **read-only** command-line access to the Oksskolten article
archive. `oks` retrieves and formats research inputs through the authenticated
Oksskolten HTTPS API; **synthesis stays with the calling agent** — the CLI never
summarizes, ranks, or researches on its own.

- Node ≥ 22, single executable, tiny dependency footprint
- Structured output: `json` (lossless default when piped), `toon` (token-lean),
  `text` and `md` (humans)
- Citation fields (`id`, `url`, `feed_name`, `published_at`) preserved verbatim
  on every article-bearing record, plus a `sources` block for one-copy
  citations
- Clean separation: stdout carries only the payload; all diagnostics go to
  stderr — `oks search … | jq` just works
- Self-throttled (~120 req/min), honors `Retry-After`, bounded `--all` walks

## Install

`@oksskolten/cli` is **not yet published to the npm registry** — today
`npm install -g @oksskolten/cli` and `npx @oksskolten/cli` return 404. Install
from a source checkout instead:

```sh
git clone https://github.com/gvonbergen/oksskolten-axi.git
cd oksskolten-axi
npm install
npm run build                           # tsc → dist/
node dist/cli.js --help                 # sanity check the built CLI
```

Run the built entry as `oks` — the entrypoint compares resolved real
paths, so a symlinked bin is fine (a plain `npm link`-style install works
now); a thin wrapper is optional belt-and-braces:

```sh
# ~/.local/bin/oks (chmod +x)
#!/bin/sh
exec node "$HOME/oksskolten-axi/dist/cli.js" "$@"
```

Requires Node.js 22 or newer.

## Configuration

Nothing production-specific is baked in. The default base URL is
`http://localhost:3000`; point it at the production HTTPS API with `oks config`:

```sh
oks config set base_url https://oksskolten.example.com
oks config set api_key ok_…          # key from Oksskolten Settings → Security → API Tokens
```

The config file lives at `$XDG_CONFIG_HOME/oks/config.json` (default
`~/.config/oks/config.json`) and is created with `0600` permissions. Use a
**read-only** key; every command except `oks check` works with read scope.

API key resolution order:

1. `--api-key` (discouraged — leaks to shell history)
2. `OKS_API_KEY` environment variable
3. `OKSSKOLTEN_API_KEY` environment variable (alias)
4. config file (`oks config set api_key ok_…`)

The key is never logged, echoed in errors, or included in `sources`.
`oks config list` always prints it redacted.

### Transport security

- `https://` is accepted everywhere.
- Plain `http://` is accepted **only** for `localhost` / `127.0.0.1` (the
  default dev target). Any other `http://` base URL requires an explicit
  `--insecure-transport` opt-in.

## Commands (v1 — read-only)

| Command | Endpoint | Purpose |
|---|---|---|
| `oks health` | `GET /api/health` | Reachability + `searchReady` preflight |
| `oks feeds` | `GET /api/feeds` | Topic→feed mapping with article counts |
| `oks categories` | `GET /api/categories` | Topic taxonomy |
| `oks search <q>` | `GET /api/articles/search` | Full-text + semantic retrieval (≤50/page) |
| `oks list` | `GET /api/articles` | Chronological/score browsing (≤100/page) |
| `oks get <url>` | `GET /api/articles/by-url` | Full text for one article (the citation payload) |
| `oks similar <id>` | `GET /api/articles/:id/similar` | Title-similarity neighbors for triangulation |
| `oks stats` | `GET /api/stats` | Corpus-size sanity checks (`--since`/`--until`) |
| `oks check <url…>` | `POST /api/articles/check-urls` | Which candidate URLs are already in the corpus (needs a `read,write` key; ≤200 URLs) |
| `oks config get/set/list/unset` | — | Persist `base_url` / `api_key` |

Deliberately excluded: mutation commands (seen/bookmark/like/clip),
summarization, translation. Those belong to the app and the calling agent.

### Options

Global (work on every API command):

```
--format json|toon|text|md   output format (default: json when piped, text on a TTY)
--fields id,url,title,…      project article objects (json/toon)
--no-meta                    omit the trailing sources block
--api-key <key>              override the key for this invocation
--base-url <url>             override the base URL for this invocation
--retry <n>                  automatic retries for 429/503/network (default 1)
--timeout <ms>               per-request timeout (default 30000)
--full-text-snippet <n>      max full_text chars in text/md (0 = full; default 400)
--insecure-transport         allow plain http:// to non-local hosts
```

Pagination (`search`, `list`):

```
--limit <n> / --offset <n>   page through results (clamped to the server cap with a warning)
--all                        walk every page (list: implies --no-floor, documented)
--max-items <n>              hard safety cap for --all (default 2000)
--page-delay <ms>            delay between pages (default 250)
```

## Output

Every article-bearing result ends with a `sources` block mirroring the records'
citation fields, so downstream citation is one copy-paste away:

```json
{
  "article": {
    "id": 123, "title": "…", "url": "https://…",
    "feed_name": "Cloudflare Blog", "published_at": "2025-02-26T00:00:00Z",
    "lang": "en", "summary": "…", "full_text": "# …"
  },
  "sources": [
    { "id": 123, "url": "https://…", "feed_name": "Cloudflare Blog",
      "published_at": "2025-02-26T00:00:00Z" }
  ]
}
```

`--no-meta` suppresses the block. Nothing is ever truncated silently in
JSON/TOON; human `text`/`md` mode elides long `full_text` with an explicit
`…[truncated N chars; use --format json]` marker.

## Agent recipe: research a topic

```sh
oks categories
oks feeds
oks search "cache poisoning" --since 2025-01-01 --limit 20
oks get https://blog.example.org/cache-poisoning      # full text, per article
oks similar 123                                        # triangulate
# …synthesize from the retrieved full_text in the calling agent
```

Corpus-wide walk (bounded):

```sh
oks list --all --max-items 2000
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected internal error |
| 2 | Bad request / validation (CLI or server 400) |
| 3 | Missing or invalid API key (401) |
| 4 | Key lacks required scope (403), e.g. read-only key with `oks check` |
| 5 | Not found (404) |
| 6 | Rate limited (429) after automatic retries |
| 7 | Search index still building (503) — see `oks health` |
| 8 | Network/TLS/timeout or unmapped 5xx failure |

Error payloads go to stderr as JSON (`{"error": …, "status": …, "hint": …}`)
when `--format json|toon`, plain text otherwise. Command-line usage errors exit
with code 2.

## Rate limiting

The server's global limit is 300 req/min per IP. The CLI self-throttles to a
conservative ~120 req/min (500 ms spacing), serializes `--all` pages with a
per-page delay, honors `Retry-After` on 429, and applies jittered exponential
backoff with one automatic retry by default (`--retry` to change).

## Development

```sh
npm install
npm run typecheck     # strict TypeScript
npm test              # vitest: unit + fixture contract tests (no network)
npm run build         # tsc → dist/
```

API response shapes are pinned by recorded fixtures in `test/fixtures/`; if the
server API drifts from the CLI's typed client, the contract tests fail in CI.

## Status

v0.1 — nine read-only commands over the existing documented API. No server
changes are required or included.
