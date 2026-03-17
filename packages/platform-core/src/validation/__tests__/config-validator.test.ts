import { describe, it, expect } from 'vitest';
import { validateProcessConfig } from '../config-validator.js';
import type { ProcessDefinition, ProcessConfig } from '../../index.js';

const baseDefinition: ProcessDefinition = {
  name: 'test-process',
  version: '1.0',
  steps: [
    { id: 'step-intake', name: 'Intake', type: 'creation' },
    { id: 'step-review', name: 'Review', type: 'review', verdicts: { approve: { target: 'step-done' } } },
    { id: 'step-done', name: 'Done', type: 'terminal' },
  ],
  transitions: [
    { from: 'step-intake', to: 'step-review' },
    { from: 'step-review', to: 'step-done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

const baseConfig: ProcessConfig = {
  processName: 'test-process',
  configName: 'default',
  configVersion: '1.0',
  stepConfigs: [
    { stepId: 'step-intake', executorType: 'agent', plugin: '@mediforce/intake-agent' },
    { stepId: 'step-review', executorType: 'human' },
    { stepId: 'step-done', executorType: 'human' },
  ],
};

describe('validateProcessConfig', () => {
  it('[DATA] should return valid for a correct config covering all steps', () => {
    const result = validateProcessConfig(baseConfig, baseDefinition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('[DATA] should return error when a step has no StepConfig', () => {
    const config: ProcessConfig = {
      ...baseConfig,
      stepConfigs: [
        { stepId: 'step-intake', executorType: 'agent', plugin: '@mediforce/intake-agent' },
        // missing step-review and step-done
      ],
    };
    const result = validateProcessConfig(config, baseDefinition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('step-review'))).toBe(true);
  });

  it('[DATA] should return error when executorType=agent without plugin', () => {
    const config: ProcessConfig = {
      ...baseConfig,
      stepConfigs: [
        { stepId: 'step-intake', executorType: 'agent' }, // missing plugin
        { stepId: 'step-review', executorType: 'human' },
        { stepId: 'step-done', executorType: 'human' },
      ],
    };
    const result = validateProcessConfig(config, baseDefinition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('step-intake') && e.includes('plugin'))).toBe(true);
  });

  it('[DATA] should return error when reviewerType=agent without reviewerPlugin', () => {
    const config: ProcessConfig = {
      ...baseConfig,
      stepConfigs: [
        { stepId: 'step-intake', executorType: 'agent', plugin: '@mediforce/intake-agent' },
        { stepId: 'step-review', executorType: 'human', reviewerType: 'agent' }, // missing reviewerPlugin
        { stepId: 'step-done', executorType: 'human' },
      ],
    };
    const result = validateProcessConfig(config, baseDefinition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('step-review') && e.includes('reviewerPlugin'))).toBe(true);
  });

  it('[DATA] should return error when plugin not in registeredPlugins', () => {
    const result = validateProcessConfig(baseConfig, baseDefinition, ['@mediforce/other-agent']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('@mediforce/intake-agent') && e.includes('registered'))).toBe(true);
  });

  it('[DATA] should return warning when same plugin is executor and reviewer (self-review risk)', () => {
    const config: ProcessConfig = {
      ...baseConfig,
      stepConfigs: [
        {
          stepId: 'step-intake',
          executorType: 'agent',
          plugin: '@mediforce/intake-agent',
          reviewerType: 'agent',
          reviewerPlugin: '@mediforce/intake-agent', // same as executor plugin
        },
        { stepId: 'step-review', executorType: 'human' },
        { stepId: 'step-done', executorType: 'human' },
      ],
    };
    const result = validateProcessConfig(config, baseDefinition);
    expect(result.valid).toBe(true); // warnings don't make it invalid
    expect(result.warnings.some((w) => w.includes('step-intake') && w.toLowerCase().includes('self-review'))).toBe(true);
  });

  it('[DATA] should return error when claude-code-agent step has no skill or prompt', () => {
    const config: ProcessConfig = {
      ...baseConfig,
      stepConfigs: [
        { stepId: 'step-intake', executorType: 'agent', plugin: 'claude-code-agent', agentConfig: { model: 'sonnet' } },
        { stepId: 'step-review', executorType: 'human' },
        { stepId: 'step-done', executorType: 'human' },
      ],
    };
    const result = validateProcessConfig(config, baseDefinition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('step-intake') && e.includes('skill or agentConfig.prompt'))).toBe(true);
  });

  it('[DATA] should pass when claude-code-agent step has prompt', () => {
    const config: ProcessConfig = {
      ...baseConfig,
      stepConfigs: [
        { stepId: 'step-intake', executorType: 'agent', plugin: 'claude-code-agent', agentConfig: { prompt: 'Do the thing', model: 'sonnet' } },
        { stepId: 'step-review', executorType: 'human' },
        { stepId: 'step-done', executorType: 'human' },
      ],
    };
    const result = validateProcessConfig(config, baseDefinition);
    expect(result.valid).toBe(true);
  });

  it('[DATA] should return error when script-container step has no inlineScript or command', () => {
    const config: ProcessConfig = {
      ...baseConfig,
      stepConfigs: [
        { stepId: 'step-intake', executorType: 'script', plugin: 'script-container', agentConfig: { runtime: 'javascript' } },
        { stepId: 'step-review', executorType: 'human' },
        { stepId: 'step-done', executorType: 'human' },
      ],
    };
    const result = validateProcessConfig(config, baseDefinition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('step-intake') && e.includes('inlineScript or agentConfig.command'))).toBe(true);
  });

  it('[DATA] should skip registry validation when registeredPlugins not provided', () => {
    const result = validateProcessConfig(baseConfig, baseDefinition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('[DATA] should pass registry validation when all plugins are registered', () => {
    const result = validateProcessConfig(baseConfig, baseDefinition, ['@mediforce/intake-agent']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
