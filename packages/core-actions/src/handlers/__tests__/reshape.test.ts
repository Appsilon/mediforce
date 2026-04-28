import { describe, expect, it } from 'vitest';
import { reshapeActionHandler } from '../reshape.js';
import type { ActionContext } from '../../types.js';

const baseCtx: ActionContext = {
  stepId: 'shape',
  processInstanceId: 'inst-1',
  sources: {
    triggerPayload: {
      body: { id: 42, hello: 'world' },
      method: 'POST',
    },
    steps: {
      fetch: { body: { json: { user: { name: 'Alice', age: 30 } } } },
    },
    variables: { workflowId: 'wf-1' },
    secrets: {},
  },
};

describe('reshapeActionHandler', () => {
  it('interpolates string placeholders inside templates', async () => {
    const out = await reshapeActionHandler(
      {
        values: {
          greeting: 'hello ${triggerPayload.body.hello}',
          path: '/api/users/${steps.fetch.body.json.user.name}',
        },
      },
      baseCtx,
    );
    expect(out).toEqual({
      greeting: 'hello world',
      path: '/api/users/Alice',
    });
  });

  it('returns the raw value when a leaf is a sole placeholder', async () => {
    const out = await reshapeActionHandler(
      {
        values: {
          payload: '${triggerPayload.body}',
          age: '${steps.fetch.body.json.user.age}',
        },
      },
      baseCtx,
    );
    expect(out.payload).toEqual({ id: 42, hello: 'world' });
    expect(out.age).toBe(30);
  });

  it('preserves non-string leaves (numbers, booleans, null)', async () => {
    const out = await reshapeActionHandler(
      {
        values: {
          count: 7,
          active: true,
          missing: null,
        },
      },
      baseCtx,
    );
    expect(out).toEqual({ count: 7, active: true, missing: null });
  });

  it('walks nested objects recursively', async () => {
    const out = await reshapeActionHandler(
      {
        values: {
          user: {
            id: '${triggerPayload.body.id}',
            profile: { name: '${steps.fetch.body.json.user.name}' },
          },
        },
      },
      baseCtx,
    );
    expect(out).toEqual({
      user: { id: 42, profile: { name: 'Alice' } },
    });
  });

  it('walks arrays and interpolates each element', async () => {
    const out = await reshapeActionHandler(
      {
        values: {
          ids: ['${triggerPayload.body.id}', 'static', 99],
          users: [{ name: '${steps.fetch.body.json.user.name}' }],
        },
      },
      baseCtx,
    );
    expect(out).toEqual({
      ids: [42, 'static', 99],
      users: [{ name: 'Alice' }],
    });
  });

  it('concatenates multi-placeholder templates as strings', async () => {
    const out = await reshapeActionHandler(
      {
        values: {
          combo: '${triggerPayload.body.hello}-${steps.fetch.body.json.user.name}-${variables.workflowId}',
        },
      },
      baseCtx,
    );
    expect(out.combo).toBe('world-Alice-wf-1');
  });

  it('renders missing placeholders as empty strings inside templates', async () => {
    const out = await reshapeActionHandler(
      {
        values: {
          combo: 'prefix-${triggerPayload.does.not.exist}-suffix',
        },
      },
      baseCtx,
    );
    expect(out.combo).toBe('prefix--suffix');
  });
});
