'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCatalogEntry } from '@mediforce/platform-core';

const slugPattern = /^[a-z0-9][a-z0-9_-]*$/;

const FormSchema = z.object({
  id: z.string().regex(slugPattern, 'Lowercase letters, numbers, dashes, underscores'),
  command: z.string().min(1, 'Required'),
  args: z.array(z.object({ value: z.string() })),
  env: z.array(z.object({
    key: z.string().min(1, 'Required').regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Valid env var name'),
    value: z.string(),
  })),
  description: z.string(),
});

type CatalogFormValues = z.infer<typeof FormSchema>;

function valuesFromEntry(entry: ToolCatalogEntry | null): CatalogFormValues {
  if (entry === null) {
    return { id: '', command: '', args: [], env: [], description: '' };
  }
  return {
    id: entry.id,
    command: entry.command,
    args: (entry.args ?? []).map((value) => ({ value })),
    env: Object.entries(entry.env ?? {}).map(([key, value]) => ({ key, value })),
    description: entry.description ?? '',
  };
}

function valuesToEntry(values: CatalogFormValues, existingId?: string): ToolCatalogEntry {
  const args = values.args.map((a) => a.value).filter((value) => value !== '');
  const envEntries = values.env.filter((e) => e.key !== '');
  const description = values.description.trim();
  return {
    id: existingId ?? values.id.trim(),
    command: values.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(envEntries.length > 0
      ? { env: Object.fromEntries(envEntries.map((e) => [e.key, e.value])) }
      : {}),
    ...(description !== '' ? { description } : {}),
  };
}

interface CatalogFormProps {
  entry: ToolCatalogEntry | null;
  onSubmit: (entry: ToolCatalogEntry) => Promise<void>;
  onDelete?: () => void;
  submitError?: string | null;
}

export function CatalogForm({ entry, onSubmit, onDelete, submitError }: CatalogFormProps) {
  const isEditing = entry !== null;
  const form = useForm<CatalogFormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: valuesFromEntry(entry),
  });
  const argsArray = useFieldArray({ control: form.control, name: 'args' });
  const envArray = useFieldArray({ control: form.control, name: 'env' });

  const handleSubmit = form.handleSubmit(async (values) => {
    const payload = valuesToEntry(values, isEditing ? entry!.id : undefined);
    await onSubmit(payload);
  });

  const submitting = form.formState.isSubmitting;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Id" error={form.formState.errors.id?.message}>
          <input
            id="entry-id"
            {...form.register('id')}
            readOnly={isEditing}
            placeholder="github-mcp"
            className={cn(
              'rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring',
              isEditing && 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
            autoComplete="off"
          />
        </Field>
        <Field label="Command" error={form.formState.errors.command?.message}>
          <input
            id="entry-command"
            {...form.register('command')}
            placeholder="npx"
            className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </Field>
      </div>

      <FieldGroup
        label="Args"
        hint="Positional arguments passed to the command."
        onAdd={() => argsArray.append({ value: '' })}
      >
        {argsArray.fields.length === 0 && (
          <p className="text-xs text-muted-foreground">No args.</p>
        )}
        {argsArray.fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2">
            <input
              id={`arg-${index}`}
              aria-label={`Arg ${index + 1}`}
              {...form.register(`args.${index}.value` as const)}
              placeholder={index === 0 ? '-y' : ''}
              className="flex-1 rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => argsArray.remove(index)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              aria-label="Remove arg"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </FieldGroup>

      <FieldGroup
        label="Env"
        hint={
          <>
            Environment variables. Values support{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{'{{SECRET:name}}'}</code> — resolved at spawn time from workflow secrets.
          </>
        }
        onAdd={() => envArray.append({ key: '', value: '' })}
      >
        {envArray.fields.length === 0 && (
          <p className="text-xs text-muted-foreground">No env.</p>
        )}
        {envArray.fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2">
            <input
              aria-label={`Env key ${index + 1}`}
              {...form.register(`env.${index}.key` as const)}
              placeholder="API_KEY"
              className="w-40 rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              autoComplete="off"
            />
            <input
              aria-label={`Env value ${index + 1}`}
              {...form.register(`env.${index}.value` as const)}
              placeholder="{{SECRET:api-key}}"
              className="flex-1 rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => envArray.remove(index)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              aria-label="Remove env var"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </FieldGroup>

      <Field label="Description" error={form.formState.errors.description?.message}>
        <textarea
          id="entry-description"
          {...form.register('description')}
          rows={3}
          className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="What this MCP server exposes."
        />
      </Field>

      {submitError !== undefined && submitError !== null && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        {onDelete !== undefined ? (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        ) : (
          <div />
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Saving…' : isEditing ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error !== undefined && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

function FieldGroup({
  label,
  hint,
  onAdd,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add {label.toLowerCase().replace(/s$/, '')}
        </button>
      </div>
      {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
