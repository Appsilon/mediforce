import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveStepEnv, validateWorkflowEnv, resolveValue } from '../resolve-env.js';

describe('resolve-env', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clean env between tests
    delete process.env['TEST_SECRET'];
    delete process.env['DOCKER_TEST_SECRET'];
    delete process.env['API_KEY'];
    delete process.env['DOCKER_API_KEY'];
    delete process.env['DB_URL'];
    delete process.env['DOCKER_DB_URL'];
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  // ---------------------------------------------------------------------------
  // resolveStepEnv
  // ---------------------------------------------------------------------------
  describe('resolveStepEnv', () => {
    it('passes literal values through unchanged', () => {
      const result = resolveStepEnv(undefined, { NODE_ENV: 'production' });
      expect(result.vars).toEqual({ NODE_ENV: 'production' });
      expect(result.injectedKeys).toEqual(['NODE_ENV']);
    });

    it('resolves {{TEMPLATE}} from workflow secrets', () => {
      const result = resolveStepEnv(
        undefined,
        { API_KEY: '{{API_KEY}}' },
        { API_KEY: 'secret-from-firestore' },
      );
      expect(result.vars).toEqual({ API_KEY: 'secret-from-firestore' });
    });

    it('resolves {{TEMPLATE}} from process.env when not in workflow secrets', () => {
      process.env['API_KEY'] = 'from-server-env';
      const result = resolveStepEnv(undefined, { API_KEY: '{{API_KEY}}' });
      expect(result.vars).toEqual({ API_KEY: 'from-server-env' });
    });

    it('resolves {{TEMPLATE}} from DOCKER_ prefixed process.env as fallback', () => {
      process.env['DOCKER_API_KEY'] = 'from-docker-env';
      const result = resolveStepEnv(undefined, { API_KEY: '{{API_KEY}}' });
      expect(result.vars).toEqual({ API_KEY: 'from-docker-env' });
    });

    it('prefers workflow secrets over process.env', () => {
      process.env['API_KEY'] = 'from-server';
      const result = resolveStepEnv(
        undefined,
        { API_KEY: '{{API_KEY}}' },
        { API_KEY: 'from-workflow' },
      );
      expect(result.vars).toEqual({ API_KEY: 'from-workflow' });
    });

    it('skips empty workflow secret and falls back to process.env', () => {
      process.env['API_KEY'] = 'from-server';
      const result = resolveStepEnv(
        undefined,
        { API_KEY: '{{API_KEY}}' },
        { API_KEY: '' },
      );
      expect(result.vars).toEqual({ API_KEY: 'from-server' });
    });

    it('throws when template cannot be resolved from any source', () => {
      expect(() => resolveStepEnv(undefined, { API_KEY: '{{API_KEY}}' })).toThrow(
        /secret "API_KEY" which is not set/,
      );
    });

    it('merges config-level and step-level env (step overrides config)', () => {
      process.env['DB_URL'] = 'db://host';
      process.env['API_KEY'] = 'key-1';

      const result = resolveStepEnv(
        { DB_URL: '{{DB_URL}}', API_KEY: '{{API_KEY}}' },
        { API_KEY: 'literal-override' },
      );
      expect(result.vars).toEqual({ DB_URL: 'db://host', API_KEY: 'literal-override' });
    });

    it('returns empty result when both config and step env are undefined', () => {
      const result = resolveStepEnv(undefined, undefined);
      expect(result).toEqual({ vars: {}, injectedKeys: [] });
    });

    it('injectedKeys contains all merged keys', () => {
      const result = resolveStepEnv(
        { A: 'x' },
        { B: 'y', C: 'z' },
      );
      expect(result.injectedKeys).toEqual(['A', 'B', 'C']);
    });
  });

  // ---------------------------------------------------------------------------
  // validateWorkflowEnv
  // ---------------------------------------------------------------------------
  describe('validateWorkflowEnv', () => {
    it('returns empty array when no templates are present', () => {
      const result = validateWorkflowEnv({
        steps: [{ id: 's1', name: 'Step 1', executor: 'agent', env: { NODE_ENV: 'prod' } }],
      });
      expect(result).toEqual([]);
    });

    it('returns empty array when all templates are resolvable', () => {
      process.env['API_KEY'] = 'exists';
      const result = validateWorkflowEnv({
        steps: [{ id: 's1', name: 'Step 1', executor: 'agent', env: { API_KEY: '{{API_KEY}}' } }],
      });
      expect(result).toEqual([]);
    });

    it('detects missing template with step tracking', () => {
      const result = validateWorkflowEnv({
        steps: [{ id: 's1', name: 'Analyze', executor: 'agent', env: { KEY: '{{MISSING_KEY}}' } }],
      });
      expect(result).toEqual([
        {
          secretName: 'MISSING_KEY',
          template: '{{MISSING_KEY}}',
          steps: [{ stepId: 's1', stepName: 'Analyze' }],
        },
      ]);
    });

    it('aggregates same secret from multiple steps into one entry', () => {
      const result = validateWorkflowEnv({
        steps: [
          { id: 's1', name: 'Step A', executor: 'agent', env: { KEY: '{{SHARED}}' } },
          { id: 's2', name: 'Step B', executor: 'script', env: { KEY: '{{SHARED}}' } },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].secretName).toBe('SHARED');
      expect(result[0].steps).toHaveLength(2);
    });

    it('skips non-agent/script executor steps', () => {
      const result = validateWorkflowEnv({
        steps: [
          { id: 's1', name: 'Human', executor: 'human', env: { KEY: '{{MISSING}}' } },
          { id: 's2', name: 'Cowork', executor: 'cowork', env: { KEY: '{{MISSING}}' } },
        ],
      });
      expect(result).toEqual([]);
    });

    it('merges config-level env with step-level env', () => {
      process.env['API_KEY'] = 'exists';
      const result = validateWorkflowEnv({
        env: { API_KEY: '{{API_KEY}}', DB_URL: '{{DB_URL}}' },
        steps: [{ id: 's1', name: 'Run', executor: 'agent' }],
      });
      // API_KEY resolves, DB_URL does not
      expect(result).toHaveLength(1);
      expect(result[0].secretName).toBe('DB_URL');
    });

    it('step-level env overrides config-level env', () => {
      const result = validateWorkflowEnv({
        env: { KEY: '{{MISSING}}' },
        steps: [{ id: 's1', name: 'Run', executor: 'agent', env: { KEY: 'literal' } }],
      });
      // Step overrides with literal — no missing
      expect(result).toEqual([]);
    });

    it('resolves templates from workflow secrets', () => {
      const result = validateWorkflowEnv(
        { steps: [{ id: 's1', name: 'Run', executor: 'agent', env: { KEY: '{{SECRET}}' } }] },
        { SECRET: 'value' },
      );
      expect(result).toEqual([]);
    });

    it('resolves templates from DOCKER_ prefixed process.env', () => {
      process.env['DOCKER_API_KEY'] = 'docker-val';
      const result = validateWorkflowEnv({
        steps: [{ id: 's1', name: 'Run', executor: 'agent', env: { KEY: '{{API_KEY}}' } }],
      });
      expect(result).toEqual([]);
    });

    it('returns empty when definition has no steps', () => {
      const result = validateWorkflowEnv({ steps: [] });
      expect(result).toEqual([]);
    });

    it('handles steps without env field', () => {
      const result = validateWorkflowEnv({
        steps: [{ id: 's1', name: 'Run', executor: 'agent' }],
      });
      expect(result).toEqual([]);
    });
  });
});

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

  describe('namespaced SECRET: form', () => {
    it('[DATA] resolves {{SECRET:api_key}} from workflowSecrets[api_key]', () => {
      const secrets = { api_key: 'resolved' };
      expect(resolveValue('{{SECRET:api_key}}', secrets)).toBe('resolved');
    });

    it('[DATA] resolves {{SECRET:with-dashes}} (hyphen-tolerant key)', () => {
      const secrets = { 'with-dashes': 'ok' };
      expect(resolveValue('{{SECRET:with-dashes}}', secrets)).toBe('ok');
    });

    it('[DATA] falls through to process.env for SECRET: form', () => {
      const original = process.env.SECRET_FALLBACK_KEY;
      process.env.SECRET_FALLBACK_KEY = 'from-env';
      try {
        expect(resolveValue('{{SECRET:SECRET_FALLBACK_KEY}}')).toBe('from-env');
      } finally {
        if (original === undefined) delete process.env.SECRET_FALLBACK_KEY;
        else process.env.SECRET_FALLBACK_KEY = original;
      }
    });

    it('[ERROR] throws with the literal template + key when SECRET: lookup fails', () => {
      const key = 'NEVER_EXISTS_KEY';
      delete process.env[key];
      delete process.env[`DOCKER_${key}`];
      expect(() => resolveValue(`{{SECRET:${key}}}`)).toThrow(
        new RegExp(`\\{\\{SECRET:${key}\\}\\}`),
      );
    });
  });

  describe('OAUTH: namespace is rejected', () => {
    it('[ERROR] throws when {{OAUTH:github}} is used as an env/header value', () => {
      // OAuth tokens flow through HttpAuthConfig { type: 'oauth' }, not env
      // templates. Silent pass-through would produce invalid header values.
      expect(() => resolveValue('{{OAUTH:github}}', {})).toThrow(/OAUTH/);
      expect(() => resolveValue('{{OAUTH:github}}', {})).toThrow(/auth.*oauth/i);
    });
  });
});
