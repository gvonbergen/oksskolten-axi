import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configPath,
  DEFAULT_BASE_URL,
  loadConfig,
  normalizeConfigValue,
  redactKey,
  resolveApiKey,
  resolveBaseUrl,
  saveConfig,
  unsetConfigKey,
} from '../src/config.js';

// Each test gets an isolated XDG config dir; state is restored afterwards.
let tmpDir: string;
const savedEnv = { ...process.env };

function useTmpConfigDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'oks-config-'));
  process.env.XDG_CONFIG_HOME = tmpDir;
  return tmpDir;
}

afterEach(() => {
  process.env = { ...savedEnv };
  delete process.env.OKS_API_KEY;
  delete process.env.OKSSKOLTEN_API_KEY;
  delete process.env.OKS_BASE_URL;
  delete process.env.XDG_CONFIG_HOME;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

describe('resolveApiKey', () => {
  it('prefers --api-key over env and config file', () => {
    useTmpConfigDir();
    saveConfig({ api_key: 'ok_config' });
    process.env.OKS_API_KEY = 'ok_env';
    process.env.OKSSKOLTEN_API_KEY = 'ok_alias';
    expect(resolveApiKey('ok_flag')).toBe('ok_flag');
    expect(resolveApiKey()).toBe('ok_env');
  });

  it('falls back through OKS_API_KEY, alias, then config file', () => {
    useTmpConfigDir();
    saveConfig({ api_key: 'ok_config' });
    process.env.OKSSKOLTEN_API_KEY = 'ok_alias';
    expect(resolveApiKey()).toBe('ok_alias');
    delete process.env.OKSSKOLTEN_API_KEY;
    expect(resolveApiKey()).toBe('ok_config');
  });

  it('returns null when nothing is configured', () => {
    useTmpConfigDir();
    expect(resolveApiKey()).toBeNull();
  });
});

describe('redactKey', () => {
  it('never reveals key material', () => {
    const key = 'ok_deadbeefcafe1234';
    const shown = redactKey(key);
    expect(shown).not.toContain('deadbeef');
    expect(shown).toContain('redacted');
  });
});

describe('resolveBaseUrl', () => {
  it('defaults to http://localhost:3000 with no production URL baked in', () => {
    useTmpConfigDir();
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toMatch(/^http:\/\/(localhost|127\.0\.0\.1)/);
  });

  it('accepts plain http for loopback hosts only', () => {
    expect(resolveBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080');
    expect(resolveBaseUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(() => resolveBaseUrl('http://api.example.com')).toThrow(/refusing plain http/);
    expect(resolveBaseUrl('http://api.example.com', true)).toBe('http://api.example.com');
  });

  it('accepts https anywhere and normalizes trailing slashes', () => {
    expect(resolveBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('rejects non-http protocols and garbage', () => {
    expect(() => resolveBaseUrl('ftp://api.example.com')).toThrow(/protocol/);
    expect(() => resolveBaseUrl('not a url')).toThrow(/invalid base URL/);
  });

  it('prefers flag over OKS_BASE_URL over config file', () => {
    useTmpConfigDir();
    saveConfig({ base_url: 'https://config.example.com' });
    process.env.OKS_BASE_URL = 'https://env.example.com';
    expect(resolveBaseUrl()).toBe('https://env.example.com');
    expect(resolveBaseUrl('https://flag.example.com')).toBe('https://flag.example.com');
  });
});

describe('config file', () => {
  it('is created with 0600 permissions and round-trips', () => {
    const dir = useTmpConfigDir();
    saveConfig({ api_key: 'ok_0123456789abcdef' });
    const path = configPath();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadConfig().api_key).toBe('ok_0123456789abcdef');
    expect(path.startsWith(dir)).toBe(true);
  });

  it('normalizes api_key strictly', () => {
    expect(() => normalizeConfigValue('api_key', 'hunter2')).toThrow(/ok_/);
    expect(normalizeConfigValue('api_key', ' ok_0123456789abcdef ')).toBe('ok_0123456789abcdef');
  });

  it('normalizes base_url through the transport rules', () => {
    expect(normalizeConfigValue('base_url', 'https://api.example.com/')).toBe('https://api.example.com');
    expect(() => normalizeConfigValue('base_url', 'http://insecure.example.com')).toThrow(/refusing plain http/);
  });

  it('unsets keys', () => {
    useTmpConfigDir();
    saveConfig({ api_key: 'ok_0123456789abcdef' });
    expect(unsetConfigKey('api_key')).toBe(true);
    expect(loadConfig().api_key).toBeUndefined();
    expect(unsetConfigKey('api_key')).toBe(false);
  });

  it('treats a corrupt config file as empty instead of crashing', () => {
    const dir = useTmpConfigDir();
    mkdirSync(join(dir, 'oks'), { recursive: true });
    writeFileSync(configPath(), '{not json');
    expect(loadConfig()).toEqual({});
  });
});
