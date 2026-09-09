import { describe, it, expect } from 'vitest';
import { buildPlanPrompt } from '../plan-prompt';

describe('buildPlanPrompt', () => {
  const prompt = buildPlanPrompt();

  it('asks for the three parts the pane renders', () => {
    expect(prompt).toMatch(/"plan"/);
    expect(prompt).toMatch(/"questions"/);
    expect(prompt).toMatch(/"phases"/);
  });

  it('requires a recommended answer with every question', () => {
    // A question with no proposed answer hands the decision back, which is the
    // interrogation this turn exists to avoid.
    expect(prompt).toMatch(/carries a `recommended` answer/);
    expect(prompt).toMatch(/agreeing is one word/);
  });

  it('forbids asking for a secret value, and asks for the key instead', () => {
    expect(prompt).toMatch(/Never ask for a secret's value/);
    expect(prompt).toMatch(/ask which key holds it/);
  });

  it('says to ask nothing when nothing is missing', () => {
    expect(prompt).toMatch(/Ask nothing when the request and the canvas already answer everything/);
  });

  it('wants phases written for this build, not generic words', () => {
    expect(prompt).toMatch(/Writing the validation script/);
    expect(prompt).toMatch(/generic words like "Working" or "Processing" are wasted/);
  });

  it('speaks in the user\'s terms rather than the schema\'s', () => {
    expect(prompt).toMatch(/in the user's own terms, not the schema's/);
  });
});
