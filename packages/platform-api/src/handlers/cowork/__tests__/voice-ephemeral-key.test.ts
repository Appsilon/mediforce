import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createVoiceEphemeralKey } from '../voice-ephemeral-key';
import { HandlerError, NotFoundError, PreconditionFailedError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('createVoiceEphemeralKey handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    coworkSessionRepo = new InMemoryCoworkSessionRepository(instanceRepo);
    process.env.OPENAI_API_KEY = 'sk-test-openai';

    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    delete process.env.OPENAI_API_KEY;
  });

  it('mints an ephemeral key for a voice-realtime session', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-voice',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'voice-realtime',
        model: 'gpt-4o-realtime-preview',
      }),
    );

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          client_secret: { value: 'ek_abc123' },
          model: 'gpt-4o-realtime-preview',
        }),
        { status: 200 },
      ),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await createVoiceEphemeralKey({ sessionId: 'sess-voice' }, scope);

    expect(result).toEqual({
      ephemeralKey: 'ek_abc123',
      model: 'gpt-4o-realtime-preview',
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/realtime/sessions');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-test-openai',
    });
  });

  it('throws HandlerError(validation) when session is not voice-realtime', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-chat',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'chat',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const err = await createVoiceEphemeralKey({ sessionId: 'sess-chat' }, scope).catch((e) => e);
    expect(err).toBeInstanceOf(HandlerError);
    expect((err as HandlerError).code).toBe('validation');
  });

  it('throws HandlerError(validation) when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
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

    const err = await createVoiceEphemeralKey({ sessionId: 'sess-voice' }, scope).catch((e) => e);
    expect(err).toBeInstanceOf(HandlerError);
    expect((err as HandlerError).message).toMatch(/OPENAI_API_KEY/);
  });

  it('throws PreconditionFailedError for a finalized session', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-done',
        processInstanceId: 'inst-a',
        status: 'finalized',
        agent: 'voice-realtime',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(createVoiceEphemeralKey({ sessionId: 'sess-done' }, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it('throws NotFoundError for a session in a foreign namespace (anti-enum)', async () => {
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
      caller: userCaller('u-other', ['team-beta']),
    });

    await expect(createVoiceEphemeralKey({ sessionId: 'sess-voice' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });
});
