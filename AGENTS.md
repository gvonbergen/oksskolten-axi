# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## Project notes

- `@oksskolten/cli` is NOT published to npm (registry is a gray area); install docs (README "Install") point at a source checkout. Don't restore `npm install -g`/`npx` claims until a tag is actually published.
- The bin entry `dist/cli.js` only runs via its real path: `src/cli.ts` gates on `process.argv[1] === fileURLToPath(import.meta.url)`, but npm creates symlinked bins — so `npm link` / `npm install -g .` yield a silent no-op (`exit 0`, no output). Use the README's PATH wrapper (or `node <realpath>/dist/cli.js`) instead.
- `oks` CLI (this repo, `src/`): read-only Oksskolten API client. Build: `npm run build` (tsc → dist/); test: `npm test` (vitest, no network); typecheck: `npm run typecheck`. Node ≥ 22, ESM, strict TS.
- API response types in `src/types.ts` are deliberately duplicated from the server repo (docs/spec/20_api.md) to keep this package decoupled; `test/fixtures/` + `test/contract.test.ts` pin the shapes — update fixtures together with type changes.
- Exit codes are a documented contract (README "Exit codes", `src/errors.ts`); adding error paths means updating both.
- Never bake a production URL into the code: default base URL stays `http://localhost:3000`, configured via `oks config set base_url`. Plain http is accepted for loopback hosts only.
- The API key must never appear in logs, errors, or output; use `redactKey()` (`src/config.ts`).
