import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NamespaceSecretsRepository, ModelRegistryRepository, ModelRegistryEntry } from '@mediforce/platform-core';
import { InMemoryAuditRepository, InMemoryProcessInstanceRepository } from '@mediforce/platform-core/testing';
import { askWorkflowAssistant } from '../ask-workflow-assistant';
import { HandlerError, ValidationError } from '../../../errors';
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

function mockOpenRouterResponse(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  );
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
    fetchSpy = mockOpenRouterResponse({
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
    fetchSpy = mockOpenRouterResponse({
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
    fetchSpy = mockOpenRouterResponse({
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
      }), { status: 200 }));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe('Set up the review step as an approve/reject decision.');
    expect(result.toolCalls).toHaveLength(2);

    const secondCallBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    const nudge = secondCallBody.messages.find((m: { role: string; content: string }) =>
      m.role === 'user' && m.content.includes('workflow graph is incomplete'));
    expect(nudge).toBeDefined();
    expect(nudge.content).toMatch(/ship-it/);
  });

  it('resolves a verdict target that references a new step\'s clientId, using its real (slugified) id — not the clientId string itself', async () => {
    fetchSpy = mockOpenRouterResponse({
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

    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
      }), { status: 200 }));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
      }), { status: 200 }));

    const scope = createTestScope({
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      modelRegistryRepo: fixedModelRegistry([pricierModel, cheapModel]),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await askWorkflowAssistant({ ...baseInput, namespace: 'team-alpha' }, scope);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
    expect(fetchSpy).toHaveBeenCalledTimes(5);
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
});
