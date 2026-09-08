'use client';

import { X } from 'lucide-react';
import type { TriggerInputField, WorkflowDefinition } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import {
  FieldGroup,
  FieldRow,
  Section,
  inputBase,
  inputBaseMono,
  selectBase,
  textareaBase,
} from './workflow-editor/step-editor-fields';
import type { WorkflowSettingsDraft } from './workflow-settings-utils';

const ri = inputBase;
const riMono = inputBaseMono;
const rs = selectBase;
const rt = textareaBase;

const TIP = {
  triggerInput: 'What this workflow accepts when it starts. Every trigger and every workflow that spawns this one is checked against it, and steps read the values as ${triggerPayload.<name>}.',
  preamble: 'Prepended to every agent prompt in this workflow — house rules, domain context, terminology.',
  env: 'Workflow-wide environment defaults. A step’s own env overrides these key by key. A {{SECRET_NAME}} value resolves from workspace or workflow secrets.',
  notifications: 'Who is told when a task is assigned or an agent escalates. Roles, not people — the workspace resolves them to members.',
  workspaceRemote: 'Git remote for the run-scoped worktree, as "org/repo" or a full URL. Unset means the bare repo stays local to the run.',
  workspaceAuth: 'Name of a secret holding the token used to push to that remote.',
  skillsRepoUrl: 'Repository the runtime clones to mount agent skills.',
  skillsRepoCommit: 'Commit to clone. Required — without it the skills fetch silently does nothing.',
  skillsRepoAuth: 'Name of a secret holding a token, for a private skills repo.',
  url: 'Link shown on the run card. Cosmetic.',
  displayName: 'The name shown in the app. The workflow’s id — what routes, spawn targets and the CLI use — is fixed at creation; use Copy to get one under a different id.',
} as const;

const NOTIFICATION_EVENTS = ['task_assigned', 'agent_escalation'] as const;

// `TriggerInputFieldSchema` narrows `StepParamSchema`'s open `type` to this
// enum, so unlike a step param these are the only accepted values.
const TRIGGER_INPUT_TYPES: TriggerInputField['type'][] = [
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'textarea',
  'object',
];

type Notifications = NonNullable<WorkflowDefinition['notifications']>;

