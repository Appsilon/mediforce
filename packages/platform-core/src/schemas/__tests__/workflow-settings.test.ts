import { describe, it, expect } from 'vitest';
import { pruneWorkflowSettings } from '../workflow-settings';

describe('pruneWorkflowSettings', () => {
  it('unsets a field the author emptied, rather than registering an empty string', () => {
    // A text input yields '' when cleared. Registering that is not the same as
    // not setting the field: `url` is `z.string().url()`, so '' is refused, and
    // an empty `preamble` would be prepended to every agent prompt.
    const pruned = pruneWorkflowSettings({ preamble: '', url: '', title: '' });
    expect(pruned).toEqual({ preamble: undefined, url: undefined, title: undefined });
  });

  it('marks the cleared key present so the save can override the loaded value', () => {
    // `buildRegisterBody` spreads the loaded definition first, so an absent key
    // means "keep the old value". Omitting a cleared field left the previous
    // preamble prepended to every agent prompt.
    const pruned = pruneWorkflowSettings({ preamble: '' });
    expect('preamble' in pruned).toBe(true);
    expect(pruned.preamble).toBeUndefined();
  });

  it('keeps a field the author actually filled', () => {
    const pruned = pruneWorkflowSettings({ preamble: 'House rules.', url: 'https://example.com' });
    expect(pruned).toEqual({ preamble: 'House rules.', url: 'https://example.com' });
  });

  it('trims surrounding whitespace, so a space is not a value', () => {
    expect(pruneWorkflowSettings({ preamble: '   ' })).toEqual({ preamble: undefined });
    expect(pruneWorkflowSettings({ preamble: '  rules  ' })).toEqual({ preamble: 'rules' });
  });

  it('drops an env map once its last entry is removed', () => {
    expect(pruneWorkflowSettings({ env: {} })).toEqual({ env: undefined });
    expect(pruneWorkflowSettings({ env: { STUDY_ID: 'CDISCPILOT01' } }))
      .toEqual({ env: { STUDY_ID: 'CDISCPILOT01' } });
  });

  it('drops an env entry with a blank name, which cannot be resolved', () => {
    expect(pruneWorkflowSettings({ env: { '': 'orphan', STUDY_ID: 'X' } }))
      .toEqual({ env: { STUDY_ID: 'X' } });
  });

  it('keeps an env value that is deliberately empty', () => {
    // The landing-zone package ships `ANTHROPIC_API_KEY: ''` — an empty value
    // is how an author declares a variable the runtime fills in.
    expect(pruneWorkflowSettings({ env: { ANTHROPIC_API_KEY: '' } }))
      .toEqual({ env: { ANTHROPIC_API_KEY: '' } });
  });

  it('drops empty arrays', () => {
    expect(pruneWorkflowSettings({ triggerInput: [], notifications: [] }))
      .toEqual({ triggerInput: undefined, notifications: undefined });
  });

  it('drops a workspace whose fields are all blank', () => {
    expect(pruneWorkflowSettings({ workspace: { remote: '', remoteAuth: '' } }))
      .toEqual({ workspace: undefined });
    expect(pruneWorkflowSettings({ workspace: { remote: 'Appsilon/repo', remoteAuth: '' } }))
      .toEqual({ workspace: { remote: 'Appsilon/repo' } });
  });

  it('drops an externalSkillsRepo that is not complete, since a half one is unusable', () => {
    // Neither half works alone: no url means nothing to clone, no commit means
    // the runtime silently fetches nothing. The panel warns about the second
    // rather than letting it look saved.
    for (const half of [
      { url: '', commit: '', auth: '' },
      { url: 'https://github.com/org/skills' },
      { commit: '0'.repeat(40) },
    ]) {
      expect(pruneWorkflowSettings({ externalSkillsRepo: half })).toEqual({ externalSkillsRepo: undefined });
    }
  });

  it('keeps an externalSkillsRepo intact once it has a url and commit', () => {
    const repo = { url: 'https://github.com/org/skills', commit: '0'.repeat(40) };
    expect(pruneWorkflowSettings({ externalSkillsRepo: repo })).toEqual({ externalSkillsRepo: repo });
  });

  it('leaves an explicit false alone — it is a value, not an absence', () => {
    expect(pruneWorkflowSettings({ visibility: 'private' })).toEqual({ visibility: 'private' });
  });

  it('unsets roles once the last one is removed', () => {
    expect(pruneWorkflowSettings({ roles: [] })).toEqual({ roles: undefined });
    expect(pruneWorkflowSettings({ roles: ['reviewer'] })).toEqual({ roles: ['reviewer'] });
  });

  it('keeps a cleared display name, which reads as absent downstream anyway', () => {
    // metadata is a general bag, so a blank value is not assumed meaningless
    // the way a blank text field is. Harmless here: `workflowDisplayName`
    // guards on `dn.trim().length > 0` and falls back to the formatted id.
    expect(pruneWorkflowSettings({ metadata: { displayName: '' } }))
      .toEqual({ metadata: { displayName: '' } });
  });

  it('drops a notification that reaches nobody, like a half-finished skills repo', () => {
    expect(pruneWorkflowSettings({ notifications: [{ event: 'task_assigned', roles: [] }] }))
      .toEqual({ notifications: undefined });
    const real = [{ event: 'task_assigned' as const, roles: ['reviewer'] }];
    expect(pruneWorkflowSettings({ notifications: real })).toEqual({ notifications: real });
  });

  it('never invents a key the draft did not carry', () => {
    expect(Object.keys(pruneWorkflowSettings({}))).toEqual([]);
  });
});
