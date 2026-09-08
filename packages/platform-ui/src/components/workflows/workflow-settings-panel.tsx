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

/**
 * The definition-level fields a person types by hand.
 *
 * Deliberately absent: environment variables, because the workflow's Secrets
 * tab already parses a pasted `.env`; the git repositories, because the import
 * dialog collects them and the workflow page renders them; and `url`. The
 * assistant and a pasted definition still write all three — a field being
 * authorable does not mean it needs its own form control.
 */

const TIP = {
  triggerInput: 'What this workflow accepts when it starts. Every trigger and every workflow that spawns this one is checked against it, and steps read the values as ${triggerPayload.<name>}.',
  preamble: 'Added to the start of every agent prompt in this workflow — house rules, domain context, terminology.',
  notifications: 'Who is told when a task is assigned or an agent escalates. Roles, not people — the workspace resolves them to members.',
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
}: {
  draft: WorkflowSettingsDraft;
  onChange: (patch: WorkflowSettingsDraft) => void;
}) {
  return (
    <div className="space-y-4">
      <Section title="Input this workflow accepts">
        <FieldGroup>
          <FieldRow label="Fields" tooltip={TIP.triggerInput} alignStart>
            <TriggerInputEditor
              fields={draft.triggerInput ?? []}
              onChange={(triggerInput) => onChange({ triggerInput })}
            />
          </FieldRow>
        </FieldGroup>
      </Section>

      {(draft.triggerInput ?? []).length > 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            With these fields, a run must be started with:
          </p>
          <pre className="overflow-x-auto whitespace-pre rounded bg-background px-2.5 py-2 font-mono text-[11px]">
{JSON.stringify(
  Object.fromEntries((draft.triggerInput ?? [])
    .filter((f) => f.name.trim() !== '')
    .map((f) => [f.name, f.type === 'number' ? 0 : f.type === 'boolean' ? true : `<${f.type}>`])),
  null,
  2,
)}
          </pre>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Every way of starting this workflow is checked against it — a manual run, a
            webhook body, a cron payload, and any workflow that spawns this one. A step
            reads a value as{' '}
            <code className="font-mono">
              {'${triggerPayload.'}
              {(draft.triggerInput ?? []).find((f) => f.name.trim() !== '')?.name ?? 'field'}
              {'}'}
            </code>.
          </p>
        </div>
      )}

      <Section title="Agent preamble">
        <FieldGroup>
          <FieldRow label="Text" tooltip={TIP.preamble} alignStart>
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

    </div>
  );
}
