'use client';

import { X } from 'lucide-react';
import {
  COLUMN_KINDS,
  STEP_UI_COMPONENTS,
  TableEditorUiConfigSchema,
  AssignmentTableUiConfigSchema,
  FileUploadUiConfigSchema,
} from '@mediforce/platform-core';
import type { ColumnSpec, SelectOption, WorkflowStep } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { FieldGroup, FieldRow, Section, inputBase, inputBaseMono, selectBase } from './step-editor-fields';

const ri = inputBase;
const riMono = inputBaseMono;
const rs = selectBase;

/**
 * `steps[].ui.config`, authored from the schemas in platform-core.
 *
 * The component dropdown used to offer `assignment-table` and `table-editor`
 * while exposing config fields only for `file-upload`, so a table step authored
 * here shipped with `columns: []` and rendered an empty table. The dropdown now
 * comes from the same registry as the fields, which is what stops a component
 * being offered without a way to configure it.
 */

const COMPONENT_LABELS: Record<(typeof STEP_UI_COMPONENTS)[number], string> = {
  'file-upload': 'File upload',
  'table-editor': 'Table editor',
  'assignment-table': 'Assignment table',
};

const TIP = {
  component: 'The task body a human sees. Without one the step renders its params as a plain form.',
  acceptedTypes: 'MIME types or extensions the upload accepts. Enforced server-side on completion.',
  minFiles: 'Fewest files that complete the task. Enforced server-side.',
  maxFiles: 'Most files the task accepts. Enforced server-side.',
  columns: 'One column per field the reviewer fills in. `static` columns display a value from the row; the rest are editors whose values land in the output keyed by column id.',
  submitLabel: 'Text on the submit button. Defaults to "Submit".',
  emptyMessage: 'Shown when the task has no rows. Defaults to "No items".',
  assignees: 'Who the reviewer can assign each row to.',
  priorities: 'Priority values offered, in order. Defaults to P0-P3.',
  defaultPriority: 'Priority pre-selected on every row. Defaults to P2.',
  itemColumnLabel: 'Heading for the column naming each row. Defaults to "Item".',
  allowSkip: 'On by default: the reviewer may skip a row instead of assigning it.',
  noteField: 'On by default: each row takes a free-text note.',
} as const;

function labelFor(kind: ColumnSpec['kind']): string {
  return kind.replace(/-/g, ' ');
}

