'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StdioToolCatalogEntry, ToolCatalogEntry } from '@mediforce/platform-core';
import { CommandAvailability } from './command-availability';
import { COMMAND_SUGGESTIONS } from './command-check';
import {
  CatalogFormFooter,
  DescriptionField,
  Field,
  FieldGroup,
  KeyValueRow,
  PillRadioGroup,
  catalogIdSchema,
  inputClass,
} from './form-fields';
import { HttpCatalogFields } from './http-catalog-fields';

const StdioFormSchema = z.object({
  id: catalogIdSchema,
  command: z.string().min(1, 'Required'),
  args: z.array(z.object({ value: z.string() })),
  env: z.array(z.object({
    key: z.string().min(1, 'Required').regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Valid env var name'),
    value: z.string(),
  })),
  description: z.string(),
});

type StdioFormValues = z.infer<typeof StdioFormSchema>;

function valuesFromEntry(entry: StdioToolCatalogEntry | null): StdioFormValues {
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

function valuesToEntry(values: StdioFormValues, existingId?: string): StdioToolCatalogEntry {
  const args = values.args.map((arg) => arg.value).filter((value) => value !== '');
  const envEntries = values.env.filter((envVar) => envVar.key !== '');
  const description = values.description.trim();
  return {
    id: existingId ?? values.id.trim(),
    type: 'stdio',
    command: values.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(envEntries.length > 0
      ? { env: Object.fromEntries(envEntries.map((envVar) => [envVar.key, envVar.value])) }
      : {}),
    ...(description !== '' ? { description } : {}),
  };
}

const TRANSPORT_OPTIONS = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'HTTP' },
] as const;

export interface CatalogFormProps {
  namespace: string;
  entry: ToolCatalogEntry | null;
  onSubmit: (entry: ToolCatalogEntry) => Promise<void>;
  onDelete?: () => void;
  onCancel?: () => void;
  submitError?: string | null;
}

/** Add or edit one MCP server in the workspace catalog. A new entry picks its
 *  transport; an existing one keeps it, because agent bindings declare it. */
export function CatalogForm(props: CatalogFormProps) {
  const { entry } = props;
  const [transport, setTransport] = useState<ToolCatalogEntry['type']>(entry?.type ?? 'stdio');

  return (
    <div className="flex flex-col gap-5">
      <PillRadioGroup
        legend="Transport"
        name="transport"
        options={TRANSPORT_OPTIONS}
        value={transport}
        onChange={setTransport}
        disabled={entry !== null}
      />

      {transport === 'stdio' ? (
        <StdioCatalogFields {...props} entry={entry?.type === 'stdio' ? entry : null} />
      ) : (
        <HttpCatalogFields {...props} entry={entry?.type === 'http' ? entry : null} />
      )}
    </div>
  );
}

function StdioCatalogFields({
  namespace,
  entry,
  onSubmit,
  onDelete,
  onCancel,
  submitError,
}: Omit<CatalogFormProps, 'entry'> & { entry: StdioToolCatalogEntry | null }) {
  const isEditing = entry !== null;
  const form = useForm<StdioFormValues>({
    resolver: zodResolver(StdioFormSchema),
    defaultValues: valuesFromEntry(entry),
  });
  const argsArray = useFieldArray({ control: form.control, name: 'args' });
  const envArray = useFieldArray({ control: form.control, name: 'env' });

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(valuesToEntry(values, entry?.id));
  });

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Id" error={form.formState.errors.id?.message}>
          <input
            id="entry-id"
            {...form.register('id')}
            readOnly={isEditing}
            placeholder="github-mcp"
            className={cn(inputClass, isEditing && 'bg-muted text-muted-foreground cursor-not-allowed')}
            autoComplete="off"
          />
        </Field>
        <Field label="Command" error={form.formState.errors.command?.message}>
          <input
            id="entry-command"
            {...form.register('command')}
            placeholder="npx"
            list="entry-command-suggestions"
            className={inputClass}
            autoComplete="off"
          />
          <datalist id="entry-command-suggestions">
            {COMMAND_SUGGESTIONS.map((suggestion) => <option key={suggestion} value={suggestion} />)}
          </datalist>
        </Field>
      </div>

      <CommandAvailability namespace={namespace} command={form.watch('command') ?? ''} />

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
          <KeyValueRow
            key={field.id}
            keyField={form.register(`env.${index}.key` as const)}
            valueField={form.register(`env.${index}.value` as const)}
            keyLabel={`Env key ${index + 1}`}
            valueLabel={`Env value ${index + 1}`}
            keyPlaceholder="API_KEY"
            valuePlaceholder="{{SECRET:api-key}}"
            removeLabel="Remove env var"
            onRemove={() => envArray.remove(index)}
          />
        ))}
      </FieldGroup>

      <DescriptionField register={form.register('description')} error={form.formState.errors.description?.message} />

      <CatalogFormFooter
        isEditing={isEditing}
        submitting={form.formState.isSubmitting}
        submitError={submitError}
        onDelete={onDelete}
        onCancel={onCancel}
      />
    </form>
  );
}
