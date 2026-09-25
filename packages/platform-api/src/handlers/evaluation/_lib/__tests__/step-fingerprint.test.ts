import { describe, it, expect, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { loadEvaluatedStep } from '../evaluated-step';
import { canonicalJson, changedFingerprintComponents, computeStepFingerprint } from '../step-fingerprint';
import { evaluationFixture, STEP } from '../../__tests__/fixture';

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 3, e: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"f":3}]},"b":1}');
  });
});

describe('computeStepFingerprint', () => {
  async function loaded() {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
    const fingerprint = (patch: { definition?: Partial<WorkflowDefinition>; step?: Partial<WorkflowStep> }) => {
      const patchedStep = { ...step, ...patch.step };
      return computeStepFingerprint(scope, { ...definition, ...patch.definition, steps: [patchedStep] }, patchedStep);
    };
    return { fixture, scope, definition, step, fingerprint };
  }

  it('is stable, and ignores the step\'s name, routing and review', async () => {
    const { fingerprint, step } = await loaded();
    const base = await fingerprint({});

    expect(await fingerprint({})).toEqual(base);
    expect(await fingerprint({
      step: { name: 'Renamed', autonomyLevel: 'L4', review: { type: 'human' }, agent: { ...step.agent, confidenceThreshold: 0.8, fallbackBehavior: 'escalate_to_human' } },
    })).toEqual(base);
    // The agent's model, named on the step, is the model it inherited.
    expect(await fingerprint({ step: { agent: { ...step.agent, model: 'anthropic/claude-sonnet-4' } } })).toEqual(base);
  });

  it('names the component that changed', async () => {
    const { fixture, fingerprint, step } = await loaded();
    const base = await fingerprint({});

    expect(changedFingerprintComponents(base, await fingerprint({ step: { agent: { ...step.agent, model: 'openai/gpt-5' } } }))).toEqual(['model']);
    expect(changedFingerprintComponents(base, await fingerprint({ step: { agent: { ...step.agent, prompt: 'Grade every AE.' } } }))).toEqual(['step']);
    expect(changedFingerprintComponents(base, await fingerprint({ step: { agent: { ...step.agent, examples: [{ input: 'Sepsis, fatal', output: '{"grade": 5}' }] } } }))).toEqual(['step']);
    expect(changedFingerprintComponents(base, await fingerprint({ definition: { preamble: 'Study CDISCPILOT01.' } }))).toEqual(['preamble']);
    expect(changedFingerprintComponents(base, await fingerprint({ step: { mcpRestrictions: { email: { disable: true } } } })))
      .toEqual(['step', 'mcpServers']);

    const agent = (await fixture.agentDefinitionRepo.getById('ae-grader'))!;
    await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent, systemPrompt: 'You grade adverse events by CTCAE v5.' });
    expect(changedFingerprintComponents(base, await fingerprint({}))).toEqual(['systemPrompt']);
  });

  it('does not hash why MCP resolution failed, only that it did', async () => {
    const { scope, fingerprint } = await loaded();
    const getById = vi.spyOn(scope.toolCatalog, 'getById');
    getById.mockRejectedValueOnce(new Error('connection reset'));
    const first = await fingerprint({});
    getById.mockRejectedValueOnce(new Error('statement timeout'));
    expect(await fingerprint({})).toEqual(first);
  });

  it('covers the skill files the workflow carries', async () => {
    const { fingerprint, step } = await loaded();
    const skillStep = { agent: { ...step.agent, skill: 'grading', skillsDir: 'skills' } };
    const artifacts = (contents: string) => ({ artifacts: [
      { path: 'skills/grading/SKILL.md', contents },
      { path: 'scripts/other.py', contents: 'print(1)' },
    ] });

    const base = await fingerprint({ step: skillStep, definition: artifacts('Grade by CTCAE v5.') });
    const edited = await fingerprint({ step: skillStep, definition: artifacts('Grade by CTCAE v6.') });
    expect(changedFingerprintComponents(base, edited)).toEqual(['skill']);
  });
});
