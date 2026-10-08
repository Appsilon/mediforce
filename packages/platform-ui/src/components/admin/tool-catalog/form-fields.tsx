import { Plus, Trash2 } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { cn } from '@/lib/utils';

export function Field({
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

export function FieldGroup({
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

export function PillRadioGroup<Value extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled = false,
}: {
  legend: string;
  name: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} aria-label={legend}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
              value === option.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40',
              disabled && 'opacity-60 cursor-not-allowed',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="h-3.5 w-3.5"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const rowInputClass =
  'rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring';

/** One name/value pair inside a `FieldGroup` — an env var or a header. */
export function KeyValueRow({
  keyField,
  valueField,
  keyLabel,
  valueLabel,
  keyPlaceholder,
  valuePlaceholder,
  removeLabel,
  onRemove,
}: {
  keyField: UseFormRegisterReturn;
  valueField: UseFormRegisterReturn;
  keyLabel: string;
  valueLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input aria-label={keyLabel} {...keyField} placeholder={keyPlaceholder} className={cn(rowInputClass, 'w-40')} autoComplete="off" />
      <input aria-label={valueLabel} {...valueField} placeholder={valuePlaceholder} className={cn(rowInputClass, 'flex-1')} autoComplete="off" />
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        aria-label={removeLabel}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export const inputClass =
  'rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring';

export const catalogIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'Lowercase letters, numbers, dashes, underscores');

export function DescriptionField({
  register,
  error,
}: {
  register: UseFormRegisterReturn;
  error?: string;
}) {
  return (
    <Field label="Description" error={error}>
      <textarea
        id="entry-description"
        {...register}
        rows={3}
        className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        placeholder="What this MCP server exposes."
      />
    </Field>
  );
}

export function CatalogFormFooter({
  isEditing,
  submitting,
  submitError,
  onDelete,
  onCancel,
}: {
  isEditing: boolean;
  submitting: boolean;
  submitError?: string | null;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  return (
    <>
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
        <div className="flex items-center gap-2">
          {onCancel !== undefined && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving…' : isEditing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </>
  );
}
