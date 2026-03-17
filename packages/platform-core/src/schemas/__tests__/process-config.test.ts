import { describe, it, expect } from 'vitest';
import {
  ProcessConfigSchema,
  StepConfigSchema,
  ReviewConstraintsSchema,
} from '../process-config.js';

const validStepConfig = {
  stepId: 'review-step',
  executorType: 'human' as const,
  autonomyLevel: 'L2' as const,
  fallbackBehavior: 'escalate_to_human' as const,
  timeoutMinutes: 30,
  reviewConstraints: {
    maxIterations: 3,
    timeBoxDays: 5,
  },
};

const validProcessConfig = {
  processName: 'supply-chain-review',
  configName: 'default',
  configVersion: '1.0',
  stepConfigs: [validStepConfig],
  metadata: { environment: 'staging' },
};

describe('ReviewConstraintsSchema', () => {
  it('should parse valid review constraints', () => {
    const result = ReviewConstraintsSchema.safeParse({
      maxIterations: 3,
      timeBoxDays: 5,
    });
    expect(result.success).toBe(true);
  });

  it('should allow optional fields', () => {
    const result = ReviewConstraintsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should reject non-positive maxIterations', () => {
    const result = ReviewConstraintsSchema.safeParse({ maxIterations: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject negative timeBoxDays', () => {
    const result = ReviewConstraintsSchema.safeParse({ timeBoxDays: -1 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer maxIterations', () => {
    const result = ReviewConstraintsSchema.safeParse({ maxIterations: 2.5 });
    expect(result.success).toBe(false);
  });
});

describe('StepConfigSchema', () => {
  it('should parse a full step config', () => {
    const result = StepConfigSchema.safeParse(validStepConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autonomyLevel).toBe('L2');
      expect(result.data.fallbackBehavior).toBe('escalate_to_human');
      expect(result.data.reviewConstraints?.maxIterations).toBe(3);
    }
  });

  it('[DATA] should accept executorType "human"', () => {
    const result = StepConfigSchema.safeParse({ stepId: 'step-1', executorType: 'human' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executorType).toBe('human');
  });

  it('[DATA] should accept executorType "agent"', () => {
    const result = StepConfigSchema.safeParse({ stepId: 'step-1', executorType: 'agent' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executorType).toBe('agent');
  });

  it('[DATA] should reject stepConfig without executorType (required field)', () => {
    const result = StepConfigSchema.safeParse({ stepId: 'step-1' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject invalid executorType', () => {
    const result = StepConfigSchema.safeParse({ stepId: 'step-1', executorType: 'bot' });
    expect(result.success).toBe(false);
  });

  it('should accept all valid autonomy levels', () => {
    for (const level of ['L0', 'L1', 'L2', 'L3', 'L4']) {
      const result = StepConfigSchema.safeParse({
        stepId: 'step-1',
        executorType: 'human',
        autonomyLevel: level,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid autonomy level', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'human',
      autonomyLevel: 'L5',
    });
    expect(result.success).toBe(false);
  });

  it('should accept all valid fallback behaviors', () => {
    for (const behavior of [
      'escalate_to_human',
      'continue_with_flag',
      'pause',
    ]) {
      const result = StepConfigSchema.safeParse({
        stepId: 'step-1',
        executorType: 'human',
        fallbackBehavior: behavior,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid fallback behavior', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'human',
      fallbackBehavior: 'ignore',
    });
    expect(result.success).toBe(false);
  });

  it('[DATA] should accept reviewerType "human"', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'human',
      reviewerType: 'human',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewerType).toBe('human');
    }
  });

  it('[DATA] should accept reviewerType "agent"', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'human',
      reviewerType: 'agent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewerType).toBe('agent');
    }
  });

  it('[DATA] should accept reviewerType "none" (L4 no-review)', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'agent',
      reviewerType: 'none',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewerType).toBe('none');
    }
  });

  it('[DATA] should reject invalid reviewerType "bot"', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'human',
      reviewerType: 'bot',
    });
    expect(result.success).toBe(false);
  });

  it('[DATA] should accept reviewerPlugin as a string', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'agent',
      reviewerType: 'agent',
      reviewerPlugin: 'supply-chain-reviewer',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewerPlugin).toBe('supply-chain-reviewer');
    }
  });

  it('[DATA] should accept optional fields (plugin, reviewerType, reviewerPlugin) with executorType', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'agent',
      plugin: '@mediforce/intake-agent',
      reviewerType: 'human',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugin).toBe('@mediforce/intake-agent');
      expect(result.data.reviewerType).toBe('human');
    }
  });

  it('[DATA] should accept agentConfig with skill', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'agent',
      plugin: 'claude-code',
      agentConfig: { skill: 'trial-metadata-extractor', image: 'mediforce-agent:base' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentConfig?.skill).toBe('trial-metadata-extractor');
    }
  });

  it('[DATA] should accept agentConfig with prompt, model, and skillsDir', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'agent',
      plugin: 'claude-code-agent',
      agentConfig: {
        skill: 'trial-metadata-extractor',
        prompt: 'Extract metadata from the uploaded protocol PDF',
        model: 'sonnet',
        skillsDir: 'apps/protocol-to-tfl/plugins/protocol-to-tfl/skills',
        image: 'mediforce-agent:base',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentConfig?.prompt).toBe('Extract metadata from the uploaded protocol PDF');
      expect(result.data.agentConfig?.model).toBe('sonnet');
      expect(result.data.agentConfig?.skillsDir).toBe('apps/protocol-to-tfl/plugins/protocol-to-tfl/skills');
    }
  });

  it('[DATA] should accept agentConfig without image (optional for local execution)', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'agent',
      agentConfig: { skill: 'some-skill' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentConfig?.image).toBeUndefined();
    }
  });

  it('[DATA] should accept agentConfig with empty image string (image is optional for inline scripts)', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'agent',
      agentConfig: { image: '' },
    });
    expect(result.success).toBe(true);
  });

  it('[DATA] should accept stepConfig without agentConfig (optional)', () => {
    const result = StepConfigSchema.safeParse({
      stepId: 'step-1',
      executorType: 'human',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentConfig).toBeUndefined();
    }
  });
});

