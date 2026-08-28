'use client';

import { AlertTriangle } from 'lucide-react';
import { RoleMultiSelect } from '../role-multi-select';
import { inputBaseMono } from './step-editor-fields';

const ASSIGNEE_SUGGESTIONS_ID = 'step-assignee-options';

/**
 * A step's `allowedRoles`: the shared role multi-select, plus the warning only
 * a step can give — nobody holds this role for this workflow, so a run that
 * reaches this step will park on it forever (#1249 enforces the gate).
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
  const unheld = heldRoles === null ? [] : value.filter((role) => !heldRoles.includes(role));

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
            No one holds {unheld.map((role) => `"${role}"`).join(', ')} for this workflow; this step
            will block until someone is granted {unheld.length === 1 ? 'it' : 'one of them'}.
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
