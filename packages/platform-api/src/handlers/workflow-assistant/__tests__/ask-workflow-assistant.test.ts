import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NamespaceSecretsRepository, ModelRegistryRepository, ModelRegistryEntry } from '@mediforce/platform-core';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
} from '@mediforce/platform-core/testing';
import { askWorkflowAssistant } from '../ask-workflow-assistant';
import { ForbiddenError, HandlerError, ValidationError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

function fixedModelRegistry(entries: ModelRegistryEntry[]): ModelRegistryRepository {
  return {
    async getById(id) {
      return entries.find((e) => e.id === id) ?? null;
    },
    async list() {
      return entries;
    },
    async listIds() {
      return entries.map((e) => e.id);
    },
    async upsert(entry) {
      return entry as ModelRegistryEntry;
    },
    async update(input) {
      return input as ModelRegistryEntry;
    },
    async delete() {},
    async bulkUpsert() {
      return 0;
    },
    async updateRankings() {
      return 0;
    },
    async retireAbsentModels() {
      return { retired: 0, reinstated: 0 };
    },
    async getMeta() {
      return { rankingsUpdatedAt: null };
    },
  };
}

function buildModel(overrides: Partial<ModelRegistryEntry>): ModelRegistryEntry {
  return {
    id: 'test/model',
    canonicalSlug: null,
    name: 'Test Model',
    provider: 'test',
    contextLength: 8000,
    maxCompletionTokens: null,
    pricing: { input: 0.0001, output: 0.0002 },
    modality: 'text->text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision: false,
    source: 'openrouter',
    requestCount: null,
    lastSyncedAt: '2025-01-01',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    retiredAt: null,
    ...overrides,
  };
}

function fixedNamespaceSecrets(values: Record<string, string>): NamespaceSecretsRepository {
  return {
    async getSecrets() {
      return values;
    },
    async getSecretKeys() {
      return Object.keys(values);
    },
    async setSecrets() {},
    async upsertSecret() {},
    async deleteSecret() {},
  };
}

interface MockOpenRouterBody {
  choices: {
    message: {
      content: string;
      tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
    };
    finish_reason?: string;
  }[];
}

/** The same response to every call — for the tests that assert what a batch is
 *  told when the model cannot fix it, which needs the model to keep repeating
 *  itself until the loop gives up. */
function mockOpenRouterResponse(body: MockOpenRouterBody) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  );
}

/**
 * One mocked model turn, then the turn that closes it. The model ends its own
 * turn by answering with no tool calls, so a mocked batch on its own leaves the
 * loop asking for more; the closing turn repeats the same content, which is
 * what these assertions read.
 */
function mockOpenRouterTurn(body: MockOpenRouterBody) {
  const closing: MockOpenRouterBody = {
    choices: [{ message: { content: body.choices[0]?.message.content ?? '', tool_calls: [] } }],
  };
  return vi.spyOn(globalThis, 'fetch')
    .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(closing), { status: 200 })));
}

