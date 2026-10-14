import type { WorkflowDefinition } from './workflow-definition';
import type { WorkflowSettings } from './workflow-assistant-apply';

/**
 * What the settings panel edits: the reducer's own type, so the assistant and
 * the form cannot drift about what a workflow-level field is. Values are held
 * as the author typed them, so a cleared input is `''` rather than absent, and
 * `pruneWorkflowSettings` turns that back into an absence at save time.
 */
export type WorkflowSettingsDraft = WorkflowSettings;

/** What registers: the draft with every half-finished value resolved away. */
export type RegisterableWorkflowSettings = Partial<
  Pick<
    WorkflowDefinition,
    | 'title' | 'description' | 'preamble' | 'url' | 'env' | 'notifications'
    | 'workspace' | 'triggerInput' | 'visibility' | 'roles' | 'metadata'
  >
>;

function pruneString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Turns what the form holds into what registers.
 *
 * A cleared text input yields `''`, and registering that is not the same as
 * leaving the field unset: `url` is `z.string().url()` so `''` is refused
 * outright, and an empty `preamble` would still be prepended to every agent
 * prompt in the workflow. Empty maps, arrays and all-blank objects go the same
 * way — an author who removed the last env entry meant to remove `env`.
 *
 * A cleared field becomes an explicit `undefined` rather than a missing key,
 * because `buildRegisterBody` spreads the loaded definition first: an absent
 * key there means *keep the old value*, so omitting a cleared `preamble` left
 * the previous one prepended to every agent prompt — the exact harm this
 * function exists to prevent. `undefined` overrides the spread, and
 * `JSON.stringify` drops it on the way out, so the field registers as unset.
 *
 * The one deliberate exception is an env *value*: `''` there is how an author
 * declares a variable the runtime supplies, which the landing-zone package
 * relies on for `ANTHROPIC_API_KEY`. Only a blank env *name* is dropped, since
 * nothing can resolve it.
 */
export function pruneWorkflowSettings(draft: WorkflowSettingsDraft): RegisterableWorkflowSettings {
  const pruned: RegisterableWorkflowSettings = {};

  for (const [key, value] of Object.entries(draft) as [keyof WorkflowSettingsDraft, unknown][]) {
    if (value === undefined || value === null) continue;

    if (typeof value === 'string') {
      Object.assign(pruned, { [key]: pruneString(value) });
      continue;
    }

    if (Array.isArray(value)) {
      // A notification with no roles notifies nobody: a half-finished value,
      // dropped rather than registered, and the panel warns.
      const entries = key === 'notifications'
        ? (value as { roles?: string[] }[]).filter((n) => (n.roles ?? []).length > 0)
        : value;
      Object.assign(pruned, { [key]: entries.length > 0 ? entries : undefined });
      continue;
    }

    if (typeof value === 'object') {
      if (key === 'env' || key === 'metadata') {
        const entries = Object.entries(value as Record<string, unknown>)
          .filter(([name]) => name.trim() !== '');
        Object.assign(pruned, { [key]: entries.length > 0 ? Object.fromEntries(entries) : undefined });
        continue;
      }

      // `workspace`: drop the blank members, then drop the object itself if
      // nothing survived.
      const kept: Record<string, unknown> = {};
      for (const [member, memberValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof memberValue === 'string') {
          const keptMember = pruneString(memberValue);
          if (keptMember !== undefined) kept[member] = keptMember;
          continue;
        }
        if (memberValue !== undefined && memberValue !== null) kept[member] = memberValue;
      }
      Object.assign(pruned, { [key]: Object.keys(kept).length > 0 ? kept : undefined });
      continue;
    }

    Object.assign(pruned, { [key]: value });
  }

  return pruned;
}
