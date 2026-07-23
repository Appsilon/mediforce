import { describe, it, expect } from 'vitest';
import { getControlMode, controlModeToSchema } from '../control-mode';

describe('getControlMode', () => {
  it('maps non-agent executors to no-agent', () => {
    expect(getControlMode('human')).toBe('no-agent');
    expect(getControlMode('script')).toBe('no-agent');
    expect(getControlMode('action')).toBe('no-agent');
    expect(getControlMode(undefined)).toBe('no-agent');
  });

  it('maps cowork executor to cowork', () => {
    expect(getControlMode('cowork')).toBe('cowork');
  });

  it('maps agent + L4 to autonomous-agent', () => {
    expect(getControlMode('agent', 'L4')).toBe('autonomous-agent');
  });

  it('maps agent + L3 to human-review', () => {
    expect(getControlMode('agent', 'L3')).toBe('human-review');
  });

  it('maps agent + L2 to assist', () => {
    expect(getControlMode('agent', 'L2')).toBe('assist');
  });

  it('maps agent + L0/L1 to no-agent (developer-only flags)', () => {
    expect(getControlMode('agent', 'L0')).toBe('no-agent');
    expect(getControlMode('agent', 'L1')).toBe('no-agent');
  });

  it('maps agent + undefined/null autonomyLevel to autonomous-agent', () => {
    expect(getControlMode('agent', undefined)).toBe('autonomous-agent');
    expect(getControlMode('agent', null)).toBe('autonomous-agent');
    expect(getControlMode('agent')).toBe('autonomous-agent');
  });

  it('maps agent + unknown autonomyLevel to autonomous-agent', () => {
    expect(getControlMode('agent', 'L5')).toBe('autonomous-agent');
  });
});

describe('controlModeToSchema', () => {
  it('maps autonomous-agent to agent + L4', () => {
    expect(controlModeToSchema('autonomous-agent')).toEqual({ executor: 'agent', autonomyLevel: 'L4' });
  });

  it('maps human-review to agent + L3', () => {
    expect(controlModeToSchema('human-review')).toEqual({ executor: 'agent', autonomyLevel: 'L3' });
  });

  it('maps assist to agent + L2', () => {
    expect(controlModeToSchema('assist')).toEqual({ executor: 'agent', autonomyLevel: 'L2' });
  });

  it('maps cowork to cowork executor', () => {
    expect(controlModeToSchema('cowork')).toEqual({ executor: 'cowork' });
  });

  it('maps no-agent to the chosen sub-executor (defaults to human)', () => {
    expect(controlModeToSchema('no-agent')).toEqual({ executor: 'human' });
    expect(controlModeToSchema('no-agent', 'script')).toEqual({ executor: 'script' });
    expect(controlModeToSchema('no-agent', 'action')).toEqual({ executor: 'action' });
  });

  it('roundtrips correctly for wizard-creatable modes', () => {
    const modes = ['autonomous-agent', 'human-review', 'cowork'] as const;
    for (const mode of modes) {
      const { executor, autonomyLevel } = controlModeToSchema(mode);
      expect(getControlMode(executor, autonomyLevel)).toBe(mode);
    }
  });
});
