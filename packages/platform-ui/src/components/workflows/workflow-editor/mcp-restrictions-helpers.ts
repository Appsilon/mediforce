import type { StepMcpRestriction } from '@mediforce/platform-core';

export type RestrictionPatch = Partial<{ disable: boolean; denyTools: string[] }>;

/**
 * Merge a per-server patch into the existing restrictions map, normalising
 * away empty fields. Returns `undefined` when the result would be an empty
 * map — callers use that to strip `mcpRestrictions` from the step entirely.
 *
 * Subtractive-only: `disable: false` or `denyTools: []` drop the entry
 * (no empty entries kept around).
 */
export function applyRestrictionUpdate(
  current: StepMcpRestriction | undefined,
  serverName: string,
  patch: RestrictionPatch,
): StepMcpRestriction | undefined {
  const existing = current?.[serverName] ?? {};
  const merged = { ...existing, ...patch };
  const disable = merged.disable === true ? true : undefined;
  const denyTools =
    merged.denyTools !== undefined && merged.denyTools.length > 0 ? merged.denyTools : undefined;

  const rest: StepMcpRestriction = {};
  for (const [key, value] of Object.entries(current ?? {})) {
    if (key !== serverName) rest[key] = value;
  }

  const entry =
    disable === undefined && denyTools === undefined
      ? null
      : { ...(disable === true ? { disable } : {}), ...(denyTools !== undefined ? { denyTools } : {}) };

  const next: StepMcpRestriction = entry === null ? rest : { ...rest, [serverName]: entry };
  return Object.keys(next).length > 0 ? next : undefined;
}