const baseInput = {
  messages: [{ role: 'user' as const, content: 'Add a review step' }],
  workflowDefinition: {
    steps: [
      { id: 'draft', name: 'Draft', type: 'creation' as const, executor: 'human' as const },
      { id: 'review', name: 'Review', type: 'creation' as const, executor: 'human' as const },
      { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
    ],
    transitions: [
      { from: 'draft', to: 'review' },
      { from: 'review', to: 'done' },
    ],
  },
};

describe('askWorkflowAssistant handler', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('returns a plain-text reply when the model makes no tool call', async () => {
    fetchSpy = mockOpenRouterResponse({
      choices: [{ message: { content: 'Sure, what should it do?', tool_calls: [] } }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result).toEqual({ reply: 'Sure, what should it do?' });
  });

  it('logs the user prompt and the model used to the audit trail (the only durable record of an otherwise-stateless conversation)', async () => {
    fetchSpy = mockOpenRouterResponse({
      choices: [{ message: { content: 'Sure.', tool_calls: [] } }],
    });
    const auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
      auditRepo,
    });

    await askWorkflowAssistant(
      { ...baseInput, messages: [{ role: 'user', content: 'Build a LinkedIn post filter' }], model: 'anthropic/claude-opus-4.8', namespace: 'team-alpha' },
      scope,
    );

    const entry = auditRepo.getAll().find((e) => e.action === 'workflow_assistant.prompt');
    expect(entry).toBeDefined();
    expect(entry?.inputSnapshot.prompt).toBe('Build a LinkedIn post filter');
    expect(entry?.inputSnapshot.model).toBe('anthropic/claude-opus-4.8');
  });

  it('carries the accumulated tool calls through when the reply arrives in a later, tool-call-free turn (the "wrote a summary but the canvas never updated" bug)', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'add_step', arguments: JSON.stringify({ type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' }) },
            }],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Added a review step before the end.', tool_calls: [] } }],
      }), { status: 200 }));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe('Added a review step before the end.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]).toEqual({
      tool: 'add_step',
      arguments: { type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' },
    });
  });

  it('returns a validated tool call when the model calls add_step', async () => {
    fetchSpy = mockOpenRouterTurn({
      choices: [{
        message: {
          content: 'Added a human review step.',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'add_step',
              arguments: JSON.stringify({ type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' }),
            },
          }],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result).toEqual({
      reply: 'Added a human review step.',
      toolCalls: [{ tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' } }],
    });
  });

  it("returns the model's own narration alongside tool calls instead of dropping it", async () => {
    fetchSpy = mockOpenRouterTurn({
      choices: [{
        message: {
          content: 'Added a human review step after the draft.',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'add_step', arguments: JSON.stringify({ type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' }) },
          }],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result).toEqual({
      reply: 'Added a human review step after the draft.',
      toolCalls: [{ tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' } }],
    });
  });

  it('returns every tool call when the model batches several in one response', async () => {
    fetchSpy = mockOpenRouterTurn({
      choices: [{
        message: {
          content: 'Swapped the review step for a Generate agent step.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'remove_step', arguments: JSON.stringify({ stepId: 'review' }) },
            },
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'add_step',
                arguments: JSON.stringify({
                  type: 'creation', executor: 'agent', name: 'Generate', clientId: 'generate',
                  insertAfterId: 'draft', insertBeforeId: 'done',
                }),
              },
            },
          ],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result.reply).toBe('Swapped the review step for a Generate agent step.');
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls?.[0]).toEqual({ tool: 'remove_step', arguments: { stepId: 'review' } });
    expect(result.toolCalls?.[1]).toEqual({
      tool: 'add_step',
      arguments: {
        type: 'creation', executor: 'agent', name: 'Generate', clientId: 'generate',
        insertAfterId: 'draft', insertBeforeId: 'done',
      },
    });
  });

  it('retries in the same turn when the batch leaves the graph structurally invalid, and succeeds once the model fixes it', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'update_step',
                arguments: JSON.stringify({
                  stepId: 'review', type: 'decision',
                  verdicts: { approve: { target: 'ship-it' }, reject: { target: 'done' } },
                }),
              },
            }],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'Set up the review step as an approve/reject decision.',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: {
                name: 'update_step',
                arguments: JSON.stringify({
                  stepId: 'review', type: 'decision',
                  verdicts: { approve: { target: 'done' }, reject: { target: 'done' } },
                }),
              },
            }],
          },
        }],
      }), { status: 200 }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: 'Set up the review step as an approve/reject decision.', tool_calls: [] } }],
      }), { status: 200 })));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.reply).toBe('Set up the review step as an approve/reject decision.');
    expect(result.toolCalls).toHaveLength(2);

    const secondCallBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    const nudge = secondCallBody.messages.find((m: { role: string; content: string }) =>
      m.role === 'user' && m.content.includes('workflow graph is incomplete'));
    expect(nudge).toBeDefined();
    expect(nudge.content).toMatch(/ship-it/);
  });

  it('resolves a verdict target that references a new step\'s clientId, using its real (slugified) id — not the clientId string itself', async () => {
    fetchSpy = mockOpenRouterTurn({
      choices: [{
        message: {
          content: 'Added the results email and connected approval to it.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'add_step',
                arguments: JSON.stringify({
                  type: 'creation', executor: 'action', name: 'Send Results Email', clientId: 'email',
                  action: { kind: 'email', config: { to: 'a@b.com', subject: 's', body: 'b' } },
                  insertAfterId: 'review', insertBeforeId: 'done',
                }),
              },
            },
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'update_step',
                arguments: JSON.stringify({
                  stepId: 'review', type: 'decision',
                  verdicts: { approve: { target: 'email' }, reject: { target: 'done' } },
                }),
              },
            },
          ],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls?.[1]).toEqual({
      tool: 'update_step',
      arguments: {
        stepId: 'review', type: 'decision',
        verdicts: { approve: { target: 'email' }, reject: { target: 'done' } },
      },
    });
  });

  it('gives the model a chance to self-correct an unknown tool call instead of crashing the request', async () => {
    fetchSpy = mockOpenRouterResponse({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'delete_everything', arguments: '{}' },
          }],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(HandlerError);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('recovers when the model fixes malformed tool arguments on retry, instead of failing the whole request', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_step', arguments: 'not json' } }],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'Fixed it.',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: { name: 'add_step', arguments: JSON.stringify({ type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' }) },
            }],
          },
        }],
      }), { status: 200 }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: 'Fixed it.', tool_calls: [] } }],
      }), { status: 200 })));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      reply: 'Fixed it.',
      toolCalls: [{ tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'review', insertBeforeId: 'done' } }],
    });
  });

  it('coerces a bare-string action into a specific, fixable "config required" error fed back to the model', async () => {
    fetchSpy = mockOpenRouterResponse({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'add_step',
              arguments: JSON.stringify({ type: 'creation', executor: 'action', name: 'Notify', action: 'email' }),
            },
          }],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope)).rejects.toThrow(HandlerError);

    const secondCallBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    const toolResultMessage = secondCallBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(JSON.parse(toolResultMessage.content).error).toMatch(/action\.config/);
  });

  it('includes the actual bad value in the fed-back error, since Zod\'s own message never does', async () => {
    fetchSpy = mockOpenRouterResponse({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'add_step',
              arguments: JSON.stringify({
                type: 'creation', executor: 'action', name: 'Notify',
                action: { kind: 'launch_missiles', config: {} },
              }),
            },
          }],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope)).rejects.toThrow(HandlerError);

    const secondCallBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    const toolResultMessage = secondCallBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(JSON.parse(toolResultMessage.content).error).toMatch(/you sent for 'action\.kind': "launch_missiles"/);
  });

  it('falls back to the parent object in the fed-back error when the bad field is itself absent (e.g. an unknown kind alias that leaves `kind` unset)', async () => {
    fetchSpy = mockOpenRouterResponse({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'add_step',
              arguments: JSON.stringify({
                type: 'creation', executor: 'action', name: 'Notify',
                action: { flavor: 'email', config: {} },
              }),
            },
          }],
        },
      }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope)).rejects.toThrow(HandlerError);

    const secondCallBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    const toolResultMessage = secondCallBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(JSON.parse(toolResultMessage.content).error).toMatch(/you sent for 'action': .*"flavor":"email"/);
  });

  it('resolves list_models server-side, then continues the loop and returns the follow-up tool call', async () => {
    const cheapModel = buildModel({ id: 'test/cheap-model', name: 'Cheap Model', pricing: { input: 0.00001, output: 0.00002 } });
    const pricierModel = buildModel({ id: 'test/pricier-model', name: 'Pricier Model', pricing: { input: 0.001, output: 0.002 } });

    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_models', arguments: '{"preference":"cheap"}' } }],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'Added a Generate step using the cheapest available model.',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: {
                name: 'add_step',
                arguments: JSON.stringify({
                  type: 'creation', executor: 'agent', name: 'Generate', agent: { model: 'test/cheap-model' },
                  insertAfterId: 'review', insertBeforeId: 'done',
                }),
              },
            }],
          },
        }],
      }), { status: 200 }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: 'Added a Generate step using the cheapest available model.', tool_calls: [] } }],
      }), { status: 200 })));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      modelRegistryRepo: fixedModelRegistry([pricierModel, cheapModel]),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      reply: 'Added a Generate step using the cheapest available model.',
      toolCalls: [{
        tool: 'add_step',
        arguments: {
          type: 'creation', executor: 'agent', name: 'Generate', agent: { model: 'test/cheap-model' },
          insertAfterId: 'review', insertBeforeId: 'done',
        },
      }],
    });
  });

  it('throws after the tool loop cap if the model never stops requesting model data', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_models', arguments: '{}' } }],
        },
      }],
    }), { status: 200 })));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      modelRegistryRepo: fixedModelRegistry([buildModel({})]),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(HandlerError);
    // Twelve build turns, then one more that tries to turn the failure into a
    // question. This model answers that with another tool call rather than the
    // question it was asked for, so there is nothing to hand back and the error
    // stands.
    expect(fetchSpy).toHaveBeenCalledTimes(13);
  });

  it('throws HandlerError when OPENROUTER_API_KEY is missing', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({}),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('rejects a missing namespace', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: '' }, scope))
      .rejects.toThrow(ValidationError);
  });

  it('recovers from a length-truncated turn: applies the steps that landed and continues on the next turn', async () => {
    // Turn 1 is cut off mid-response (finish_reason 'length'): the first add_step
    // parsed cleanly, the second is truncated JSON. The salvaged step must be
    // applied and the model asked to continue — not thrown away as a hard error.
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          finish_reason: 'length',
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'add_step', arguments: JSON.stringify({ type: 'creation', executor: 'human', name: 'Extra', insertAfterId: 'review', insertBeforeId: 'done' }) },
              },
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'add_step', arguments: '{"type":"creation","executor":"human","name":"Trunc' },
              },
            ],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'Built the pipeline.', tool_calls: [] } }],
      }), { status: 200 }));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe('Built the pipeline.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]).toMatchObject({ tool: 'add_step', arguments: { name: 'Extra' } });
  });

  it('still errors when a turn truncates before even one tool call is complete', async () => {
    fetchSpy = mockOpenRouterResponse({
      choices: [{
        finish_reason: 'length',
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'add_step', arguments: '{"type":"creat' },
          }],
        },
      }],
    });

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(/truncated/i);
  });
});

