'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import type { CreateSkillRegistryInput, SkillRegistry } from '@mediforce/platform-core';

const FormSchema = z.object({
  name: z.string().min(1, 'Required'),
  repoUrl: z.string().url('Must be a valid URL'),
  repoCommit: z
    .string()
    .regex(/^[a-f0-9]{7,40}$/, 'Commit must be a hex SHA (7-40 chars)'),
  repoAuth: z.string(),
  skillsDir: z.string().min(1, 'Required'),
});

type SkillRegistryFormValues = z.infer<typeof FormSchema>;

function valuesFromRegistry(registry: SkillRegistry | null): SkillRegistryFormValues {
  if (registry === null) {
    return { name: '', repoUrl: '', repoCommit: '', repoAuth: '', skillsDir: 'skills' };
  }
  return {
    name: registry.name,
    repoUrl: registry.repo.url,
    repoCommit: registry.repo.commit ?? '',
    repoAuth: registry.repo.auth ?? '',
    skillsDir: registry.skillsDir,
  };
}

function valuesToInput(values: SkillRegistryFormValues, namespace: string): CreateSkillRegistryInput {
  const auth = values.repoAuth.trim();
  return {
    name: values.name.trim(),
    namespace,
    repo: {
      url: values.repoUrl.trim(),
      commit: values.repoCommit.trim(),
      ...(auth !== '' ? { auth } : {}),
    },
    skillsDir: values.skillsDir.trim(),
  };
}

interface SkillRegistryFormProps {
  registry: SkillRegistry | null;
  namespace: string;
  onSubmit: (input: CreateSkillRegistryInput) => Promise<void>;
  onDelete?: () => void;
  submitError?: string | null;
}

export function SkillRegistryForm({
  registry,
  namespace,
  onSubmit,
  onDelete,
  submitError,
}: SkillRegistryFormProps) {
  const isEditing = registry !== null;
  const form = useForm<SkillRegistryFormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: valuesFromRegistry(registry),
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(valuesToInput(values, namespace));
  });

  const submitting = form.formState.isSubmitting;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Field label="Name" error={form.formState.errors.name?.message}>
        <input
          {...form.register('name')}
          placeholder="SDTM skills"
          className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </Field>

      <Field label="Repository URL" error={form.formState.errors.repoUrl?.message}>
        <input
          {...form.register('repoUrl')}
          placeholder="https://github.com/org/skills.git"
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Commit SHA"
          hint="Hex SHA, 7-40 chars. Pins the skill versions used by agents."
          error={form.formState.errors.repoCommit?.message}
        >
          <input
            {...form.register('repoCommit')}
            placeholder="a1b2c3d"
            className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </Field>
        <Field
          label="Skills directory"
          hint="Path within the repo containing skill folders."
          error={form.formState.errors.skillsDir?.message}
        >
          <input
            {...form.register('skillsDir')}
            placeholder="skills"
            className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </Field>
      </div>

      <Field
        label="Auth secret"
        hint="Optional. Name of a workspace secret (e.g. GITHUB_TOKEN) for private repos."
        error={form.formState.errors.repoAuth?.message}
      >
        <input
          {...form.register('repoAuth')}
          placeholder="GITHUB_TOKEN"
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
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
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint !== undefined && error === undefined && (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
      {error !== undefined && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}
