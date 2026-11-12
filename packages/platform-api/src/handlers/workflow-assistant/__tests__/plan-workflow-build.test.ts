import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NamespaceSecretsRepository } from '@mediforce/platform-core';
import { planWorkflowBuild } from '../plan-workflow-build';
import { HandlerError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { InMemoryNamespaceRepo } from '../../../testing/in-memory-namespace-repo';
import { registryEntry } from '../../evaluation/__tests__/fixture';

function fixedNamespaceSecrets(values: Record<string, string>): NamespaceSecretsRepository {
  return {
    async getSecrets() { return values; },
    async getSecretKeys() { return Object.keys(values); },
    async setSecrets() {},
    async upsertSecret() {},
    async deleteSecret() {},
  };
}

function mockModel(content: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content), tool_calls: [] } }],
    }), { status: 200 })));
}

const input = {
  messages: [{ role: 'user' as const, content: 'Poll an SFTP server every 15 minutes and validate the files' }],
  workflowDefinition: {
    steps: [
      { id: 'draft', name: 'Draft', type: 'creation' as const, executor: 'human' as const },
      { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
    ],
    transitions: [{ from: 'draft', to: 'done' }],
  },
  namespace: 'team-alpha',
};

const scope = () => createTestScope({
  namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
  caller: userCaller('u-1', ['team-alpha']),
});

describe('planWorkflowBuild', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => { fetchSpy?.mockRestore(); });

  it('raises the plan\'s limit under a high budget but never lowers it under a low one', async () => {
    const maxTokensSent = async (outputBudget: 'low' | 'high') => {
      fetchSpy?.mockRestore();
      fetchSpy = mockModel({ plan: ['One step'], questions: [], phases: ['Working'] });
      const namespaceRepo = new InMemoryNamespaceRepo();
      namespaceRepo.seedNamespace({ handle: 'team-alpha', type: 'organization', displayName: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z', outputBudget });
      const models = new InMemoryModelRegistryRepository();
      await models.upsert(registryEntry('openai/gpt-5.2', { maxCompletionTokens: 64_000 }));
      const budgeted = createTestScope({
        namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
        caller: userCaller('u-1', ['team-alpha']),
        namespaceRepo,
        modelRegistryRepo: models,
      });
      await planWorkflowBuild({ ...input, model: 'openai/gpt-5.2' }, budgeted);
      return (JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { max_tokens: number }).max_tokens;
    };
    expect(await maxTokensSent('low')).toBe(700);
    expect(await maxTokensSent('high')).toBe(1_400);
  });

  it('returns the plan, the questions and the phases for this build', async () => {
    fetchSpy = mockModel({
      plan: ['Poll the SFTP server on a 15-minute cron', 'Validate each delivery with a carried script'],
      questions: [{ id: 'sftp-secret', question: 'Which secret holds the SFTP password?', recommended: 'SFTP_PASS_CDISCPILOT01' }],
      phases: ['Reading the delivery shape', 'Writing the validation script'],
    });

    const result = await planWorkflowBuild(input, scope());

    expect(result.plan).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({ id: 'sftp-secret', recommended: 'SFTP_PASS_CDISCPILOT01' });
    expect(result.phases).toEqual(['Reading the delivery shape', 'Writing the validation script']);
  });

  it('accepts a plan with nothing to ask, which is the common case for an edit', async () => {
    fetchSpy = mockModel({ plan: ['Add a review step after extraction'], questions: [], phases: ['Adding the review step'] });
    const result = await planWorkflowBuild(input, scope());
    expect(result.questions).toEqual([]);
  });

  it('reads a plan the model wrapped in a code fence', async () => {
    // Models fence JSON even when told not to, and a planning turn that fails
    // on formatting would block the build behind a cosmetic problem.
    fetchSpy = mockModel('```json\n{"plan":["One step"],"questions":[],"phases":["Working"]}\n```');
    const result = await planWorkflowBuild(input, scope());
    expect(result.plan).toEqual(['One step']);
  });

  it('degrades to no plan rather than failing the turn', async () => {
    // The plan is an aid, not the work. If the model returns something
    // unreadable, the build still has to be able to run.
    fetchSpy = mockModel('I think we should start by considering the requirements.');
    const result = await planWorkflowBuild(input, scope());
    expect(result).toEqual({ plan: [], questions: [], phases: [] });
  });

  it('refuses without the workspace key that pays for the call', async () => {
    const noKey = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({}),
      caller: userCaller('u-1', ['team-alpha']),
    });
    await expect(planWorkflowBuild(input, noKey)).rejects.toThrow(HandlerError);
  });

  it('never asks more than a handful of questions', async () => {
    // A wall of questions is the interrogation this exists to avoid; the
    // contract caps it and the handler keeps the first few.
    fetchSpy = mockModel({
      plan: ['Build it'],
      questions: Array.from({ length: 9 }, (_, i) => ({ id: `q${String(i)}`, question: `Question ${String(i)}?`, recommended: 'Yes' })),
      phases: [],
    });
    const result = await planWorkflowBuild(input, scope());
    expect(result.questions.length).toBeLessThanOrEqual(5);
  });
});
