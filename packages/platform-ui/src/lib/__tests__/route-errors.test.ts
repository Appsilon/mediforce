import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { classifyError } from '../route-errors.js';

describe('classifyError', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Firebase Admin credentials error', () => {
    const err = new Error('Unable to detect a Project Id in the current environment.');

    it('returns 500 with "credentials missing" body', () => {
      const result = classifyError(err);
      expect(result.status).toBe(500);
      expect(result.body.error).toMatch(/credentials missing/);
    });

    it('includes hint in dev', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const result = classifyError(err);
      expect(result.body.hint).toBeDefined();
      expect(result.body.hint).toMatch(/firebase-credentials/);
    });

    it('omits hint in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const result = classifyError(err);
      expect(result.body.hint).toBeUndefined();
    });

    it('matches on code=app/no-app too', () => {
      const coded = Object.assign(new Error('boom'), { code: 'app/no-app' });
      const result = classifyError(coded);
      expect(result.status).toBe(500);
      expect(result.body.error).toMatch(/credentials missing/);
    });
  });

  describe('auth/id-token-expired', () => {
    it('returns 401 "Session expired"', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const err = Object.assign(new Error('expired'), {
        code: 'auth/id-token-expired',
      });
      const result = classifyError(err);
      expect(result.status).toBe(401);
      expect(result.body.error).toBe('Session expired');
      expect(result.body.hint).toBe('Sign in again');
    });
  });

  describe('arbitrary error', () => {
    it('returns generic "Internal error" with no hint leaked', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const result = classifyError(new Error('something blew up'));
      expect(result.status).toBe(500);
      expect(result.body.error).toBe('Internal error');
      expect(result.body.hint).toBeUndefined();
    });

    it('handles non-Error inputs', () => {
      const result = classifyError('not an error');
      expect(result.body.error).toBe('Internal error');
    });
  });
});
