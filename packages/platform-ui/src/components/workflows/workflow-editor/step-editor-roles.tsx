'use client';

import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputBase, inputBaseMono } from './step-editor-fields';

const ROLE_SUGGESTIONS_ID = 'step-allowed-role-options';
const ASSIGNEE_SUGGESTIONS_ID = 'step-assignee-options';

/**
 * `allowedRoles` as chips plus a suggesting text field.
 *
 * A comma-separated text box made `reviewr` indistinguishable from `reviewer`
 * until a run stalled on a task nobody could claim (#1249 enforces the gate).
 * Chips make each role a thing you can see and delete; the suggestions make the
 * spelling that already exists the easiest one to pick.
 *
 * Free entry survives on purpose: the role vocabulary is open by construction
 * (ADR-0019), and authoring a step for a role no one has been granted yet is
 * the normal order of work. So the list suggests, and never refuses.
 *
 * Comma still splits on commit, so a value pasted from the old control — or
 * from a `.wd.json` — lands as the roles it names rather than as one role with
 * commas in its name.
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
  const [draft, setDraft] = useState('');

  const unheld = heldRoles === null ? [] : value.filter((role) => !heldRoles.includes(role));

  function commitDraft() {
    const added = draft
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role !== '' && !value.includes(role));
    setDraft('');
    if (added.length > 0) onChange([...value, ...added]);
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((role) => {
            const missing = unheld.includes(role);
            return (
              <span
                key={role}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium',
                  missing
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-muted text-foreground',
                )}
              >
                {role}
                <button
                  type="button"
                  aria-label={`Remove role ${role}`}
                  onClick={() => onChange(value.filter((held) => held !== role))}
                  className="opacity-50 hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitDraft();
          }
        }}
        list={ROLE_SUGGESTIONS_ID}
        aria-label="Add an allowed role"
        placeholder="add a role"
        className={inputBase}
      />
      <datalist id={ROLE_SUGGESTIONS_ID}>
        {vocabulary.map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>

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
