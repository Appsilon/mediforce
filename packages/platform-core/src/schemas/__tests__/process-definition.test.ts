import { describe, it, expect } from 'vitest';
import {
  ProcessDefinitionSchema,
  StepSchema,
  TransitionSchema,
  TriggerSchema,
  VerdictSchema,
} from '../process-definition.js';

const minimalStep = {
  id: 'step-1',
  name: 'Step One',
  type: 'creation' as const,
};

const minimalTransition = {
  from: 'step-1',
  to: 'step-2',
};

const minimalTrigger = {
  type: 'manual' as const,
  name: 'Start Process',
};

const minimalDefinition = {
  name: 'test-process',
  version: '1.0',
  steps: [minimalStep],
  transitions: [minimalTransition],
  triggers: [minimalTrigger],
};

describe('VerdictSchema', () => {
  it('should parse a valid verdict', () => {
    const result = VerdictSchema.safeParse({ target: 'complete' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target).toBe('complete');
    }
  });
});

describe('StepSchema', () => {
  it('should parse a minimal valid step', () => {
    const result = StepSchema.safeParse(minimalStep);
    expect(result.success).toBe(true);
  });

  it('should parse a review step with verdicts', () => {
    const reviewStep = {
      id: 'review-step',
      name: 'Compliance Review',
      type: 'review',
      verdicts: {
        approve: { target: 'complete' },
        revise: { target: 'collect-data' },
        reject: { target: 'closed' },
      },
    };
    const result = StepSchema.safeParse(reviewStep);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdicts?.approve.target).toBe('complete');
      expect(result.data.verdicts?.revise.target).toBe('collect-data');
      expect(result.data.verdicts?.reject.target).toBe('closed');
    }
  });

  it('should parse a step with optional metadata', () => {
    const step = {
      ...minimalStep,
      description: 'A test step',
      metadata: { priority: 'high', category: 'compliance' },
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('A test step');
      expect(result.data.metadata?.priority).toBe('high');
    }
  });

  it('should reject a step with empty id', () => {
    const result = StepSchema.safeParse({ ...minimalStep, id: '' });
    expect(result.success).toBe(false);
  });

  it('should reject a step with empty name', () => {
    const result = StepSchema.safeParse({ ...minimalStep, name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject a step with unknown type', () => {
    const result = StepSchema.safeParse({ ...minimalStep, type: 'unknown' });
    expect(result.success).toBe(false);
  });

  // --- NEW: behavioral step type tests ---

  it('[DATA] should accept step with type "creation"', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1', type: 'creation' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('creation');
  });

  it('[DATA] should accept step with type "review"', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1', type: 'review' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('review');
  });

  it('[DATA] should accept step with type "decision"', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1', type: 'decision' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('decision');
  });

  it('[DATA] should accept step with type "terminal"', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1', type: 'terminal' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('terminal');
  });

  it('[DATA] should default type to "creation" when omitted', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('creation');
  });

  it('[DATA] should reject step with type "human" (removed)', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1', type: 'human' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject step with type "agent" (removed)', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1', type: 'agent' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject step with type "automated" (removed)', () => {
    const result = StepSchema.safeParse({ id: 's1', name: 'S1', type: 'automated' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should not have "plugin" field (removed from StepSchema)', () => {
    const result = StepSchema.safeParse({
      id: 's1',
      name: 'S1',
      type: 'creation',
      plugin: '@mediforce/some-agent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // plugin should be stripped (not in schema)
      expect('plugin' in result.data).toBe(false);
    }
  });

  it('[DATA] should accept all valid behavioral step types', () => {
    for (const type of ['creation', 'review', 'decision', 'terminal']) {
      const result = StepSchema.safeParse({ ...minimalStep, type });
      expect(result.success).toBe(true);
    }
  });
});

describe('TransitionSchema', () => {
  it('should parse a minimal transition', () => {
    const result = TransitionSchema.safeParse(minimalTransition);
    expect(result.success).toBe(true);
  });

  it('should parse a transition with gate', () => {
    const result = TransitionSchema.safeParse({
      ...minimalTransition,
      gate: 'data-complete',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gate).toBe('data-complete');
    }
  });
});

describe('TriggerSchema', () => {
  it('should parse a minimal trigger', () => {
    const result = TriggerSchema.safeParse(minimalTrigger);
    expect(result.success).toBe(true);
  });

  it('should parse a trigger with config', () => {
    const result = TriggerSchema.safeParse({
      type: 'webhook',
      name: 'External Trigger',
      config: { url: 'https://example.com', method: 'POST' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept all valid trigger types', () => {
    for (const type of ['manual', 'webhook', 'event']) {
      const result = TriggerSchema.safeParse({ type, name: 'test' });
      expect(result.success).toBe(true);
    }
  });

  it('should reject a trigger with unknown type', () => {
    const result = TriggerSchema.safeParse({
      type: 'cron',
      name: 'Cron Trigger',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a trigger with empty name', () => {
    const result = TriggerSchema.safeParse({ type: 'manual', name: '' });
    expect(result.success).toBe(false);
  });
});

describe('ProcessDefinitionSchema', () => {
  it('should parse a minimal valid process definition', () => {
    const result = ProcessDefinitionSchema.safeParse(minimalDefinition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test-process');
      expect(result.data.version).toBe('1.0');
      expect(result.data.steps).toHaveLength(1);
      expect(result.data.transitions).toHaveLength(1);
      expect(result.data.triggers).toHaveLength(1);
    }
  });

  it('should parse a full process definition with review steps, gates, and metadata', () => {
    const fullDefinition = {
      name: 'supply-chain-review',
      version: '2.0',
      description: 'Review supplier compliance and quality signals',
      steps: [
        { id: 'collect-data', name: 'Collect Supplier Data', type: 'creation' },
        {
          id: 'review',
          name: 'Compliance Review',
          type: 'review',
          verdicts: {
            approve: { target: 'complete' },
            revise: { target: 'collect-data' },
            reject: { target: 'closed' },
          },
        },
        { id: 'complete', name: 'Complete', type: 'terminal' },
        { id: 'closed', name: 'Closed', type: 'terminal' },
      ],
      transitions: [
        { from: 'collect-data', to: 'review', gate: 'data-complete' },
      ],
      triggers: [
        { type: 'manual', name: 'Start Supply Chain Review' },
        {
          type: 'webhook',
          name: 'External Signal',
          config: { endpoint: '/webhook/supply-discrepancy' },
        },
      ],
      metadata: { domain: 'supply-chain', priority: 'high' },
    };
    const result = ProcessDefinitionSchema.safeParse(fullDefinition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toHaveLength(4);
      expect(result.data.triggers).toHaveLength(2);
      expect(result.data.metadata?.domain).toBe('supply-chain');
    }
  });

  it('should accept bare-bones definitions (optional fields omitted)', () => {
    const result = ProcessDefinitionSchema.safeParse(minimalDefinition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.metadata).toBeUndefined();
    }
  });

  it('should reject a definition with missing name', () => {
    const { name: _, ...noName } = minimalDefinition;
    const result = ProcessDefinitionSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it('should reject a definition with empty steps array', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject a definition with missing triggers', () => {
    const { triggers: _, ...noTriggers } = minimalDefinition;
    const result = ProcessDefinitionSchema.safeParse(noTriggers);
    expect(result.success).toBe(false);
  });

  it('should reject a definition with empty triggers array', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      triggers: [],
    });
    expect(result.success).toBe(false);
  });

  it('should accept a definition with repo (url only)', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      repo: { url: 'https://github.com/org/repo' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo?.url).toBe('https://github.com/org/repo');
      expect(result.data.repo?.branch).toBeUndefined();
      expect(result.data.repo?.directory).toBeUndefined();
    }
  });

  it('should accept a definition with repo including branch and directory', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      repo: {
        url: 'https://github.com/org/monorepo',
        branch: 'main',
        directory: 'packages/my-app',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo?.branch).toBe('main');
      expect(result.data.repo?.directory).toBe('packages/my-app');
    }
  });

  it('should reject repo with invalid url', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      repo: { url: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject repo without url field', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      repo: { branch: 'main' },
    });
    expect(result.success).toBe(false);
  });

  it('should accept a definition with deployment url', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      url: 'https://app.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://app.example.com');
    }
  });

  it('should reject an invalid deployment url', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('should accept both repo and url together', () => {
    const result = ProcessDefinitionSchema.safeParse({
      ...minimalDefinition,
      repo: { url: 'https://github.com/org/repo', branch: 'main', directory: 'apps/supply' },
      url: 'https://supply.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo?.url).toBe('https://github.com/org/repo');
      expect(result.data.url).toBe('https://supply.example.com');
    }
  });
});
