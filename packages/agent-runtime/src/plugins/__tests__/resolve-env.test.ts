import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveValue } from '../resolve-env.js';

describe('resolveValue', () => {
  describe('literal values', () => {
    it('[DATA] passes through plain string unchanged', () => {
      expect(resolveValue('hello')).toBe('hello');
    });

    it('[DATA] passes through empty string unchanged', () => {
      expect(resolveValue('')).toBe('');
    });

    it('[DATA] passes through string with braces that are not template syntax', () => {
      expect(resolveValue('{{incomplete')).toBe('{{incomplete');
    });

    it('[DATA] passes through string with numeric chars in template position', () => {
      expect(resolveValue('prefix_{{FOO}}_suffix')).toBe('prefix_{{FOO}}_suffix');
    });

    it('[DATA] passes through URL-like strings unchanged', () => {
      expect(resolveValue('https://example.com/path')).toBe('https://example.com/path');
    });
  });

  describe('workflowSecrets resolution', () => {
    it('[DATA] resolves {{FOO}} from workflowSecrets', () => {
      const secrets = { FOO: 'secret-value' };
      expect(resolveValue('{{FOO}}', secrets)).toBe('secret-value');
    });

    it('[DATA] resolves {{FOO}} from workflowSecrets when process.env also has FOO', () => {
      const originalEnv = process.env.FOO;
      process.env.FOO = 'env-value';
      try {
        const secrets = { FOO: 'secret-value' };
        expect(resolveValue('{{FOO}}', secrets)).toBe('secret-value');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.FOO;
        } else {
          process.env.FOO = originalEnv;
        }
      }
    });

    it('[DATA] resolves {{API_KEY}} when workflowSecrets contains the key', () => {
      const secrets = { API_KEY: 'my-api-key-123' };
      expect(resolveValue('{{API_KEY}}', secrets)).toBe('my-api-key-123');
    });
  });

  describe('process.env fallback', () => {
    let originalFoo: string | undefined;

    beforeEach(() => {
      originalFoo = process.env.MY_SECRET;
      delete process.env.MY_SECRET;
      delete process.env.DOCKER_MY_SECRET;
    });

    afterEach(() => {
      if (originalFoo === undefined) {
        delete process.env.MY_SECRET;
      } else {
        process.env.MY_SECRET = originalFoo;
      }
      delete process.env.DOCKER_MY_SECRET;
    });

    it('[DATA] resolves {{MY_SECRET}} from process.env when no workflowSecrets provided', () => {
      process.env.MY_SECRET = 'from-process-env';
      expect(resolveValue('{{MY_SECRET}}')).toBe('from-process-env');
    });

    it('[DATA] resolves {{MY_SECRET}} from process.env when workflowSecrets does not contain the key', () => {
      process.env.MY_SECRET = 'from-process-env';
      expect(resolveValue('{{MY_SECRET}}', { OTHER_KEY: 'other' })).toBe('from-process-env');
    });

    it('[DATA] resolves {{MY_SECRET}} from process.env.DOCKER_MY_SECRET fallback', () => {
      process.env.DOCKER_MY_SECRET = 'from-docker-env';
      expect(resolveValue('{{MY_SECRET}}')).toBe('from-docker-env');
    });

    it('[DATA] prefers process.env over DOCKER_ prefixed when both set', () => {
      process.env.MY_SECRET = 'direct-env';
      process.env.DOCKER_MY_SECRET = 'docker-env';
      expect(resolveValue('{{MY_SECRET}}')).toBe('direct-env');
    });
  });

  describe('workflowSecrets priority over process.env', () => {
    it('[DATA] workflowSecrets takes priority over process.env', () => {
      const originalEnv = process.env.PRIORITY_TEST;
      process.env.PRIORITY_TEST = 'env-value';
      try {
        const secrets = { PRIORITY_TEST: 'secrets-value' };
        expect(resolveValue('{{PRIORITY_TEST}}', secrets)).toBe('secrets-value');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.PRIORITY_TEST;
        } else {
          process.env.PRIORITY_TEST = originalEnv;
        }
      }
    });

    it('[DATA] falls through to process.env when workflowSecrets entry is empty string', () => {
      const originalEnv = process.env.EMPTY_SECRET;
      process.env.EMPTY_SECRET = 'env-fallback';
      try {
        const secrets = { EMPTY_SECRET: '' };
        expect(resolveValue('{{EMPTY_SECRET}}', secrets)).toBe('env-fallback');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.EMPTY_SECRET;
        } else {
          process.env.EMPTY_SECRET = originalEnv;
        }
      }
    });
  });

  describe('error cases', () => {
    it('[ERROR] throws when {{FOO}} cannot be resolved from any source', () => {
      const originalFoo = process.env.UNRESOLVABLE_VAR;
      delete process.env.UNRESOLVABLE_VAR;
      delete process.env.DOCKER_UNRESOLVABLE_VAR;
      try {
        expect(() => resolveValue('{{UNRESOLVABLE_VAR}}')).toThrow(
          /UNRESOLVABLE_VAR/,
        );
      } finally {
        if (originalFoo !== undefined) {
          process.env.UNRESOLVABLE_VAR = originalFoo;
        }
      }
    });

    it('[ERROR] throws with message mentioning secret name and resolution options', () => {
      const originalFoo = process.env.MISSING_KEY;
      delete process.env.MISSING_KEY;
      delete process.env.DOCKER_MISSING_KEY;
      try {
        expect(() => resolveValue('{{MISSING_KEY}}')).toThrow(
          /MISSING_KEY/,
        );
      } finally {
        if (originalFoo !== undefined) {
          process.env.MISSING_KEY = originalFoo;
        }
      }
    });

    it('[ERROR] throws when workflowSecrets provided but key absent and env not set', () => {
      const originalFoo = process.env.NOT_IN_SECRETS;
      delete process.env.NOT_IN_SECRETS;
      delete process.env.DOCKER_NOT_IN_SECRETS;
      try {
        const secrets = { OTHER_KEY: 'some-value' };
        expect(() => resolveValue('{{NOT_IN_SECRETS}}', secrets)).toThrow(
          /NOT_IN_SECRETS/,
        );
      } finally {
        if (originalFoo !== undefined) {
          process.env.NOT_IN_SECRETS = originalFoo;
        }
      }
    });
  });
});
