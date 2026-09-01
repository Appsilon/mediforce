'use client';

import { useId, useState } from 'react';
import { Lock, X } from 'lucide-react';
import { findBuiltinRole } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { inputBase } from './workflow-editor/step-editor-fields';

/**
 * A set of process-domain Roles, as removable chips plus a suggesting text
 * field.
 *
 * Every role gate in ADR-0019 is authored through this control — the step
 * editor's `allowedRoles` (#1252) and the workflow Access tab's `run` / `edit`
 * lists (#1253) — so the three read as one idea rather than three shapes for
 * the same list. A comma-separated text box made `reviewr` indistinguishable
 * from `reviewer` until a run stalled on a task nobody could claim.
 *
 * Free entry survives on purpose: the role vocabulary is open by construction
 * (ADR-0019), and gating on a role no one has been granted yet is the normal
 * order of work. So the list suggests, and never refuses.
 *
 * Comma still splits on commit, so a value pasted from the old control — or
 * from a `.wd.json` — lands as the roles it names rather than as one role with
 * commas in its name.
 */
export function RoleMultiSelect({
  value,
  vocabulary,
  onChange,
  inputLabel,
  placeholder = 'add a role',
  highlighted = [],
  locked = [],
  disabled = false,
}: {
  value: string[];
  /** Roles this workspace already knows about — suggestions, not a whitelist. */
  vocabulary: string[];
  onChange: (roles: string[]) => void;
  /** Accessible name of the entry field; two of these can share one screen. */
  inputLabel: string;
  placeholder?: string;
  /**
   * Roles to mark as needing attention — nobody holds them, so the gate they
   * form is closed to everyone. The caller words the warning; this only
   * colours the chips.
   */
  highlighted?: readonly string[];
  /**
   * Roles this list cannot drop — rendered without a remove control and shown
   * first. The workflow Access tab's built-in floor (ADR-0020) is the only
   * caller: a gated verb always admits the built-in roles that carry it, and a
   * chip that can be taken away would say otherwise.
   *
   * Deliberately not used for a step's `allowedRoles`. That list is authored
   * data that travels with the package (ADR-0013), and pinning a platform role
   * name into it unremovably would put this deployment's vocabulary in someone
   * else's workflow.
   */
  locked?: readonly string[];
  /** Render the current set without the controls to change it. */
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  // Two instances on one page must not share a `<datalist>` id, or the second
  // silently takes the first's suggestions.
  const suggestionsId = useId();

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
          {value.map((role) => (
            <span
              key={role}
              title={locked.includes(role) ? `${role} always has this` : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium',
                highlighted.includes(role)
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-muted text-foreground',
              )}
            >
              {locked.includes(role) && (
                <Lock className="h-2.5 w-2.5 opacity-50" strokeWidth={2.5} aria-hidden />
              )}
              {role}
              {!disabled && !locked.includes(role) && (
                <button
                  type="button"
                  aria-label={`Remove role ${role}`}
                  onClick={() => onChange(value.filter((held) => held !== role))}
                  className="opacity-50 hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <>
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
            list={suggestionsId}
            aria-label={inputLabel}
            placeholder={placeholder}
            className={inputBase}
          />
          {/* The built-ins carry a privilege, so the suggestion says what it
              is — `executor` is not self-explanatory next to `biostatistician`. */}
          <datalist id={suggestionsId}>
            {vocabulary.map((role) => (
              <option key={role} value={role} label={findBuiltinRole(role)?.description} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}
