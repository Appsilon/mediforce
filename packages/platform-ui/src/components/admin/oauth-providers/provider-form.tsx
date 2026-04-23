'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import type { OAuthProviderConfig } from '@mediforce/platform-core';
import { OAUTH_PROVIDER_PRESETS } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';

const idPattern = /^[a-z0-9][a-z0-9-]*$/;

const FormSchema = z.object({
  id: z
    .string()
    .min(1, 'Required')
    .regex(idPattern, 'Lowercase letters, digits, or dashes (starting with letter/digit)'),
  name: z.string().min(1, 'Required'),
  clientId: z.string().min(1, 'Required'),
  clientSecret: z.string().min(1, 'Required'),
  authorizeUrl: z.string().url('Must be a valid URL'),
  tokenUrl: z.string().url('Must be a valid URL'),
  userInfoUrl: z.string().url('Must be a valid URL'),
  revokeUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  scopes: z.string().min(1, 'At least one scope is required'),
  iconUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

type ProviderFormValues = z.infer<typeof FormSchema>;

type PresetKey = keyof typeof OAUTH_PROVIDER_PRESETS;

/** Tokenizes a scopes string into individual scope tokens. Scopes are
 *  conventionally space-separated in OAuth flows but we tolerate newlines
 *  and commas too, to be friendly to admins pasting from provider docs. */
function tokenizeScopes(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

function emptyValues(): ProviderFormValues {
  return {
    id: '',
    name: '',
    clientId: '',
    clientSecret: '',
    authorizeUrl: '',
    tokenUrl: '',
    userInfoUrl: '',
    revokeUrl: '',
    scopes: '',
    iconUrl: '',
  };
}

function valuesFromPreset(preset: PresetKey): ProviderFormValues {
  const template = OAUTH_PROVIDER_PRESETS[preset];
  return {
    id: template.id,
    name: template.name,
    clientId: '',
    clientSecret: '',
    authorizeUrl: template.authorizeUrl,
    tokenUrl: template.tokenUrl,
    userInfoUrl: template.userInfoUrl,
    revokeUrl: template.revokeUrl ?? '',
    scopes: template.scopes.join(' '),
    iconUrl: '',
  };
}

function valuesFromProvider(provider: OAuthProviderConfig): ProviderFormValues {
  return {
    id: provider.id,
    name: provider.name,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    authorizeUrl: provider.authorizeUrl,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl,
    revokeUrl: provider.revokeUrl ?? '',
    scopes: provider.scopes.join(' '),
    iconUrl: provider.iconUrl ?? '',
  };
}

function valuesToPayload(
  values: ProviderFormValues,
  existingId?: string,
): Omit<OAuthProviderConfig, 'createdAt' | 'updatedAt'> {
  const scopes = tokenizeScopes(values.scopes);
  const revokeUrl = (values.revokeUrl ?? '').trim();
  const iconUrl = (values.iconUrl ?? '').trim();
  return {
    id: existingId ?? values.id.trim(),
    name: values.name.trim(),
    clientId: values.clientId.trim(),
    clientSecret: values.clientSecret,
    authorizeUrl: values.authorizeUrl.trim(),
    tokenUrl: values.tokenUrl.trim(),
    userInfoUrl: values.userInfoUrl.trim(),
    scopes,
    ...(revokeUrl !== '' ? { revokeUrl } : {}),
    ...(iconUrl !== '' ? { iconUrl } : {}),
  };
}

interface ProviderFormProps {
  provider: OAuthProviderConfig | null;
  preset: PresetKey | null;
  onSubmit: (payload: Omit<OAuthProviderConfig, 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => void;
  submitError?: string | null;
}

export function ProviderForm({
  provider,
  preset,
  onSubmit,
  onDelete,
  submitError,
}: ProviderFormProps) {
  const isEditing = provider !== null;
  const defaultValues = useMemo<ProviderFormValues>(() => {
    if (provider !== null) return valuesFromProvider(provider);
    if (preset !== null) return valuesFromPreset(preset);
    return emptyValues();
  }, [provider, preset]);

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues,
    mode: 'onSubmit',
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    const tokens = tokenizeScopes(values.scopes);
    if (tokens.length === 0) {
      form.setError('scopes', { message: 'At least one scope is required' });
      return;
    }
    const payload = valuesToPayload(values, isEditing ? provider!.id : undefined);
    await onSubmit(payload);
  });

  const submitting = form.formState.isSubmitting;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Id" error={form.formState.errors.id?.message}>
          <input
            id="provider-id"
            {...form.register('id')}
            readOnly={isEditing}
            placeholder="github"
            className={cn(
              'rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring',
              isEditing && 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
            autoComplete="off"
          />
        </Field>
        <Field label="Name" error={form.formState.errors.name?.message}>
          <input
            id="provider-name"
            {...form.register('name')}
            placeholder="GitHub"
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Client id" error={form.formState.errors.clientId?.message}>
          <input
            id="provider-client-id"
            {...form.register('clientId')}
            placeholder="Iv1.abcdef0123456789"
            className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </Field>
        <Field label="Client secret" error={form.formState.errors.clientSecret?.message}>
          <input
            id="provider-client-secret"
            type="password"
            {...form.register('clientSecret')}
            placeholder="••••••••"
            className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="new-password"
          />
        </Field>
      </div>

      <Field label="Authorize URL" error={form.formState.errors.authorizeUrl?.message}>
        <input
          id="provider-authorize-url"
          {...form.register('authorizeUrl')}
          placeholder="https://github.com/login/oauth/authorize"
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </Field>

      <Field label="Token URL" error={form.formState.errors.tokenUrl?.message}>
        <input
          id="provider-token-url"
          {...form.register('tokenUrl')}
          placeholder="https://github.com/login/oauth/access_token"
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </Field>

      <Field label="User info URL" error={form.formState.errors.userInfoUrl?.message}>
        <input
          id="provider-userinfo-url"
          {...form.register('userInfoUrl')}
          placeholder="https://api.github.com/user"
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </Field>

      <Field
        label="Revoke URL"
        hint="Optional. When present, 'Revoke' in the agent UI POSTs here after deleting the local token."
        error={form.formState.errors.revokeUrl?.message}
      >
        <input
          id="provider-revoke-url"
          {...form.register('revokeUrl')}
          placeholder="https://oauth2.googleapis.com/revoke"
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </Field>

      <Field
        label="Scopes"
        hint="Space-separated (or one per line). Sent verbatim to the provider at authorize time."
        error={form.formState.errors.scopes?.message}
      >
        <textarea
          id="provider-scopes"
          {...form.register('scopes')}
          rows={2}
          placeholder="repo read:user"
          className="resize-none rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      <Field
        label="Icon URL"
        hint="Optional. Shown in provider dropdown on agent binding form."
        error={form.formState.errors.iconUrl?.message}
      >
        <input
          id="provider-icon-url"
          {...form.register('iconUrl')}
          placeholder="https://cdn.example.com/github.svg"
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
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        {children}
      </label>
      {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error !== undefined && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
