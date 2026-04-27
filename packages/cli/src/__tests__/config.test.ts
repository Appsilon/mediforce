import { describe, it, expect } from 'vitest';
import {
  resolveApiKey,
  resolveBaseUrl,
  resolveConfig,
  DEFAULT_BASE_URL,
} from '../config.js';

describe('resolveApiKey', () => {
  it('prefers MEDIFORCE_API_KEY over PLATFORM_API_KEY', () => {
    expect(
      resolveApiKey({ MEDIFORCE_API_KEY: 'm', PLATFORM_API_KEY: 'p' }),
    ).toBe('m');
  });

  it('falls back to PLATFORM_API_KEY when MEDIFORCE_API_KEY is unset', () => {
    expect(resolveApiKey({ PLATFORM_API_KEY: 'p' })).toBe('p');
  });

  it('falls back to PLATFORM_API_KEY when MEDIFORCE_API_KEY is the empty string', () => {
    expect(
      resolveApiKey({ MEDIFORCE_API_KEY: '', PLATFORM_API_KEY: 'p' }),
    ).toBe('p');
  });

  it('throws when neither variable is set', () => {
    expect(() => resolveApiKey({})).toThrow(/MEDIFORCE_API_KEY/);
  });
});

describe('resolveBaseUrl', () => {
  it('prefers the --base-url flag over the env var', () => {
    expect(
      resolveBaseUrl({
        flagBaseUrl: 'https://flag.example.com',
        env: { MEDIFORCE_BASE_URL: 'https://env.example.com' },
      }),
    ).toBe('https://flag.example.com');
  });

  it('falls back to MEDIFORCE_BASE_URL when no flag is given', () => {
    expect(
      resolveBaseUrl({ env: { MEDIFORCE_BASE_URL: 'https://env.example.com' } }),
    ).toBe('https://env.example.com');
  });

  it('falls back to the default when neither flag nor env is set', () => {
    expect(resolveBaseUrl({ env: {} })).toBe(DEFAULT_BASE_URL);
  });

  it('treats an empty flag value as unset', () => {
    expect(
      resolveBaseUrl({
        flagBaseUrl: '',
        env: { MEDIFORCE_BASE_URL: 'https://env.example.com' },
      }),
    ).toBe('https://env.example.com');
  });
});

describe('resolveConfig', () => {
  it('combines apiKey + baseUrl resolution', () => {
    const config = resolveConfig({
      flagBaseUrl: 'https://flag',
      env: { MEDIFORCE_API_KEY: 'k' },
    });
    expect(config).toEqual({ apiKey: 'k', baseUrl: 'https://flag' });
  });
});
