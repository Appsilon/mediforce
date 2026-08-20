import { describe, it, expect } from 'vitest';
import { TriggerConfigFileSchema, toPortableTrigger } from '../trigger';
import type { TriggerResource } from '../trigger';

/**
 * The portable trigger-config file (Issue #933) is the detachment boundary: it
 * must carry only portable config and reject a stale runtime dump rather than
 * silently strip the instance fields off it. These assert the `.strict()`
 * contract so a mislabelled import fails loudly instead of half-applying.
 */
describe('TriggerConfigFileSchema (portable, strict)', () => {
  it('accepts a well-formed portable file for all three types', () => {
    const parsed = TriggerConfigFileSchema.safeParse([
      { name: 'nightly', type: 'cron', enabled: true, schedule: '0 2 * * *' },
      { name: 'intake', type: 'webhook', enabled: false, method: 'POST', path: '/intake' },
      { name: 'manual', type: 'manual', enabled: true },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('rejects an entry carrying an instance/runtime field', () => {
    // A raw resource dump leaks `namespace`, `lastTriggeredAt`, etc. Strict
    // parsing rejects it instead of stripping it to a valid-looking portable row.
    const withRuntimeField = TriggerConfigFileSchema.safeParse([
      { name: 'nightly', type: 'cron', enabled: true, schedule: '0 2 * * *', namespace: 'team-a' },
    ]);
    expect(withRuntimeField.success).toBe(false);

    const withCursor = TriggerConfigFileSchema.safeParse([
      { name: 'manual', type: 'manual', enabled: true, lastTriggeredAt: null },
    ]);
    expect(withCursor.success).toBe(false);
  });

  it('round-trips a stored resource through toPortableTrigger back into the file schema', () => {
    const cron: TriggerResource = {
      type: 'cron',
      namespace: 'team-a',
      workflowName: 'flow',
      name: 'nightly',
      enabled: true,
      config: { schedule: '0 2 * * *' },
      lastTriggeredAt: '2026-07-28T00:00:00.000Z',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    };
    const portable = toPortableTrigger(cron);
    expect(portable).not.toHaveProperty('namespace');
    expect(portable).not.toHaveProperty('lastTriggeredAt');
    expect(TriggerConfigFileSchema.safeParse([portable]).success).toBe(true);
  });
});