function KeyValueRows({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}) {
  // Rendered as a list of pairs rather than a map, so renaming a key does not
  // reorder the rows under the author's cursor mid-edit.
  const pairs = Object.entries(entries);

  const writePairs = (next: [string, string][]): void => onChange(Object.fromEntries(next));

  return (
    <div className="space-y-1">
      {pairs.map(([key, value], idx) => (
        <div key={idx} className="flex items-center gap-1">
          <input
            value={key}
            placeholder={keyPlaceholder}
            aria-label={`${addLabel} ${idx + 1} name`}
            onChange={(e) => writePairs(pairs.map((p, i) => (i === idx ? [e.target.value, p[1]] : p)))}
            className={cn(riMono, 'w-44 placeholder:italic placeholder:text-muted-foreground/40')}
          />
          <input
            value={value}
            placeholder={valuePlaceholder}
            aria-label={`${addLabel} ${idx + 1} value`}
            onChange={(e) => writePairs(pairs.map((p, i) => (i === idx ? [p[0], e.target.value] : p)))}
            className={cn(riMono, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
          />
          <button
            type="button"
            aria-label={`Remove ${addLabel.toLowerCase()} ${idx + 1}`}
            onClick={() => writePairs(pairs.filter((_, i) => i !== idx))}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => writePairs([...pairs, ['', '']])}
        className="text-[11px] font-medium text-primary hover:underline"
      >
        + {addLabel}
      </button>
    </div>
  );
}

function TriggerInputEditor({
  fields,
  onChange,
}: {
  fields: TriggerInputField[];
  onChange: (next: TriggerInputField[]) => void;
}) {
  const replace = (idx: number, field: TriggerInputField): void =>
    onChange(fields.map((f, i) => (i === idx ? field : f)));

  return (
    <div className="space-y-2">
      {fields.map((field, idx) => (
        <div key={idx} className="space-y-1 rounded border border-border/60 p-2">
          <div className="flex items-center gap-1">
            <input
              value={field.name}
              placeholder="studyId"
              aria-label={`Input ${idx + 1} name`}
              onChange={(e) => replace(idx, { ...field, name: e.target.value })}
              className={cn(riMono, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
            />
            <select
              value={field.type}
              aria-label={`Input ${idx + 1} type`}
              onChange={(e) => replace(idx, { ...field, type: e.target.value as TriggerInputField['type'] })}
              className={cn(rs, 'w-32 shrink-0')}
            >
              {TRIGGER_INPUT_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={field.required === true}
                aria-label={`Input ${idx + 1} required`}
                onChange={(e) => replace(idx, { ...field, required: e.target.checked })}
                className="h-3.5 w-3.5 accent-primary"
              />
              required
            </label>
            <button
              type="button"
              aria-label={`Remove input ${idx + 1}`}
              onClick={() => onChange(fields.filter((_, i) => i !== idx))}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            value={field.description ?? ''}
            placeholder="What this input is for"
            aria-label={`Input ${idx + 1} description`}
            onChange={(e) => replace(idx, { ...field, description: e.target.value || undefined })}
            className={cn(ri, 'w-full placeholder:italic placeholder:text-muted-foreground/40')}
          />
          {(field.type === 'select' || field.type === 'multiselect') && (
            <input
              value={field.options?.join(', ') ?? ''}
              placeholder="option-a, option-b"
              aria-label={`Input ${idx + 1} options`}
              onChange={(e) => {
                const options = e.target.value.split(',').map((o) => o.trim()).filter(Boolean);
                replace(idx, { ...field, options: options.length > 0 ? options : undefined });
              }}
              className={cn(riMono, 'w-full placeholder:italic placeholder:text-muted-foreground/40')}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...fields, { name: '', type: 'string', required: false }])}
        className="text-[11px] font-medium text-primary hover:underline"
      >
        + Add input
      </button>
    </div>
  );
}

export function WorkflowSettingsPanel({
  draft,
  onChange,
  workspaceRoles,
}: {
  draft: WorkflowSettingsDraft;
  onChange: (patch: WorkflowSettingsDraft) => void;
  /** Seeds the notification role pick-list; free text is still accepted. */
  workspaceRoles?: string[];
}) {
  const notifications: Notifications = draft.notifications ?? [];

  return (
    <div className="space-y-4">
      {/* Shared by the notifications rows and the envelope roles field. */}
      {workspaceRoles !== undefined && (
        <datalist id="workflow-settings-roles">
          {workspaceRoles.map((role) => <option key={role} value={role} />)}
        </datalist>
      )}
      <Section title="Input contract">
        <FieldGroup>
          <FieldRow label="triggerInput" tooltip={TIP.triggerInput} alignStart>
            <TriggerInputEditor
              fields={draft.triggerInput ?? []}
              onChange={(triggerInput) => onChange({ triggerInput })}
            />
          </FieldRow>
        </FieldGroup>
      </Section>

      <Section title="Agent context">
        <FieldGroup>
          <FieldRow label="preamble" tooltip={TIP.preamble} alignStart>
            <textarea
              value={draft.preamble ?? ''}
              rows={6}
              placeholder="Domain context and house rules for every agent step…"
              onChange={(e) => onChange({ preamble: e.target.value })}
              className={cn(rt, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
        </FieldGroup>
      </Section>

      <Section title="Environment">
        <FieldGroup>
          <FieldRow label="env" tooltip={TIP.env} alignStart>
            <KeyValueRows
              entries={(draft.env ?? {}) as Record<string, string>}
              onChange={(env) => onChange({ env })}
              keyPlaceholder="STUDY_ID"
              valuePlaceholder="CDISCPILOT01 or {{SECRET_NAME}}"
              addLabel="Add variable"
            />
          </FieldRow>
        </FieldGroup>
      </Section>

      <Section title="Notifications">
        <FieldGroup>
          <FieldRow label="notifications" tooltip={TIP.notifications} alignStart>
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
                    list={workspaceRoles === undefined ? undefined : 'workflow-settings-roles'}
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
          </FieldRow>
        </FieldGroup>
      </Section>

      <Section title="Repositories">
        <FieldGroup>
          <FieldRow label="workspace.remote" tooltip={TIP.workspaceRemote}>
            <input
              value={draft.workspace?.remote ?? ''}
              placeholder="Appsilon/my-workflow-workspace"
              onChange={(e) => onChange({ workspace: { ...draft.workspace, remote: e.target.value } })}
              className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
          <FieldRow label="workspace.remoteAuth" tooltip={TIP.workspaceAuth}>
            <input
              value={draft.workspace?.remoteAuth ?? ''}
              placeholder="GITHUB_TOKEN"
              onChange={(e) => onChange({ workspace: { ...draft.workspace, remoteAuth: e.target.value } })}
              className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
          <FieldRow label="externalSkillsRepo.url" tooltip={TIP.skillsRepoUrl}>
            <input
              value={draft.externalSkillsRepo?.url ?? ''}
              placeholder="https://github.com/org/skills"
              onChange={(e) => onChange({
                externalSkillsRepo: { ...draft.externalSkillsRepo, url: e.target.value },
              })}
              className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
          <FieldRow label="externalSkillsRepo.commit" tooltip={TIP.skillsRepoCommit}>
            <input
              value={draft.externalSkillsRepo?.commit ?? ''}
              placeholder="40-character commit sha"
              onChange={(e) => onChange({
                externalSkillsRepo: { ...draft.externalSkillsRepo, commit: e.target.value },
              })}
              className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
          {(() => {
            // Symmetric: either half alone is unusable, so both cases warn.
            const url = (draft.externalSkillsRepo?.url ?? '').trim();
            const commit = (draft.externalSkillsRepo?.commit ?? '').trim();
            if (url === '' && commit === '') return null;
            if (url !== '' && commit !== '') return null;
            return (
              <p className="px-0.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
                A skills repo needs both a url and a commit — with only one the runtime
                fetches nothing, so this repo is not saved until you supply the{' '}
                {url === '' ? 'url' : 'commit'}.
              </p>
            );
          })()}
          <FieldRow label="externalSkillsRepo.auth" tooltip={TIP.skillsRepoAuth}>
            <input
              value={draft.externalSkillsRepo?.auth ?? ''}
              placeholder="GITHUB_TOKEN"
              onChange={(e) => onChange({
                externalSkillsRepo: { ...draft.externalSkillsRepo, auth: e.target.value },
              })}
              className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
        </FieldGroup>
      </Section>

      <Section title="Presentation">
        <FieldGroup>
          <FieldRow label="displayName" tooltip={TIP.displayName}>
            <input
              value={(draft.metadata?.displayName as string | undefined) ?? ''}
              placeholder="Landing Zone — CDISCPILOT01"
              onChange={(e) => onChange({
                metadata: { ...draft.metadata, displayName: e.target.value },
              })}
              className={cn(ri, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
          <FieldRow label="url" tooltip={TIP.url}>
            <input
              value={draft.url ?? ''}
              placeholder="https://example.com/runbook"
              onChange={(e) => onChange({ url: e.target.value })}
              className={cn(ri, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
        </FieldGroup>
      </Section>
    </div>
  );
}
