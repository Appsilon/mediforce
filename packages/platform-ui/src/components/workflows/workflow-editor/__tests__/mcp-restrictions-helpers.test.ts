import { describe, it, expect } from 'vitest';
import type { StepMcpRestriction } from '@mediforce/platform-core';
import { applyRestrictionUpdate } from '../mcp-restrictions-helpers';

describe('applyRestrictionUpdate', () => {
  it('returns undefined when no restrictions exist and the patch adds nothing', () => {
    const result = applyRestrictionUpdate(undefined, 'fs', { disable: false });
    expect(result).toBeUndefined();
  });

  it('creates the restrictions map when setting disable: true on the first server', () => {
    const result = applyRestrictionUpdate(undefined, 'fs', { disable: true });
    expect(result).toEqual({ fs: { disable: true } });
  });

  it('creates the restrictions map when adding denyTools on the first server', () => {
    const result = applyRestrictionUpdate(undefined, 'fs', { denyTools: ['write'] });
    expect(result).toEqual({ fs: { denyTools: ['write'] } });
  });

  it('merges disable onto an existing denyTools entry without touching unrelated servers', () => {
    const current: StepMcpRestriction = {
      fs: { denyTools: ['write'] },
      github: { disable: true },
    };
    const result = applyRestrictionUpdate(current, 'fs', { disable: true });
    expect(result).toEqual({
      fs: { disable: true, denyTools: ['write'] },
      github: { disable: true },
    });
  });

  it('drops disable: false but keeps denyTools on the same server', () => {
    const current: StepMcpRestriction = { fs: { disable: true, denyTools: ['write'] } };
    const result = applyRestrictionUpdate(current, 'fs', { disable: false });
    expect(result).toEqual({ fs: { denyTools: ['write'] } });
  });

  it('drops denyTools: [] but keeps disable on the same server', () => {
    const current: StepMcpRestriction = { fs: { disable: true, denyTools: ['write'] } };
    const result = applyRestrictionUpdate(current, 'fs', { denyTools: [] });
    expect(result).toEqual({ fs: { disable: true } });
  });

  it('removes the server entry entirely when both fields become empty', () => {
    const current: StepMcpRestriction = { fs: { disable: true } };
    const result = applyRestrictionUpdate(current, 'fs', { disable: false });
    expect(result).toBeUndefined();
  });

  it('keeps sibling servers when removing an entry', () => {
    const current: StepMcpRestriction = {
      fs: { disable: true },
      github: { denyTools: ['push'] },
    };
    const result = applyRestrictionUpdate(current, 'fs', { disable: false });
    expect(result).toEqual({ github: { denyTools: ['push'] } });
  });

  it('replaces denyTools in full — the caller owns dedupe/merge', () => {
    const current: StepMcpRestriction = { fs: { denyTools: ['write'] } };
    const result = applyRestrictionUpdate(current, 'fs', { denyTools: ['write', 'delete'] });
    expect(result).toEqual({ fs: { denyTools: ['write', 'delete'] } });
  });

  it('does not leak the empty sentinel when unsetting the only entry', () => {
    const current: StepMcpRestriction = { fs: { denyTools: ['write'] } };
    const result = applyRestrictionUpdate(current, 'fs', { denyTools: [] });
    expect(result).toBeUndefined();
  });

  it('handles adding a brand new server alongside existing ones', () => {
    const current: StepMcpRestriction = { fs: { disable: true } };
    const result = applyRestrictionUpdate(current, 'github', { denyTools: ['push'] });
    expect(result).toEqual({
      fs: { disable: true },
      github: { denyTools: ['push'] },
    });
  });
});
