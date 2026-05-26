import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type {
  NamespaceSecretsRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import { synthesizeVoiceArtifact } from '../voice-synthesize.js';
import { HandlerError, NotFoundError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

function fixedNamespaceSecrets(values: Record<string, string>): NamespaceSecretsRepository {
  return {
    async getSecrets() {
      return values;
    },
    async getSecretKeys() {
      return Object.keys(values);
    },
    async setSecrets() {
      /* no-op */
    },
    async upsertSecret() {
      /* no-op */
    },
    async deleteSecret() {
      /* no-op */
    },
  };
}

function emptyWorkflowSecrets(): WorkflowSecretsRepository {
  return {
    async getSecrets() {
      return {};
    },
    async getSecretKeys() {
      return [];
    },
    async setSecrets() {
      /* no-op */
    },
    async deleteSecrets() {
      /* no-op */
    },
    async deleteSecret() {
      /* no-op */
    },
    async upsertSecret() {
      /* no-op */
    },
  };
}

describe('synthesizeVoiceArtifact handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    coworkSessionRepo = new InMemoryCoworkSessionRepository(instanceRepo);

    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-a',
        namespace: 'team-alpha',
        definitionName: 'wf-design',
      }),
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('persists synthesized artifact and parsed turns', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-voice',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'voice-realtime',
      }),
    );

    const synthesized = { name: 'wf-design', steps: [{ id: 'start' }] };
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(synthesized) } }],
        }),
        { status: 200 },
      ),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      secretsRepo: emptyWorkflowSecrets(),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const transcript = 'User: Build it\nAgent: Done\nMore detail\nUser: ok';
    const result = await synthesizeVoiceArtifact(
      { sessionId: 'sess-voice', transcript },
      scope,
    );

    expect(result.artifact).toEqual(synthesized);

    const updatedSession = await coworkSessionRepo.getById('sess-voice');
    expect(updatedSession?.artifact).toEqual(synthesized);

    const turnContents = (updatedSession?.turns ?? []).map((t) => ({
      role: t.role,
      content: t.content,
    }));
    expect(turnContents).toEqual([
      { role: 'human', content: 'Build it' },
      { role: 'agent', content: 'Done\nMore detail' },
      { role: 'human', content: 'ok' },
    ]);
  });

  it('extracts JSON from a content blob with surrounding text', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-voice',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'voice-realtime',
      }),
    );

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: 'Here you go: {"name":"abc"}\nThanks.' } },
          ],
        }),
        { status: 200 },
      ),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      secretsRepo: emptyWorkflowSecrets(),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await synthesizeVoiceArtifact(
      { sessionId: 'sess-voice', transcript: 'User: hi' },
      scope,
    );

    expect(result.artifact).toEqual({ name: 'abc' });
  });

  it('throws HandlerError when OPENROUTER_API_KEY is missing', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-voice',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'voice-realtime',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const err = await synthesizeVoiceArtifact(
      { sessionId: 'sess-voice', transcript: 'User: hi' },
      scope,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(HandlerError);
    expect((err as HandlerError).message).toMatch(/OPENROUTER_API_KEY/);
  });

  it('throws NotFoundError for a foreign-namespace session', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-voice',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'voice-realtime',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-other', ['team-beta']),
    });

    await expect(
      synthesizeVoiceArtifact(
        { sessionId: 'sess-voice', transcript: 'User: hi' },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
