import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveStepEnv, validateWorkflowEnv } from '../resolve-env.js';

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
