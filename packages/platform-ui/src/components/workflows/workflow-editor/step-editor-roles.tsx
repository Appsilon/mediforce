'use client';

import { AlertTriangle } from 'lucide-react';
import { withBuiltinStepFloor } from '@mediforce/platform-core';
import { RoleMultiSelect } from '../role-multi-select';
import { inputBaseMono } from './step-editor-fields';

const ASSIGNEE_SUGGESTIONS_ID = 'step-assignee-options';

/**
 * A step's `allowedRoles`: the shared role multi-select, plus the warning only
 * a step can give — nobody holds this role for this workflow, so a run that
 * reaches this step will park on it forever (#1249 enforces the gate).
 *
 * An unheld role and a blocked step are different facts, and the warning says
 * which one it found. `allowedRoles` admits on **any** listed role, so a step
 * allowing `reviewer` and `workflow-manager` in a workspace with no reviewers
 * is reachable, not stranded — the pair ADR-0020 seeds every new human step
 * with, and a claim of "this step will block" would be false on all of them.
 *
 * The reachable set is `withBuiltinStepFloor(value)`, not `value`: a restricted
 * step admits `workflow-manager` whether or not its author wrote it, so a
 * workspace with one is never stranded on a step. The chips still show only
 * what the author wrote — the floor is the platform's, not part of the
 * definition this editor saves.
 */
export function AllowedRolesField({
  value,
  vocabulary,
  heldRoles,
  onChange,
}: {
  value: string[];
  /** Roles this workspace already knows about — suggestions, not a whitelist. */
  vocabulary: string[];
  /**
   * Roles somebody can exercise *on this workflow*, or `null` when that is not
   * known yet. `null` must stay silent: warning on a missing answer would flag
   * every role every time the roster is slow.
   */
  heldRoles: string[] | null;
  onChange: (roles: string[]) => void;
}) {
  const effective = withBuiltinStepFloor(value);
  const unheld = heldRoles === null ? [] : value.filter((role) => !heldRoles.includes(role));
  const reachableBy =
    heldRoles === null ? [] : effective.filter((role) => heldRoles.includes(role));
  const blocked = value.length > 0 && unheld.length > 0 && reachableBy.length === 0;

  return (
    <div className="space-y-2">
      <RoleMultiSelect
        value={value}
        vocabulary={vocabulary}
        onChange={onChange}
        inputLabel="Add an allowed role"
        highlighted={unheld}
      />

      {unheld.length > 0 && (
        <div className="flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" strokeWidth={2} />
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            No one holds {unheld.map((role) => `"${role}"`).join(', ')} for this workflow
            {blocked ? (
              <>
                ; this step will block until someone is granted{' '}
                {unheld.length === 1 ? 'it' : 'one of them'}.
              </>
            ) : (
              <>, so only {reachableBy.map((role) => `"${role}"`).join(', ')} can act on this step.</>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * `assignedTo` as a member-suggesting field that still takes a template.
 *
 * The engine interpolates this value at task creation, so `${triggerPayload.userId}`
 * is a supported way to assign a task and a picker that only emitted literal
 * uids would delete that capability. A `<datalist>` gives the roster without
 * taking the keyboard away — the suggestions fill in a uid, and anything else
 * typed is kept verbatim.
 */
export function AssignedToField({
  value,
  members,
  onChange,
}: {
  value: string;
  members: { uid: string; displayName: string | null }[];
  onChange: (assignedTo: string) => void;
}) {
  return (
    <>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={ASSIGNEE_SUGGESTIONS_ID}
        aria-label="Assign this task to"
        placeholder="user id or ${triggerPayload.userId}"
        className={inputBaseMono}
      />
      <datalist id={ASSIGNEE_SUGGESTIONS_ID}>
        {members.map((member) => (
          <option key={member.uid} value={member.uid}>
            {member.displayName ?? member.uid}
          </option>
        ))}
      </datalist>
    </>
  );
}
