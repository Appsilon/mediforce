import { describe, expect, it, vi } from 'vitest';

const { hasProductionEvaluators, productionEvaluatorGate } = vi.hoisted(() => ({
  hasProductionEvaluators: vi.fn(),
  productionEvaluatorGate: vi.fn(),
}));

vi.mock('@mediforce/platform-api/runtime', () => ({ hasProductionEvaluators, productionEvaluatorGate }));
vi.mock('../route-adapter', () => ({ defaultBuildScope: vi.fn(() => ({ scope: 'system' })) }));

import { buildProductionOutputGate } from '../production-output-gate';

const step = { namespace: 'acme', workflowName: 'triage', stepId: 'grade' };

describe('buildProductionOutputGate', () => {
  it('returns the gate when the step has production Evaluators', async () => {
    const gate = vi.fn();
    hasProductionEvaluators.mockResolvedValueOnce(true);
    productionEvaluatorGate.mockReturnValueOnce(gate);

    expect(await buildProductionOutputGate(step, vi.fn())).toBe(gate);
  });

  it('returns undefined when the step has none', async () => {
    hasProductionEvaluators.mockResolvedValueOnce(false);

    expect(await buildProductionOutputGate(step, vi.fn())).toBeUndefined();
  });

  it('fails open and reports the error when the lookup throws', async () => {
    const failure = new Error('evaluation tables unreadable');
    const onError = vi.fn();
    hasProductionEvaluators.mockRejectedValueOnce(failure);

    expect(await buildProductionOutputGate(step, onError)).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
