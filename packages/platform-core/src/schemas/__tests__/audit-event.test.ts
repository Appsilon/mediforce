import { describe, it, expect } from 'vitest';
import { AuditEventSchema } from '../audit-event.js';

const validAuditEvent = {
  actorId: 'user-123',
  actorType: 'user' as const,
  actorRole: 'supply-reviewer',
  action: 'review.approved',
  description: 'Reviewer approved supplier compliance assessment',
  timestamp: '2026-02-25T10:30:00Z',
  serverTimestamp: '2026-02-25T10:30:01Z',
  inputSnapshot: { supplierId: 'SUP-001', metrics: { onTimeRate: 0.95 } },
  outputSnapshot: { verdict: 'approved', comments: 'Within acceptable range' },
  basis: 'On-time delivery rate 95% exceeds threshold of 90% per policy section 5.2',
  entityType: 'processInstance',
  entityId: 'pi-456',
  processInstanceId: 'pi-456',
  stepId: 'supply-review',
  processDefinitionVersion: '1.0',
};

describe('AuditEventSchema', () => {
  it('should parse a complete audit event with all ALCOA+ fields', () => {
    const result = AuditEventSchema.safeParse(validAuditEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actorId).toBe('user-123');
      expect(result.data.actorType).toBe('user');
      expect(result.data.actorRole).toBe('supply-reviewer');
      expect(result.data.action).toBe('review.approved');
      expect(result.data.basis).toBe(
        'On-time delivery rate 95% exceeds threshold of 90% per policy section 5.2',
      );
      expect(result.data.inputSnapshot.supplierId).toBe('SUP-001');
      expect(result.data.outputSnapshot.verdict).toBe('approved');
    }
  });

  it('should parse an event with optional fields omitted', () => {
    const {
      serverTimestamp: _1,
      processInstanceId: _2,
      stepId: _3,
      processDefinitionVersion: _4,
      ...minimalEvent
    } = validAuditEvent;
    const result = AuditEventSchema.safeParse(minimalEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serverTimestamp).toBeUndefined();
      expect(result.data.processInstanceId).toBeUndefined();
      expect(result.data.stepId).toBeUndefined();
      expect(result.data.processDefinitionVersion).toBeUndefined();
    }
  });

  it('should accept agent actor type', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      actorType: 'agent',
    });
    expect(result.success).toBe(true);
  });

  it('should accept system actor type', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      actorType: 'system',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an event with missing actorId', () => {
    const { actorId: _, ...noActorId } = validAuditEvent;
    const result = AuditEventSchema.safeParse(noActorId);
    expect(result.success).toBe(false);
  });

  it('should reject an event with empty actorId', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      actorId: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject an event with missing basis', () => {
    const { basis: _, ...noBasis } = validAuditEvent;
    const result = AuditEventSchema.safeParse(noBasis);
    expect(result.success).toBe(false);
  });

  it('should reject an event with invalid timestamp format', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      timestamp: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('should reject an event with invalid actorType', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      actorType: 'robot',
    });
    expect(result.success).toBe(false);
  });

  it('should reject an event with missing action', () => {
    const { action: _, ...noAction } = validAuditEvent;
    const result = AuditEventSchema.safeParse(noAction);
    expect(result.success).toBe(false);
  });

  it('should reject an event with empty action', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      action: '',
    });
    expect(result.success).toBe(false);
  });

  it('[DATA] should accept executorType "agent" and reviewerType "human"', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      executorType: 'agent',
      reviewerType: 'human',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executorType).toBe('agent');
      expect(result.data.reviewerType).toBe('human');
    }
  });

  it('[DATA] should accept executorType "human" and reviewerType "none"', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      executorType: 'human',
      reviewerType: 'none',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executorType).toBe('human');
      expect(result.data.reviewerType).toBe('none');
    }
  });

  it('[DATA] should accept reviewerType "agent"', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      executorType: 'agent',
      reviewerType: 'agent',
    });
    expect(result.success).toBe(true);
  });

  it('[DATA] should parse without executorType/reviewerType (backward compat)', () => {
    const result = AuditEventSchema.safeParse(validAuditEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executorType).toBeUndefined();
      expect(result.data.reviewerType).toBeUndefined();
    }
  });

  it('[DATA] should reject invalid executorType', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      executorType: 'bot',
    });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject invalid reviewerType', () => {
    const result = AuditEventSchema.safeParse({
      ...validAuditEvent,
      reviewerType: 'bot',
    });
    expect(result.success).toBe(false);
  });
});
