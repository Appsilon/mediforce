import { describe, it, expect } from 'vitest';
import { isRequiredEnvSatisfied } from '../required-env';

describe('isRequiredEnvSatisfied', () => {
  it('treats no requirement as satisfied', () => {
    expect(isRequiredEnvSatisfied(undefined, {})).toBe(true);
    expect(isRequiredEnvSatisfied([], {})).toBe(true);
  });

  it('satisfies a single-key group when the key is set', () => {
    expect(isRequiredEnvSatisfied([['ANTHROPIC_API_KEY']], { ANTHROPIC_API_KEY: 'sk-live' })).toBe(true);
  });

  it('rejects a single-key group when the key is missing', () => {
    expect(isRequiredEnvSatisfied([['ANTHROPIC_API_KEY']], {})).toBe(false);
  });

  it('treats an empty string as unset', () => {
    expect(isRequiredEnvSatisfied([['ANTHROPIC_API_KEY']], { ANTHROPIC_API_KEY: '' })).toBe(false);
  });

  it('requires every key within a group', () => {
    const groups = [['OPENROUTER_API_KEY', 'ANTHROPIC_BASE_URL']];
    expect(isRequiredEnvSatisfied(groups, { OPENROUTER_API_KEY: 'sk-or' })).toBe(false);
    expect(
      isRequiredEnvSatisfied(groups, { OPENROUTER_API_KEY: 'sk-or', ANTHROPIC_BASE_URL: 'https://x' }),
    ).toBe(true);
  });

  it('satisfies when any one alternative group is complete', () => {
    const groups = [['ANTHROPIC_API_KEY'], ['OPENROUTER_API_KEY', 'ANTHROPIC_BASE_URL']];
    expect(isRequiredEnvSatisfied(groups, { OPENROUTER_API_KEY: 'sk-or', ANTHROPIC_BASE_URL: 'https://x' })).toBe(true);
    expect(isRequiredEnvSatisfied(groups, { ANTHROPIC_API_KEY: 'sk-live' })).toBe(true);
    expect(isRequiredEnvSatisfied(groups, { OPENROUTER_API_KEY: 'sk-or' })).toBe(false);
  });
});
