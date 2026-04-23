import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { upsertLegacyDefinition } from '../upsert-legacy-definition.js';
import { ConflictError, ValidationError } from '../../../errors.js';

const VALID_YAML = `
name: supplier-review
version: "1.0"
description: demo
steps:
  - id: intake
    name: Intake
    type: creation
  - id: review
    name: Review
    type: review
  - id: done
    name: Done
    type: terminal
transitions:
  - from: intake
    to: review
  - from: review
    to: done
triggers:
  - name: manual
    type: manual
`.trim();

describe('upsertLegacyDefinition handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
  });

  it('persists the definition and returns name/version on success', async () => {
    const result = await upsertLegacyDefinition({ yaml: VALID_YAML }, { processRepo });

    expect(result).toEqual({
      success: true,
      name: 'supplier-review',
      version: '1.0',
    });
    const stored = await processRepo.getProcessDefinition('supplier-review', '1.0');
    expect(stored).not.toBeNull();
  });

  it('auto-creates an all-human config when none exists', async () => {
    await upsertLegacyDefinition({ yaml: VALID_YAML }, { processRepo });

    const config = await processRepo.getProcessConfig(
      'supplier-review',
      'all-human',
      '1.0',
    );
    expect(config).not.toBeNull();
    expect(config?.stepConfigs.every((s) => s.executorType === 'human')).toBe(true);
    // 'terminal' steps omitted
    expect(config?.stepConfigs.find((s) => s.stepId === 'done')).toBeUndefined();
  });

  it('throws ValidationError when YAML is malformed', async () => {
    await expect(
      upsertLegacyDefinition({ yaml: '::::not-yaml' }, { processRepo }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps DefinitionVersionAlreadyExistsError to ConflictError', async () => {
    const failing: InMemoryProcessRepository = Object.create(processRepo);
    failing.saveProcessDefinition = async () => {
      const err = new Error('already exists');
      err.name = 'DefinitionVersionAlreadyExistsError';
      throw err;
    };

    await expect(
      upsertLegacyDefinition({ yaml: VALID_YAML }, { processRepo: failing }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