// Platform tools run inside the turn, unlike the canvas tools the browser
// applies. This covers the whole loop: the model asks, the platform answers as
// the caller, and the answer goes back into the conversation.
describe('askWorkflowAssistant — a batch that leaves the graph valid', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('keeps the turn going until the model stops calling tools', async () => {
    // The failure this replaces: the model opened with `update_workflow` and a
    // sentence announcing the build ("I'll build the workflow you described").
    // The starter graph was already valid, so the turn was declared finished on
    // that first batch — the settings landed, the steps never did, and the
    // person read a confirmation of work that had not happened. The model ends
    // its own turn now, by answering with no tool calls.
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: "I'll build the workflow you described.",
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'update_workflow', arguments: JSON.stringify({ preamble: 'House rules.' }) },
            }],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: { name: 'add_step', arguments: JSON.stringify({ type: 'creation', executor: 'human', name: 'Sign-off', insertAfterId: 'review', insertBeforeId: 'done' }) },
            }],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Added a sign-off step and the house rules.', tool_calls: [] } }],
      }), { status: 200 }));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.reply).toBe('Added a sign-off step and the house rules.');
    expect(result.toolCalls?.map((call) => call.tool)).toEqual(['update_workflow', 'add_step']);
  });

  it('asks for the summary when the model stops calling tools without writing one', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'add_step', arguments: JSON.stringify({ type: 'creation', executor: 'human', name: 'Sign-off', insertAfterId: 'review', insertBeforeId: 'done' }) },
            }],
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '', tool_calls: [] } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Added a sign-off step before the end.', tool_calls: [] } }],
      }), { status: 200 }));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result.reply).toBe('Added a sign-off step before the end.');
    expect(result.toolCalls).toHaveLength(1);
  });
});

