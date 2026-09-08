'use client';

import { X } from 'lucide-react';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { inputBase, selectBase } from './workflow-editor/step-editor-fields';
import type { WorkflowSettingsDraft } from './workflow-settings-utils';

const ri = inputBase;
const rs = selectBase;

const NOTIFICATION_EVENTS = ['task_assigned', 'agent_escalation'] as const;

type Notifications = NonNullable<WorkflowDefinition['notifications']>;

export function WorkflowNotificationsPanel({
  draft,
  onChange,
  workspaceRoles,
}: {
  draft: WorkflowSettingsDraft;
  onChange: (patch: WorkflowSettingsDraft) => void;
  /** Seeds the role pick-list; free text is still accepted. */
  workspaceRoles?: string[];
}) {
  const notifications: Notifications = draft.notifications ?? [];

  return (
    <div className="space-y-2">
      {workspaceRoles !== undefined && (
        <datalist id="workflow-notification-roles">
          {workspaceRoles.map((role) => <option key={role} value={role} />)}
        </datalist>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Roles, not people — the workspace resolves them to whoever holds the role.
      </p>
        <div className="space-y-1">
          {notifications.map((entry, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <select
                value={entry.event}
                aria-label={`Notification ${idx + 1} event`}
                onChange={(e) => onChange({
                  notifications: notifications.map((n, i) => (
                    i === idx ? { ...n, event: e.target.value as Notifications[number]['event'] } : n
                  )),
                })}
                className={cn(rs, 'w-40 shrink-0')}
              >
                {NOTIFICATION_EVENTS.map((event) => (
                  <option key={event} value={event}>{event}</option>
                ))}
              </select>
              <input
                value={entry.roles.join(', ')}
                placeholder="reviewer, data-manager"
                aria-label={`Notification ${idx + 1} roles`}
                list={workspaceRoles === undefined ? undefined : 'workflow-notification-roles'}
                onChange={(e) => onChange({
                  notifications: notifications.map((n, i) => (
                    i === idx
                      ? { ...n, roles: e.target.value.split(',').map((r) => r.trim()).filter(Boolean) }
                      : n
                  )),
                })}
                className={cn(ri, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
              />
              <button
                type="button"
                aria-label={`Remove notification ${idx + 1}`}
                onClick={() => onChange({ notifications: notifications.filter((_, i) => i !== idx) })}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {notifications.some((n) => n.roles.length === 0) && (
            <p className="px-0.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
              A notification with no roles reaches nobody, so it is not saved until
              you name at least one.
            </p>
          )}
          <button
            type="button"
            onClick={() => onChange({
              notifications: [...notifications, { event: 'task_assigned', roles: [] }],
            })}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            + Add notification
          </button>
        </div>
    </div>
  );
}
