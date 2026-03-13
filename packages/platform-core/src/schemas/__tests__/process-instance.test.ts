import { describe, it, expect } from 'vitest';
import {
  ProcessInstanceSchema,
  InstanceStatusSchema,
} from '../process-instance.js';

const validInstance = {
  id: 'pi-001',
  definitionName: 'supply-chain-review',
  definitionVersion: '1.0',
  configName: 'default',
  configVersion: '1.0',
  status: 'created' as const,
  currentStepId: null,
  variables: {},
  triggerType: 'manual' as const,
  triggerPayload: { initiatedBy: 'user-123' },
  createdAt: '2026-02-26T10:00:00Z',
  updatedAt: '2026-02-26T10:00:00Z',
  createdBy: 'user-123',
  pauseReason: null,
  error: null,
};

describe('InstanceStatusSchema', () => {
  it('should accept all valid status values', () => {
    for (const status of ['created', 'running', 'paused', 'completed', 'failed']) {
      const result = InstanceStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    }
  });

  it('should reject an invalid status value', () => {
    const result = InstanceStatusSchema.safeParse('cancelled');
    expect(result.success).toBe(false);
  });

  it('should reject an empty string', () => {
    const result = InstanceStatusSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('ProcessInstanceSchema', () => {
  it('should parse a valid process instance with all nullable fields null', () => {
    const result = ProcessInstanceSchema.safeParse(validInstance);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('pi-001');
      expect(result.data.definitionName).toBe('supply-chain-review');
      expect(result.data.status).toBe('created');
      expect(result.data.currentStepId).toBeNull();
      expect(result.data.pauseReason).toBeNull();
      expect(result.data.error).toBeNull();
    }
  });

  it('should parse a running instance with currentStepId set', () => {
    const running = {
      ...validInstance,
      status: 'running',
      currentStepId: 'collect-data',
      updatedAt: '2026-02-26T10:05:00Z',
    };
    const result = ProcessInstanceSchema.safeParse(running);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentStepId).toBe('collect-data');
    }
  });

  it('should parse a paused instance with pauseReason', () => {
    const paused = {
      ...validInstance,
      status: 'paused',
      pauseReason: 'Max iterations reached on review step',
    };
    const result = ProcessInstanceSchema.safeParse(paused);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pauseReason).toBe('Max iterations reached on review step');
    }
  });

  it('should parse a failed instance with error details', () => {
    const failed = {
      ...validInstance,
      status: 'failed',
      error: 'Gate evaluation threw: unknown gate "data-complete"',
    };
    const result = ProcessInstanceSchema.safeParse(failed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error).toBe('Gate evaluation threw: unknown gate "data-complete"');
    }
  });

  it('should parse an instance with non-empty variables', () => {
    const withVars = {
      ...validInstance,
      variables: {
        'collect-data': { patientId: 'P-001', labResults: [1, 2, 3] },
        'review': { verdict: 'approved' },
      },
    };
    const result = ProcessInstanceSchema.safeParse(withVars);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.variables)).toHaveLength(2);
    }
  });

  it('should accept webhook trigger type', () => {
    const webhook = {
      ...validInstance,
      triggerType: 'webhook',
      triggerPayload: { source: 'external-system', eventId: 'evt-789' },
    };
    const result = ProcessInstanceSchema.safeParse(webhook);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.triggerType).toBe('webhook');
    }
  });

  it('should reject an instance with empty id', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, id: '' });
    expect(result.success).toBe(false);
  });

  it('should reject an instance with empty definitionName', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, definitionName: '' });
    expect(result.success).toBe(false);
  });

  it('should reject an instance with empty definitionVersion', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, definitionVersion: '' });
    expect(result.success).toBe(false);
  });

  it('should reject an instance with empty createdBy', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, createdBy: '' });
    expect(result.success).toBe(false);
  });

  it('should reject an instance with invalid status', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, status: 'cancelled' });
    expect(result.success).toBe(false);
  });

  it('should accept cron trigger type', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, triggerType: 'cron' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.triggerType).toBe('cron');
    }
  });

  it('should reject an instance with invalid triggerType', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, triggerType: 'scheduled' });
    expect(result.success).toBe(false);
  });

  it('should reject an instance with invalid createdAt format', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, createdAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('should reject an instance with missing required fields', () => {
    const { id: _, ...noId } = validInstance;
    const result = ProcessInstanceSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('should reject an instance with missing variables field', () => {
    const { variables: _, ...noVars } = validInstance;
    const result = ProcessInstanceSchema.safeParse(noVars);
    expect(result.success).toBe(false);
  });

  // --- NEW: configName and configVersion tests ---

  it('[DATA] should parse instance with configName and configVersion', () => {
    const result = ProcessInstanceSchema.safeParse(validInstance);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configName).toBe('default');
      expect(result.data.configVersion).toBe('1.0');
    }
  });

  it('[DATA] should reject instance without configName (required field)', () => {
    const { configName: _, ...noConfigName } = validInstance;
    const result = ProcessInstanceSchema.safeParse(noConfigName);
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject instance without configVersion (required field)', () => {
    const { configVersion: _, ...noConfigVersion } = validInstance;
    const result = ProcessInstanceSchema.safeParse(noConfigVersion);
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject instance with empty configName', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, configName: '' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject instance with empty configVersion', () => {
    const result = ProcessInstanceSchema.safeParse({ ...validInstance, configVersion: '' });
    expect(result.success).toBe(false);
  });
});
