import { ApiError } from '@mediforce/platform-api/client';
import { describe, expect, it } from 'vitest';
import { formatCliError } from '../errors.js';

describe('formatCliError', () => {
  it('formats connection refused errors with the target URL and dev-server hint', () => {
    const error = new TypeError('fetch failed', {
      cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 9003 },
    });

    expect(formatCliError(error, { baseUrl: 'http://localhost:9003' })).toMatchObject({
      error: 'Cannot reach Mediforce API at http://localhost:9003',
      cause: {
        code: 'ECONNREFUSED',
        message: 'connection refused',
        address: '127.0.0.1',
        port: 9003,
      },
      hints: expect.arrayContaining([
        'Is the dev server running? Start with: pnpm dev:local',
      ]),
    });
  });

  it('formats DNS failures as hostname resolution errors', () => {
    const error = new TypeError('fetch failed', {
      cause: { code: 'ENOTFOUND', hostname: 'does-not-exist.invalid' },
    });

    expect(formatCliError(error, { baseUrl: 'https://does-not-exist.invalid' })).toMatchObject({
      error: 'Cannot resolve Mediforce API host for https://does-not-exist.invalid',
      cause: {
        code: 'ENOTFOUND',
        message: 'hostname not resolvable',
        hostname: 'does-not-exist.invalid',
      },
    });
  });

  it('formats timeout failures distinctly', () => {
    const error = new TypeError('fetch failed', {
      cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
    });

    expect(formatCliError(error, { baseUrl: 'https://staging.mediforce.ai' })).toMatchObject({
      error: 'Cannot reach Mediforce API at https://staging.mediforce.ai',
      cause: {
        code: 'UND_ERR_CONNECT_TIMEOUT',
        message: 'server unreachable, took too long',
      },
    });
  });

  it('formats TLS failures as certificate problems', () => {
    const error = new TypeError('fetch failed', {
      cause: { code: 'CERT_HAS_EXPIRED' },
    });

    expect(formatCliError(error, { baseUrl: 'https://expired.badssl.com' })).toMatchObject({
      error: 'Certificate problem reaching Mediforce API at https://expired.badssl.com',
      cause: {
        code: 'CERT_HAS_EXPIRED',
        message: 'certificate problem',
      },
    });
  });

  it('adds API key hints for auth failures', () => {
    expect(
      formatCliError(new ApiError(401, 'Unauthorized', { error: 'Unauthorized' }), {
        baseUrl: 'http://localhost:9003',
      }),
    ).toMatchObject({
      status: 401,
      hints: expect.arrayContaining(['Set MEDIFORCE_API_KEY to a valid API key.']),
    });

    expect(
      formatCliError(new ApiError(403, 'Forbidden', { error: 'Forbidden' }), {
        baseUrl: 'http://localhost:9003',
      }),
    ).toMatchObject({
      status: 403,
      hints: expect.arrayContaining(['Check that MEDIFORCE_API_KEY is valid for this workspace.']),
    });
  });

  it('hints when a 404 looks like the base URL is not the API host', () => {
    expect(formatCliError(new ApiError(404, 'Not found', {}), { baseUrl: 'https://example.com' }))
      .toMatchObject({
        status: 404,
        hints: expect.arrayContaining([
          'The base URL may be wrong. Point MEDIFORCE_BASE_URL at a Mediforce API host.',
        ]),
      });
  });
});
