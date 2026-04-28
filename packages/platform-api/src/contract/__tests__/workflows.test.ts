import { describe, it, expect } from 'vitest';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import {
  RegisterWorkflowInputSchema,
  RegisterWorkflowOutputSchema,
  ListWorkflowsOutputSchema,
} from '../workflows.js';
import { omitServerFields } from './_helpers.js';

describe('RegisterWorkflowInputSchema', () => {
  it('accepts a workflow definition body without version, createdAt, or namespace', () => {
    const wd = buildWorkflowDefinition();
    const body = omitServerFields(wd);
    const result = RegisterWorkflowInputSchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('strips the server-managed version field on parse (omit drops the key)', () => {
    const wd = buildWorkflowDefinition();
    const { namespace: _n, createdAt: _c, ...body } = wd;
    void _n;
    void _c;
    const result = RegisterWorkflowInputSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      // Documents the wire contract — version is server-managed, never client-supplied.
      expect((result.data as Record<string, unknown>).version).toBeUndefined();
    }
  });

  it('rejects a body missing required fields', () => {
    const result = RegisterWorkflowInputSchema.safeParse({ name: 'wf' });
    expect(result.success).toBe(false);
  });
});

describe('RegisterWorkflowOutputSchema', () => {
  it('accepts the documented success response', () => {
    const result = RegisterWorkflowOutputSchema.safeParse({
      success: true,
      name: 'wf',
      version: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-true success literal', () => {
    const result = RegisterWorkflowOutputSchema.safeParse({
      success: false,
      name: 'wf',
      version: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive version', () => {
    const result = RegisterWorkflowOutputSchema.safeParse({
      success: true,
      name: 'wf',
      version: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('ListWorkflowsOutputSchema', () => {
  it('accepts an empty list', () => {
    const result = ListWorkflowsOutputSchema.safeParse({ definitions: [] });
    expect(result.success).toBe(true);
  });

  it('accepts a populated group with the latest definition embedded', () => {
    const wd = buildWorkflowDefinition({ version: 2 });
    const result = ListWorkflowsOutputSchema.safeParse({
      definitions: [
        {
          name: wd.name,
          latestVersion: 2,
          defaultVersion: 1,
          definition: wd,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a group whose latest definition is null (pruned/missing)', () => {
    const result = ListWorkflowsOutputSchema.safeParse({
      definitions: [
        {
          name: 'wf',
          latestVersion: 1,
          defaultVersion: null,
          definition: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
