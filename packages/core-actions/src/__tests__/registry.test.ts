import { describe, expect, it } from 'vitest';
import { ActionRegistry, UnknownActionKindError } from '../registry.js';
import type { ActionContext } from '../types.js';

const ctx: ActionContext = {
  stepId: 'step-1',
  processInstanceId: 'instance-1',
  sources: { triggerPayload: {}, steps: {}, variables: {}, secrets: {} },
};

describe('ActionRegistry', () => {
  it('dispatches a registered handler by kind', async () => {
    const registry = new ActionRegistry();
    registry.register('echo', async (config) => ({ echoed: config }));

    const out = await registry.dispatch(
      // cast: registry accepts arbitrary kinds for plugin extensibility,
      // so the discriminated-union type from platform-core is widened here.
      { kind: 'echo', config: { hello: 'world' } } as never,
      ctx,
    );

    expect(out).toEqual({ echoed: { hello: 'world' } });
  });

  it('throws UnknownActionKindError for unregistered kind', async () => {
    const registry = new ActionRegistry();
    await expect(
      registry.dispatch({ kind: 'wait', config: {} } as never, ctx),
    ).rejects.toBeInstanceOf(UnknownActionKindError);
  });

  it('reports has() correctly', () => {
    const registry = new ActionRegistry();
    expect(registry.has('http')).toBe(false);
    registry.register('http', async () => ({}));
    expect(registry.has('http')).toBe(true);
  });

  it('overwrites a handler when registered twice with the same kind', async () => {
    const registry = new ActionRegistry();
    registry.register('echo', async () => ({ v: 1 }));
    registry.register('echo', async () => ({ v: 2 }));
    const out = await registry.dispatch({ kind: 'echo', config: {} } as never, ctx);
    expect(out).toEqual({ v: 2 });
  });
});