describe('askWorkflowAssistant — platform tools', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  /** Two model turns: the first calls a tool, the second replies in words. */
  function mockToolThenReply(toolName: string, args: unknown, reply = 'Done.') {
    let call = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      const body = call === 1
        ? {
            choices: [{
              message: {
                content: '',
                tool_calls: [{ id: 'call-1', type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }],
              },
            }],
          }
        : { choices: [{ message: { content: reply, tool_calls: [] } }] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
  }

  /** What the model was told back, for the tool call it made. */
  function toolResultSentBack(spy: ReturnType<typeof vi.spyOn>): unknown {
    const secondRequest = spy.mock.calls[1]?.[1] as { body?: string } | undefined;
    const body = JSON.parse(secondRequest?.body ?? '{}') as {
      messages: { role: string; content: string }[];
    };
    const toolMessage = body.messages.find((m) => m.role === 'tool');
    return JSON.parse(toolMessage?.content ?? 'null');
  }

  it('creates an agent in the workspace and tells the model it worked', async () => {
    fetchSpy = mockToolThenReply('create_agent', {
      name: 'Report writer',
      description: 'Writes the validation report',
      systemPrompt: 'You write reports.',
      foundationModel: 'anthropic/claude-sonnet-4.6',
      inputDescription: 'Findings',
      outputDescription: 'An HTML report',
    }, 'Created the Report writer agent.');

    const agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
      agentDefinitionRepo,
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result.reply).toBe('Created the Report writer agent.');
    // No canvas mutation: this one changed the platform, not the workflow.
    expect(result.toolCalls).toBeUndefined();

    const agents = await agentDefinitionRepo.listVisibleTo(['team-alpha']);
    expect(agents.map((a) => a.name)).toEqual(['Report writer']);
    expect(agents[0].namespace).toBe('team-alpha');
    expect(toolResultSentBack(fetchSpy)).toMatchObject({ created: { name: 'Report writer' } });
  });

  it('answers list_secrets with key names, never values', async () => {
    fetchSpy = mockToolThenReply('list_secrets', {}, 'You have OPENROUTER_API_KEY and STUDY_ID set.');
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test-secret-value', STUDY_ID: 'CDISCPILOT01' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    const sentBack = toolResultSentBack(fetchSpy);
    expect(sentBack).toEqual({ keys: ['OPENROUTER_API_KEY', 'STUDY_ID'] });
    expect(JSON.stringify(sentBack)).not.toContain('or-test-secret-value');
    expect(JSON.stringify(sentBack)).not.toContain('CDISCPILOT01');
  });

  it('relays a refusal instead of failing the conversation', async () => {
    // The assistant has the caller's permissions and nothing more. A member who
    // may not create an agent gets told so, in the same turn, and the reply
    // still comes back — which is what lets the assistant say "ask an admin".
    fetchSpy = mockToolThenReply('create_agent', {
      name: 'X', description: 'X', systemPrompt: 'X',
      foundationModel: 'anthropic/claude-sonnet-4.6', inputDescription: 'X', outputDescription: 'X',
    }, 'That needs an admin — I cannot create agents for you.');

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });
    scope.agentDefinitions.create = () => Promise.reject(new ForbiddenError('Only admins may create agents'));

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result.reply).toBe('That needs an admin — I cannot create agents for you.');
    expect(toolResultSentBack(fetchSpy)).toEqual({
      error: 'Only admins may create agents',
      needsAdmin: true,
    });
  });
});

