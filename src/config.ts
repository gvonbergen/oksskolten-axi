import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { AuthError, ValidationError } from './errors.js';

export const DEFAULT_BASE_URL = 'http://localhost:3000';
export const USER_AGENT = 'oks-cli';

export interface OksConfigFile {
  base_url?: string;
  api_key?: string;
}

/** Config directory: $XDG_CONFIG_HOME/oks or ~/.config/oks. */
export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'oks');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export function loadConfig(): OksConfigFile {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as OksConfigFile;
  } catch {
    // A corrupt config file must not crash every command; treat as empty.
    return {};
  }
}

/** Merge a patch into the config file, creating it with 0600 permissions. */
export function saveConfig(patch: OksConfigFile): void {
  const merged = { ...loadConfig(), ...patch };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
}

export function unsetConfigKey(key: keyof OksConfigFile): boolean {
  const current = loadConfig();
  if (!(key in current)) return false;
  const { [key]: _removed, ...rest } = current;
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(rest, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort.
  }
  return true;
}

/**
 * Resolve the API key. Priority:
 *   --api-key flag > OKS_API_KEY > OKSSKOLTEN_API_KEY > config file.
 * Returns null when no key is configured.
 */
export function resolveApiKey(flagValue?: string): string | null {
  const candidates = [
    flagValue,
    process.env.OKS_API_KEY,
    process.env.OKSSKOLTEN_API_KEY,
    loadConfig().api_key,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Redact an API key for display. Never reveals any key material. */
export function redactKey(key: string): string {
  if (!key) return '(none)';
  return 'ok_…(redacted)';
}

/** Require a key, raising the documented auth error when absent. */
export function requireApiKey(flagValue?: string): string {
  const key = resolveApiKey(flagValue);
  if (!key) {
    throw new AuthError(
      'no API key configured',
      'run `oks config set api_key ok_…` (created in Oksskolten Settings → Security → API Tokens) or set OKS_API_KEY',
    );
  }
  return key;
}

export function resolveBaseUrl(flagValue?: string, insecureTransport = false): string {
  const raw = (flagValue || process.env.OKS_BASE_URL || loadConfig().base_url || DEFAULT_BASE_URL).trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`invalid base URL: ${JSON.stringify(raw)}`, 'expected an absolute URL, e.g. http://localhost:3000');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError(`unsupported base URL protocol: ${parsed.protocol}`, 'use https:// (or http:// for localhost)');
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname) && !insecureTransport) {
    throw new ValidationError(
      `refusing plain http:// to non-local host ${parsed.hostname}`,
      'use https://, or pass --insecure-transport to accept the risk explicitly',
    );
  }
  // Normalize: no trailing slash, no credentials in URL.
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.username = '';
  parsed.password = '';
  return parsed.toString().replace(/\/$/, '');
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
}

const CONFIG_KEYS = ['base_url', 'api_key'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

/** Validate and normalize a value destined for the config file. */
export function normalizeConfigValue(key: ConfigKey, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`empty value for ${key}`);
  if (key === 'api_key') {
    if (!/^ok_[0-9a-f]{8,}$/i.test(trimmed)) {
      throw new ValidationError('api_key must look like ok_<hex>', 'create a key in Oksskolten Settings → Security → API Tokens');
    }
    return trimmed;
  }
  if (key === 'base_url') {
    return resolveBaseUrl(trimmed);
  }
  return trimmed;
}