describe('ProcessConfigSchema', () => {
  it('should parse a valid process config with configName and configVersion', () => {
    const result = ProcessConfigSchema.safeParse(validProcessConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processName).toBe('supply-chain-review');
      expect(result.data.configName).toBe('default');
      expect(result.data.configVersion).toBe('1.0');
      expect(result.data.stepConfigs).toHaveLength(1);
      expect(result.data.metadata?.environment).toBe('staging');
    }
  });

  it('[DATA] should reject config without configName (required field)', () => {
    const { configName: _, ...noConfigName } = validProcessConfig;
    const result = ProcessConfigSchema.safeParse(noConfigName);
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject config without configVersion (required field)', () => {
    const { configVersion: _, ...noConfigVersion } = validProcessConfig;
    const result = ProcessConfigSchema.safeParse(noConfigVersion);
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject config with empty configName', () => {
    const result = ProcessConfigSchema.safeParse({ ...validProcessConfig, configName: '' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject config with empty configVersion', () => {
    const result = ProcessConfigSchema.safeParse({ ...validProcessConfig, configVersion: '' });
    expect(result.success).toBe(false);
  });

  it('should parse a config with empty stepConfigs', () => {
    const result = ProcessConfigSchema.safeParse({
      processName: 'test',
      configName: 'default',
      configVersion: '1.0',
      stepConfigs: [],
    });
    expect(result.success).toBe(true);
  });

  it('should parse a config without metadata', () => {
    const { metadata: _, ...noMeta } = validProcessConfig;
    const result = ProcessConfigSchema.safeParse(noMeta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toBeUndefined();
    }
  });
});