/** A blank column of the requested kind, with the fields that kind requires. */
function blankColumn(kind: ColumnSpec['kind'], id: string): ColumnSpec {
  const base = { id, label: '' };
  if (kind === 'static') return { ...base, kind, field: '' };
  if (kind === 'avatar') return { ...base, kind, field: '' };
  if (kind === 'text') return { ...base, kind };
  if (kind === 'single-select') return { ...base, kind, options: [] };
  return { ...base, kind, options: [] };
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: SelectOption[];
  onChange: (next: SelectOption[]) => void;
}) {
  return (
    <div className="space-y-1">
      {options.map((option, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <input
            value={option.id}
            placeholder="id"
            onChange={(e) => onChange(options.map((o, i) => (i === idx ? { ...o, id: e.target.value } : o)))}
            className={cn(riMono, 'w-24 placeholder:italic placeholder:text-muted-foreground/40')}
          />
          <input
            value={option.label}
            placeholder="Label"
            onChange={(e) => onChange(options.map((o, i) => (i === idx ? { ...o, label: e.target.value } : o)))}
            className={cn(ri, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
          />
          <button
            type="button"
            aria-label={`Remove option ${idx + 1}`}
            onClick={() => onChange(options.filter((_, i) => i !== idx))}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, { id: '', label: '' }])}
        className="text-[11px] font-medium text-primary hover:underline"
      >
        + Add option
      </button>
    </div>
  );
}

function ColumnsEditor({
  columns,
  onChange,
}: {
  columns: ColumnSpec[];
  onChange: (next: ColumnSpec[]) => void;
}) {
  const replace = (idx: number, column: ColumnSpec): void =>
    onChange(columns.map((c, i) => (i === idx ? column : c)));

  return (
    <div className="space-y-2">
      {columns.map((column, idx) => (
        <div key={idx} className="rounded border border-border/60 p-2 space-y-1">
          <div className="flex items-center gap-1">
            <select
              value={column.kind}
              aria-label={`Column ${idx + 1} kind`}
              onChange={(e) => replace(idx, blankColumn(e.target.value as ColumnSpec['kind'], column.id))}
              className={cn(rs, 'w-28 shrink-0')}
            >
              {COLUMN_KINDS.map((kind) => (
                <option key={kind} value={kind}>{labelFor(kind)}</option>
              ))}
            </select>
            <input
              value={column.id}
              placeholder="id"
              aria-label={`Column ${idx + 1} id`}
              onChange={(e) => replace(idx, { ...column, id: e.target.value })}
              className={cn(riMono, 'w-24 placeholder:italic placeholder:text-muted-foreground/40')}
            />
            <input
              value={column.label}
              placeholder="Heading"
              aria-label={`Column ${idx + 1} heading`}
              onChange={(e) => replace(idx, { ...column, label: e.target.value })}
              className={cn(ri, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
            />
            <button
              type="button"
              aria-label={`Remove column ${idx + 1}`}
              onClick={() => onChange(columns.filter((_, i) => i !== idx))}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {(column.kind === 'static' || column.kind === 'avatar') && (
            <input
              value={column.field}
              placeholder="row field to read"
              aria-label={`Column ${idx + 1} field`}
              onChange={(e) => replace(idx, { ...column, field: e.target.value })}
              className={cn(riMono, 'w-full placeholder:italic placeholder:text-muted-foreground/40')}
            />
          )}

          {column.kind === 'text' && (
            <input
              value={column.placeholder ?? ''}
              placeholder="cell placeholder"
              aria-label={`Column ${idx + 1} placeholder`}
              onChange={(e) => replace(idx, { ...column, placeholder: e.target.value || undefined })}
              className={cn(ri, 'w-full placeholder:italic placeholder:text-muted-foreground/40')}
            />
          )}

          {(column.kind === 'single-select' || column.kind === 'multi-select') && (
            <OptionsEditor
              options={column.options}
              onChange={(options) => replace(idx, { ...column, options })}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...columns, blankColumn('text', `column-${String(columns.length + 1)}`)])}
        className="text-[11px] font-medium text-primary hover:underline"
      >
        + Add column
      </button>
    </div>
  );
}

export function StepUiConfigSection({
  step,
  onChange,
}: {
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
}) {
  const component = step.ui?.component;

  const setComponent = (next: string): void => {
    if (next === '') {
      onChange({ ui: undefined });
      return;
    }
    // The config is dropped with the component: keys are per-component, so
    // carrying them over would leave a table's columns on a file upload.
    onChange({ ui: { component: next, config: {} } });
  };

  const writeConfig = (patch: Record<string, unknown>): void => {
    if (component === undefined) return;
    const config = { ...step.ui?.config, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete config[key];
    }
    onChange({ ui: { component, config } });
  };

  const upload = FileUploadUiConfigSchema.safeParse(step.ui?.config ?? {}).data ?? {};
  const table = TableEditorUiConfigSchema.safeParse(step.ui?.config ?? {}).data ?? { columns: [] };
  const assignment = AssignmentTableUiConfigSchema.safeParse(step.ui?.config ?? {}).data ?? { assignees: [] };

  return (
    <Section title="Task UI">
      <FieldGroup>
        <FieldRow label="component" tooltip={TIP.component}>
          <select value={component ?? ''} onChange={(e) => setComponent(e.target.value)} className={rs}>
            <option value="">Params form (default)</option>
            {STEP_UI_COMPONENTS.map((name) => (
              <option key={name} value={name}>{COMPONENT_LABELS[name]}</option>
            ))}
          </select>
        </FieldRow>

        {component === 'file-upload' && (
          <>
            <FieldRow label="acceptedTypes" tooltip={TIP.acceptedTypes}>
              <input
                value={upload.acceptedTypes?.join(', ') ?? ''}
                onChange={(e) => {
                  const list = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                  writeConfig({ acceptedTypes: list.length > 0 ? list : undefined });
                }}
                placeholder="text/csv, .csv, application/pdf"
                className={riMono}
              />
            </FieldRow>
            <FieldRow label="minFiles" tooltip={TIP.minFiles}>
              <input
                type="number"
                min={0}
                value={upload.minFiles ?? ''}
                onChange={(e) => writeConfig({ minFiles: e.target.value === '' ? undefined : Number(e.target.value) })}
                className={ri}
              />
            </FieldRow>
            <FieldRow label="maxFiles" tooltip={TIP.maxFiles}>
              <input
                type="number"
                min={1}
                value={upload.maxFiles ?? ''}
                onChange={(e) => writeConfig({ maxFiles: e.target.value === '' ? undefined : Number(e.target.value) })}
                className={ri}
              />
            </FieldRow>
          </>
        )}

        {component === 'table-editor' && (
          <>
            <FieldRow label="columns" tooltip={TIP.columns} alignStart>
              <ColumnsEditor columns={table.columns} onChange={(columns) => writeConfig({ columns })} />
            </FieldRow>
            <FieldRow label="submitLabel" tooltip={TIP.submitLabel}>
              <input
                value={table.submitLabel ?? ''}
                placeholder="Submit"
                onChange={(e) => writeConfig({ submitLabel: e.target.value || undefined })}
                className={cn(ri, 'placeholder:italic placeholder:text-muted-foreground/40')}
              />
            </FieldRow>
            <FieldRow label="emptyMessage" tooltip={TIP.emptyMessage}>
              <input
                value={table.emptyMessage ?? ''}
                placeholder="No items"
                onChange={(e) => writeConfig({ emptyMessage: e.target.value || undefined })}
                className={cn(ri, 'placeholder:italic placeholder:text-muted-foreground/40')}
              />
            </FieldRow>
          </>
        )}

        {component === 'assignment-table' && (
          <>
            <FieldRow label="assignees" tooltip={TIP.assignees} alignStart>
              <div className="space-y-1">
                {assignment.assignees.map((assignee, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <input
                      value={assignee.id}
                      placeholder="id"
                      aria-label={`Assignee ${idx + 1} id`}
                      onChange={(e) => writeConfig({
                        assignees: assignment.assignees.map((a, i) => (i === idx ? { ...a, id: e.target.value } : a)),
                      })}
                      className={cn(riMono, 'w-24 placeholder:italic placeholder:text-muted-foreground/40')}
                    />
                    <input
                      value={assignee.label}
                      placeholder="Name"
                      aria-label={`Assignee ${idx + 1} name`}
                      onChange={(e) => writeConfig({
                        assignees: assignment.assignees.map((a, i) => (i === idx ? { ...a, label: e.target.value } : a)),
                      })}
                      className={cn(ri, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
                    />
                    <select
                      value={assignee.kind}
                      aria-label={`Assignee ${idx + 1} kind`}
                      onChange={(e) => writeConfig({
                        assignees: assignment.assignees.map((a, i) => (
                          i === idx ? { ...a, kind: e.target.value as 'human' | 'agent' } : a
                        )),
                      })}
                      className={cn(rs, 'w-20 shrink-0')}
                    >
                      <option value="human">Human</option>
                      <option value="agent">Agent</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove assignee ${idx + 1}`}
                      onClick={() => writeConfig({ assignees: assignment.assignees.filter((_, i) => i !== idx) })}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => writeConfig({
                    assignees: [...assignment.assignees, { id: '', label: '', kind: 'human' as const }],
                  })}
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  + Add assignee
                </button>
              </div>
            </FieldRow>
            <FieldRow label="priorities" tooltip={TIP.priorities}>
              <input
                value={assignment.priorities?.join(', ') ?? ''}
                placeholder="P0, P1, P2, P3"
                onChange={(e) => {
                  const list = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                  writeConfig({ priorities: list.length > 0 ? list : undefined });
                }}
                className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
              />
            </FieldRow>
            <FieldRow label="defaultPriority" tooltip={TIP.defaultPriority}>
              <input
                value={assignment.defaultPriority ?? ''}
                placeholder="P2"
                onChange={(e) => writeConfig({ defaultPriority: e.target.value || undefined })}
                className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
              />
            </FieldRow>
            <FieldRow label="itemColumnLabel" tooltip={TIP.itemColumnLabel}>
              <input
                value={assignment.itemColumnLabel ?? ''}
                placeholder="Item"
                onChange={(e) => writeConfig({ itemColumnLabel: e.target.value || undefined })}
                className={cn(ri, 'placeholder:italic placeholder:text-muted-foreground/40')}
              />
            </FieldRow>
            <FieldRow label="allowSkip" tooltip={TIP.allowSkip}>
              <input
                type="checkbox"
                checked={assignment.allowSkip !== false}
                onChange={(e) => writeConfig({ allowSkip: e.target.checked ? undefined : false })}
                className="h-3.5 w-3.5 accent-primary"
              />
            </FieldRow>
            <FieldRow label="noteField" tooltip={TIP.noteField}>
              <input
                type="checkbox"
                checked={assignment.noteField !== false}
                onChange={(e) => writeConfig({ noteField: e.target.checked ? undefined : false })}
                className="h-3.5 w-3.5 accent-primary"
              />
            </FieldRow>
          </>
        )}
      </FieldGroup>
    </Section>
  );
}
