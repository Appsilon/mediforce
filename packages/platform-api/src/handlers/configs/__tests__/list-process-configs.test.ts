import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  buildProcessConfig,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listProcessConfigs } from '../list-process-configs.js';

describe('listProcessConfigs handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
  });

  it('returns every config for the process', async () => {
    await processRepo.saveProcessConfig(
      buildProcessConfig({ processName: 'p-a', configName: 'default', configVersion: '1.0' }),
    );
    await processRepo.saveProcessConfig(
      buildProcessConfig({ processName: 'p-a', configName: 'default', configVersion: '2.0' }),
    );

    const result = await listProcessConfigs({ processName: 'p-a' }, { processRepo });

    expect(result.configs).toHaveLength(2);
    expect(result.configs.every((c) => c.processName === 'p-a')).toBe(true);
  });

  it('filters out configs that belong to other processes', async () => {
    await processRepo.saveProcessConfig(
      buildProcessConfig({ processName: 'p-a', configName: 'default', configVersion: '1.0' }),
    );
    await processRepo.saveProcessConfig(
      buildProcessConfig({ processName: 'p-b', configName: 'default', configVersion: '1.0' }),
    );

    const result = await listProcessConfigs({ processName: 'p-a' }, { processRepo });

    expect(result.configs).toHaveLength(1);
    expect(result.configs[0].processName).toBe('p-a');
  });

  it('returns an empty array when the process has no configs', async () => {
    const result = await listProcessConfigs(
      { processName: 'unknown-process' },
      { processRepo },
    );

    expect(result.configs).toEqual([]);
  });
});
