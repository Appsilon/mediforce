import { describe, expect, it, afterEach } from 'vitest';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import { getCapabilities } from '../get-capabilities';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

/**
 * The handler derives availability so the browser never learns which env vars
 * are set. Agent availability reads the registry's own `requiredEnv` groups
 * against the live process env, so these tests set and restore the keys they
 * depend on.
 */

const AGENT_PLUGIN: PluginCapabilityMetadata = {
  name: 'opencode-agent',
  description: 'Runs an agent step.',
  inputDescription: 'Task context.',
  outputDescription: 'Structured result.',
  roles: ['executor'],
  foundationModel: 'deepseek/deepseek-chat',
  requiredEnv: [['OPENROUTER_API_KEY']],
};

/** No foundation model — a script runner, not an agent. */
const SCRIPT_PLUGIN: PluginCapabilityMetadata = {
  name: 'script-container',
  description: 'Runs a script step.',
  inputDescription: 'Task context.',
  outputDescription: 'Structured result.',
  roles: ['executor'],
};

function stubRegistry(entries: ReadonlyArray<{ name: string; metadata?: PluginCapabilityMetadata }>) {
  return { list: () => entries };
}

const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  if (savedOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
});

describe('getCapabilities handler', () => {
  it('reports email as available with the provider that resolved', async () => {
    const scope = createTestScope({
      emailProviderInfo: { provider: 'smtp', configured: true, from: 'noreply@example.com' },
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.email.available).toBe(true);
    expect(capabilities.email.detail).toBe('smtp');
  });

  it('never leaks the configured from address, only the provider', async () => {
    const scope = createTestScope({
      emailProviderInfo: { provider: 'mailgun', configured: true, from: 'noreply@example.com' },
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(JSON.stringify(capabilities)).not.toContain('noreply@example.com');
  });

  it('reports email as unavailable, and says who can fix it, when none is configured', async () => {
    const scope = createTestScope({ emailProviderInfo: null });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.email.available).toBe(false);
    expect(capabilities.email.reason).toMatch(/admin/i);
  });

  it('treats a plugin that resolved as configured but not usable as unavailable', async () => {
    const scope = createTestScope({
      emailProviderInfo: { provider: 'smtp', configured: false, from: null },
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.email.available).toBe(false);
  });

  it('reports agents as available when a model plugin has its env satisfied', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const scope = createTestScope({
      pluginRegistry: stubRegistry([
        { name: 'script-container', metadata: SCRIPT_PLUGIN },
        { name: 'opencode-agent', metadata: AGENT_PLUGIN },
      ]),
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.agents.available).toBe(true);
    expect(capabilities.agents.detail).toBe('opencode-agent');
  });

  it('reports agents as unavailable when the model plugin is registered but unconfigured', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const scope = createTestScope({
      pluginRegistry: stubRegistry([{ name: 'opencode-agent', metadata: AGENT_PLUGIN }]),
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.agents.available).toBe(false);
    expect(capabilities.agents.reason).toMatch(/admin/i);
  });

  it('does not count a script plugin as an agent', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const scope = createTestScope({
      pluginRegistry: stubRegistry([{ name: 'script-container', metadata: SCRIPT_PLUGIN }]),
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.agents.available).toBe(false);
  });
});