// A build that cannot finish used to throw, which the pane showed as an error
// toast: the turn was gone and the person had nothing to act on. It asks now.
describe('askWorkflowAssistant — when it cannot finish', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => { fetchSpy?.mockRestore(); });

  /** A model that keeps making the same rejected call, then answers the
   *  "ask the user" turn with a question. */
  function mockStuckThenQuestion(question: unknown) {
    let call = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      call += 1;
      const body = JSON.parse((init as { body?: string } | undefined)?.body ?? '{}') as {
        messages?: { role: string; content?: string }[];
      };
      const asksForQuestion = body.messages?.some(
        (m) => typeof m.content === 'string' && m.content.includes('could not finish'),
      ) === true;
      const payload = asksForQuestion
        ? { choices: [{ message: { content: JSON.stringify(question), tool_calls: [] } }] }
        : {
            choices: [{
              message: {
                content: '',
                tool_calls: [{
                  id: `call-${String(call)}`,
                  type: 'function',
                  function: { name: 'remove_step', arguments: JSON.stringify({ stepId: 'ghost' }) },
                }],
              },
            }],
          };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    });
  }

  it('comes back with a question instead of throwing', async () => {
    fetchSpy = mockStuckThenQuestion({
      reply: 'I could not remove that step — it is not on the canvas any more.',
      questions: [{ id: 'which-step', question: 'Which step did you mean?', recommended: 'the review step' }],
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(result.reply).toContain('could not remove that step');
    expect(result.questions?.[0]).toMatchObject({ id: 'which-step', recommended: 'the review step' });
  });

  it('still fails loudly when even the question cannot be written', async () => {
    // Nothing to act on and nothing to say: an error is the honest answer, and
    // the pane still has its toast for it.
    let call = 0;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'not json',
            tool_calls: call > 12 ? [] : [{
              id: `c${String(call)}`,
              type: 'function',
              function: { name: 'remove_step', arguments: JSON.stringify({ stepId: 'ghost' }) },
            }],
          },
        }],
      }), { status: 200 }));
    });
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(HandlerError);
  });
});

