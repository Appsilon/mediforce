import { describe, it, expect } from 'vitest';
import { resolveStepEnv, validateWorkflowEnv, validateWorkflowModels, validateRetiredModels, resolveValue } from '../resolve-env';

describe('resolve-env', () => {
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

    it('throws when template not in secrets (no process.env fallback)', () => {
      expect(() => resolveStepEnv(undefined, { API_KEY: '{{API_KEY}}' })).toThrow(
        /API_KEY.*not configured/,
      );
    });

    it('throws when workflow secret is empty string', () => {
      expect(() => resolveStepEnv(
        undefined,
        { API_KEY: '{{API_KEY}}' },
        { API_KEY: '' },
      )).toThrow(/API_KEY.*not configured/);
    });

    it('merges config-level and step-level env (step overrides config)', () => {
      const secrets = { DB_URL: 'db://host', API_KEY: 'key-1' };
      const result = resolveStepEnv(
        { DB_URL: '{{DB_URL}}', API_KEY: '{{API_KEY}}' },
        { API_KEY: 'literal-override' },
        secrets,
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

    it('returns empty array when all templates resolvable from secrets', () => {
      const result = validateWorkflowEnv(
        { steps: [{ id: 's1', name: 'Step 1', executor: 'agent', env: { API_KEY: '{{API_KEY}}' } }] },
        { API_KEY: 'exists' },
      );
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
      const secrets = { API_KEY: 'exists' };
      const result = validateWorkflowEnv({
        env: { API_KEY: '{{API_KEY}}', DB_URL: '{{DB_URL}}' },
        steps: [{ id: 's1', name: 'Run', executor: 'agent' }],
      }, secrets);
      expect(result).toHaveLength(1);
      expect(result[0].secretName).toBe('DB_URL');
    });

    it('step-level env overrides config-level env', () => {
      const result = validateWorkflowEnv({
        env: { KEY: '{{MISSING}}' },
        steps: [{ id: 's1', name: 'Run', executor: 'agent', env: { KEY: 'literal' } }],
      });
      expect(result).toEqual([]);
    });

    it('resolves templates from workflow secrets', () => {
      const result = validateWorkflowEnv(
        { steps: [{ id: 's1', name: 'Run', executor: 'agent', env: { KEY: '{{SECRET}}' } }] },
        { SECRET: 'value' },
      );
      expect(result).toEqual([]);
    });

    it('reports missing when secret not in Firestore (no process.env fallback)', () => {
      const result = validateWorkflowEnv({
        steps: [{ id: 's1', name: 'Run', executor: 'agent', env: { KEY: '{{API_KEY}}' } }],
      });
      expect(result).toHaveLength(1);
      expect(result[0].secretName).toBe('API_KEY');
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

  describe('secrets resolution', () => {
    it('[DATA] resolves {{FOO}} from secrets', () => {
      expect(resolveValue('{{FOO}}', { FOO: 'secret-value' })).toBe('secret-value');
    });

    it('[DATA] resolves {{API_KEY}} when secrets contains the key', () => {
      expect(resolveValue('{{API_KEY}}', { API_KEY: 'my-api-key-123' })).toBe('my-api-key-123');
    });

    it('[ERROR] throws when secret not configured (no process.env fallback)', () => {
      expect(() => resolveValue('{{MY_SECRET}}')).toThrow(/MY_SECRET.*not configured/);
    });

    it('[ERROR] throws when secret key absent from provided secrets', () => {
      expect(() => resolveValue('{{NOT_IN_SECRETS}}', { OTHER_KEY: 'some-value' })).toThrow(
        /NOT_IN_SECRETS.*not configured/,
      );
    });

    it('[ERROR] throws when secret value is empty string', () => {
      expect(() => resolveValue('{{EMPTY_SECRET}}', { EMPTY_SECRET: '' })).toThrow(
        /EMPTY_SECRET.*not configured/,
      );
    });
  });

  describe('namespaced SECRET: form', () => {
    it('[DATA] resolves {{SECRET:api_key}} from secrets[api_key]', () => {
      expect(resolveValue('{{SECRET:api_key}}', { api_key: 'resolved' })).toBe('resolved');
    });

    it('[DATA] resolves {{SECRET:with-dashes}} (hyphen-tolerant key)', () => {
      expect(resolveValue('{{SECRET:with-dashes}}', { 'with-dashes': 'ok' })).toBe('ok');
    });

    it('[ERROR] throws when SECRET: form key not in secrets', () => {
      expect(() => resolveValue('{{SECRET:NEVER_EXISTS_KEY}}')).toThrow(
        /NEVER_EXISTS_KEY.*not configured/,
      );
    });
  });

  describe('OAUTH: namespace is rejected', () => {
    it('[ERROR] throws when {{OAUTH:github}} is used as an env/header value', () => {
      expect(() => resolveValue('{{OAUTH:github}}', {})).toThrow(/OAUTH/);
      expect(() => resolveValue('{{OAUTH:github}}', {})).toThrow(/auth.*oauth/i);
    });
  });

  describe('validateRetiredModels', () => {
    const retiredMap = new Map<string, string>([
      ['openai/gpt-4', '2026-01-15T00:00:00Z'],
      ['anthropic/claude-2', '2025-06-01T00:00:00Z'],
    ]);

    it('returns empty array when no steps use retired models', () => {
      const result = validateRetiredModels({
        steps: [
          { id: 's1', name: 'Step 1', executor: 'agent', agent: { model: 'anthropic/claude-sonnet-4' } },
        ],
      }, retiredMap);
      expect(result).toEqual([]);
    });

    it('returns retired model info when step uses a retired model', () => {
      const result = validateRetiredModels({
        steps: [
          { id: 's1', name: 'Analyze', executor: 'agent', agent: { model: 'openai/gpt-4' } },
        ],
      }, retiredMap);
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe('openai/gpt-4');
      expect(result[0].retiredAt).toBe('2026-01-15T00:00:00Z');
      expect(result[0].steps).toEqual([{ stepId: 's1', stepName: 'Analyze' }]);
    });

    it('ignores steps with no model set (model is optional)', () => {
      const result = validateRetiredModels({
        steps: [
          { id: 's1', name: 'Agent', executor: 'agent', agent: {} },
        ],
      }, retiredMap);
      expect(result).toEqual([]);
    });

    it('ignores non-agent executor steps', () => {
      const result = validateRetiredModels({
        steps: [
          { id: 's1', name: 'Human', executor: 'human' },
          { id: 's2', name: 'Action', executor: 'action' },
        ],
      }, retiredMap);
      expect(result).toEqual([]);
    });

    it('groups multiple steps using the same retired model into one entry', () => {
      const result = validateRetiredModels({
        steps: [
          { id: 's1', name: 'Step A', executor: 'agent', agent: { model: 'openai/gpt-4' } },
          { id: 's2', name: 'Step B', executor: 'agent', agent: { model: 'openai/gpt-4' } },
        ],
      }, retiredMap);
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe('openai/gpt-4');
      expect(result[0].steps).toHaveLength(2);
      expect(result[0].steps).toEqual([
        { stepId: 's1', stepName: 'Step A' },
        { stepId: 's2', stepName: 'Step B' },
      ]);
    });

    it('normalises Firestore-encoded model IDs ("a__b" to "a/b") before lookup', () => {
      const result = validateRetiredModels({
        steps: [
          { id: 's1', name: 'Encode Step', executor: 'agent', agent: { model: 'openai__gpt-4' } },
        ],
      }, retiredMap);
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe('openai/gpt-4');
      expect(result[0].retiredAt).toBe('2026-01-15T00:00:00Z');
    });
  });

  describe('validateWorkflowModels', () => {
    const known = new Set(['deepseek/deepseek-chat', 'deepseek/deepseek-v4-flash:free', 'anthropic/claude-sonnet-4']);

    it('returns empty when all models exist', () => {
      const result = validateWorkflowModels({
        steps: [
          { id: 's1', name: 'Step 1', executor: 'agent', agent: { model: 'deepseek/deepseek-chat' } },
        ],
      }, known);
      expect(result).toEqual([]);
    });

    it('normalises __ to / before lookup', () => {
      const result = validateWorkflowModels({
        steps: [
          { id: 's1', name: 'Step 1', executor: 'agent', agent: { model: 'deepseek__deepseek-v4-flash:free' } },
        ],
      }, known);
      expect(result).toEqual([]);
    });

    it('reports unknown models with affected steps', () => {
      const result = validateWorkflowModels({
        steps: [
          { id: 's1', name: 'Collect', executor: 'agent', agent: { model: 'nonexistent/model' } },
          { id: 's2', name: 'Process', executor: 'agent', agent: { model: 'deepseek/deepseek-chat' } },
        ],
      }, known);
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe('nonexistent/model');
      expect(result[0].steps).toEqual([{ stepId: 's1', stepName: 'Collect' }]);
    });

    it('skips non-agent steps and steps without model', () => {
      const result = validateWorkflowModels({
        steps: [
          { id: 's1', name: 'Human', executor: 'human' },
          { id: 's2', name: 'Agent', executor: 'agent', agent: {} },
          { id: 's3', name: 'Action', executor: 'action' },
        ],
      }, known);
      expect(result).toEqual([]);
    });

    it('groups multiple steps using the same unknown model', () => {
      const result = validateWorkflowModels({
        steps: [
          { id: 's1', name: 'A', executor: 'agent', agent: { model: 'bad/model' } },
          { id: 's2', name: 'B', executor: 'agent', agent: { model: 'bad/model' } },
        ],
      }, known);
      expect(result).toHaveLength(1);
      expect(result[0].steps).toHaveLength(2);
    });
  });
});
