import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createProcessConfig, type PluginRegistryView } from '../create-process-config.js';
import { ConflictError, ValidationError } from '../../../errors.js';

const REGISTRY: PluginRegistryView = {
  list: () => [{ name: 'claude-code-agent' }],
};

const DEFINITION = {
  // The inline Next.js route looked up the definition with the literal string
  // 'latest' as the version (a pre-existing bug). We preserve that behaviour
  // in Phase 2, so the test stores the definition under the same key it will
  // be looked up with — otherwise validation quietly no-ops.
  name: 'wf-a',
  version: 'latest',
  steps: [{ id: 'intake', name: 'Intake', type: 'creation' as const }],
  transitions: [],
  triggers: [{ name: 'manual', type: 'manual' as const }],
};

describe('createProcessConfig handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    await processRepo.saveProcessDefinition(DEFINITION as never);
  });

  it('persists a valid config and returns ok', async () => {
    const result = await createProcessConfig(
      {
        processName: 'wf-a',
        configName: 'all-human',
        configVersion: '1',
        stepConfigs: [{ stepId: 'intake', executorType: 'human' }],
      },
      { processRepo, pluginRegistry: REGISTRY },
    );

    expect(result).toEqual({ ok: true });
    const stored = await processRepo.getProcessConfig('wf-a', 'all-human', '1');
    expect(stored).not.toBeNull();
  });

  it('throws ValidationError when config references unregistered plugins', async () => {
    await expect(
      createProcessConfig(
        {
          processName: 'wf-a',
          configName: 'agent-run',
          configVersion: '2',
          stepConfigs: [
            {
              stepId: 'intake',
              executorType: 'agent',
              plugin: 'nonexistent-plugin',
              agentConfig: { prompt: 'whatever' },
            },
          ],
        },
        { processRepo, pluginRegistry: REGISTRY },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps ConfigVersionAlreadyExistsError to ConflictError', async () => {
    const failing: InMemoryProcessRepository = Object.create(processRepo);
    failing.saveProcessConfig = async () => {
      const err = new Error('already exists');
      err.name = 'ConfigVersionAlreadyExistsError';
      throw err;
    };

    await expect(
      createProcessConfig(
        {
          processName: 'wf-a',
          configName: 'all-human',
          configVersion: '1',
          stepConfigs: [{ stepId: 'intake', executorType: 'human' }],
        },
        { processRepo: failing, pluginRegistry: REGISTRY },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