// The retry loop used to ask the model to reconnect a step it had no way to
// name: the canvas state in the conversation is the one sent at the start, the
// steps it just added carry reducer-assigned ids it has never seen, and the
// clientIds it used died with the previous response. So it guessed, every guess
// was rejected as an unknown step, and a five-step workflow burned the cap.
describe('askWorkflowAssistant — naming the steps it just created', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => { fetchSpy?.mockRestore(); });

  /** Adds a decision step whose verdict points at nothing — an incomplete graph
   *  the model then has to fix, which is when it needs the real ids. */
  function mockOrphanThenReply() {
    let call = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'add_step',
                  arguments: JSON.stringify({
                    type: 'decision',
                    executor: 'human',
                    name: 'Poll SFTP',
                    insertAfterId: 'draft',
                    insertBeforeId: 'review',
                    verdicts: { approve: { target: 'nowhere' } },
                  }),
                },
              }],
            },
          }],
        }), { status: 200 }));
      }
      if (call === 2) {
        return Promise.resolve(new Response(JSON.stringify({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-2',
                type: 'function',
                function: {
                  name: 'update_step',
                  arguments: JSON.stringify({ stepId: 'poll-sftp', verdicts: { approve: { target: 'review' } } }),
                },
              }],
            },
          }],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: 'Built it.', tool_calls: [] } }],
      }), { status: 200 }));
    });
  }

  function secondRequestMessages(spy: ReturnType<typeof vi.spyOn>): { role: string; content?: string }[] {
    const init = spy.mock.calls[1]?.[1] as { body?: string } | undefined;
    return (JSON.parse(init?.body ?? '{}') as { messages?: { role: string; content?: string }[] }).messages ?? [];
  }

  it('tells the model the ids the canvas now has, so it can reference them', async () => {
    fetchSpy = mockOrphanThenReply();
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    const retry = secondRequestMessages(fetchSpy).at(-1);
    expect(retry?.role).toBe('user');
    // The id the reducer assigned to the step it just added — the one thing it
    // could not have known and needs in order to connect it.
    expect(retry?.content).toContain('poll-sftp');
    // And the steps that were already there, so a fix can reference either.
    expect(retry?.content).toContain('draft');
    expect(retry?.content).toContain('done');
  });

  it('describes the transitions too, so it can see what is missing', async () => {
    fetchSpy = mockOrphanThenReply();
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    const retry = secondRequestMessages(fetchSpy).at(-1);
    // Inserting between two steps rewires both edges, and the model has to see
    // that rather than the edge list it sent.
    expect(retry?.content).toMatch(/draft → poll-sftp/);
    expect(retry?.content).toMatch(/poll-sftp → review/);
  });

  it('stops telling it to use a clientId from a previous response', async () => {
    // They are dead by the next response, and the prompt says so — asking for
    // one here is what sent it guessing.
    fetchSpy = mockOrphanThenReply();
    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    const retry = secondRequestMessages(fetchSpy).at(-1);
    expect(retry?.content).not.toContain('clientId you assigned it earlier');
  });
});
