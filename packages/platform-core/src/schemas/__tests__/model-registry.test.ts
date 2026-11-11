import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, FALLBACK_PINNED_MODEL, isMovingModelAlias, pinDefaultJudgeModel, pinDefaultModel } from '../model-registry';
import { effectiveModelSettings } from '../namespace';

function entry(id: string, retiredAt: string | null = null) {
  return { id, retiredAt };
}

describe('pinDefaultModel', () => {
  it('[DATA] picks the newest Claude Sonnet the registry lists, comparing major then minor version', () => {
    const models = [
      entry('anthropic/claude-sonnet-4.6'),
      entry('anthropic/claude-sonnet-5.5'),
      entry('anthropic/claude-sonnet-5'),
      entry('anthropic/claude-opus-5.5'),
      entry('anthropic/claude-sonnet-4'),
    ];

    expect(pinDefaultModel(models)).toBe('anthropic/claude-sonnet-5.5');
  });

  it('[DATA] ignores the alias itself, batch and other variants, and retired models', () => {
    const models = [
      entry(DEFAULT_MODEL),
      entry('anthropic/claude-sonnet-6:batch'),
      entry('anthropic/claude-sonnet-6:thinking'),
      entry('anthropic/claude-sonnet-5.9', '2026-09-01T00:00:00.000Z'),
      entry('anthropic/claude-sonnet-5.5'),
    ];

    expect(pinDefaultModel(models)).toBe('anthropic/claude-sonnet-5.5');
  });

  it('[DATA] falls back to a concrete Sonnet, never the moving alias, when the registry lists no Claude Sonnet', () => {
    expect(pinDefaultModel([entry('openai/gpt-4o'), entry('deepseek/deepseek-chat')])).toBe(FALLBACK_PINNED_MODEL);
    expect(pinDefaultModel([])).toBe(FALLBACK_PINNED_MODEL);
    expect(isMovingModelAlias(FALLBACK_PINNED_MODEL)).toBe(false);
  });
});

describe('isMovingModelAlias', () => {
  it('[DATA] flags OpenRouter latest aliases and nothing concrete', () => {
    expect(isMovingModelAlias(DEFAULT_MODEL)).toBe(true);
    expect(isMovingModelAlias('anthropic/claude-sonnet-5.5')).toBe(false);
  });
});

describe('a preferred default model', () => {
  const sonnet = { id: 'anthropic/claude-sonnet-5.5', retiredAt: null, supportsTools: true, supportedParameters: ['tools', 'structured_outputs'] };
  const gpt = { id: 'openai/gpt-5.2', retiredAt: null, supportsTools: true, supportedParameters: ['tools'] };
  const textOnly = { id: 'acme/text-only', retiredAt: null, supportsTools: false };
  const retired = { id: 'openai/gpt-4', retiredAt: '2026-01-01T00:00:00.000Z', supportsTools: true };

  it('wins while it is live and can call tools, else the pinned Sonnet does', () => {
    const models = [sonnet, gpt, textOnly, retired];
    expect(pinDefaultModel(models, 'openai/gpt-5.2')).toBe('openai/gpt-5.2');
    expect(pinDefaultModel(models, 'acme/text-only')).toBe(sonnet.id);
    expect(pinDefaultModel(models, 'openai/gpt-4')).toBe(sonnet.id);
  });

  it('starts a judge only when it can also return structured output', () => {
    expect(pinDefaultJudgeModel([sonnet, gpt], 'openai/gpt-5.2')).toBe(sonnet.id);
    expect(pinDefaultJudgeModel([sonnet, gpt], sonnet.id)).toBe(sonnet.id);
  });
});

describe('effectiveModelSettings', () => {
  it('takes each of the member\'s own settings over the workspace\'s, field by field', () => {
    expect(effectiveModelSettings({ outputBudget: 'low', defaultModel: 'openai/gpt-5.2' }, { outputBudget: 'max' }))
      .toEqual({ outputBudget: 'max', defaultModel: 'openai/gpt-5.2' });
  });

  it('is the default budget and no model when nothing is set', () => {
    expect(effectiveModelSettings(null, null)).toEqual({ outputBudget: 'default', defaultModel: undefined });
  });
});
