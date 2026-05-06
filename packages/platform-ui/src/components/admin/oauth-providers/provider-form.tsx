'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronDown, ChevronRight, ExternalLink, Trash2 } from 'lucide-react';
import type { OAuthProviderConfig } from '@mediforce/platform-core';
import { OAUTH_PROVIDER_PRESETS } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const githubAppSlugPattern = /^[a-z0-9][a-z0-9-]*$/;

function authorizeUrlFromGithubAppSlug(slug: string): string {
  return `https://github.com/apps/${slug}/installations/new`;
}

const FormSchema = z.object({
  id: z
    .string()
    .min(1, 'Required')
    .regex(idPattern, 'Lowercase letters, digits, or dashes (starting with letter/digit)'),
  name: z.string().min(1, 'Required'),
  clientId: z.string().min(1, 'Required'),
  clientSecret: z.string().min(1, 'Required'),
  // Convenience input for the GitHub preset — synthesises authorizeUrl on
  // change. Not part of the persisted payload. Optional at the schema level
  // so non-GitHub presets parse cleanly; required-when-github is enforced in
  // a superRefine below.
  appSlug: z.string().optional(),
  authorizeUrl: z.string().url('Must be a valid URL'),
  tokenUrl: z.string().url('Must be a valid URL'),
  userInfoUrl: z.string().url('Must be a valid URL'),
  revokeUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  scopes: z.string().min(1, 'At least one scope is required'),
  iconUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
}).superRefine((values, ctx) => {
  // Catch the placeholder slipping through when admin ignores the App slug
  // field. authorizeUrl passes z.string().url() but is functionally broken.
  if (values.authorizeUrl.includes('your-app-slug')) {
    ctx.addIssue({
      path: ['appSlug'],
      code: z.ZodIssueCode.custom,
      message: 'Fill in your GitHub App slug to set the Authorize URL.',
    });
  }
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
    appSlug: '',
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
    appSlug: '',
    authorizeUrl: template.authorizeUrl,
    tokenUrl: template.tokenUrl,
    userInfoUrl: template.userInfoUrl,
    revokeUrl: template.revokeUrl ?? '',
    scopes: template.scopes.join(' '),
    iconUrl: 'iconUrl' in template ? (template.iconUrl ?? '') : '',
  };
}

function valuesFromProvider(provider: OAuthProviderConfig): ProviderFormValues {
  return {
    id: provider.id,
    name: provider.name,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret ?? '',
    appSlug: '',
    authorizeUrl: provider.authorizeUrl,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl ?? '',
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

  // Pre-fillable fields (URLs, scopes, icon) live behind an "Advanced" toggle
  // for preset flows so the visible form is just id/name/clientId/clientSecret.
  // Custom-create and edit modes open it by default since the admin is there
  // specifically to set or review those values.
  const [advancedOpen, setAdvancedOpen] = useState(preset === null);

  // GitHub preset gets its own callback URL hint (one URL per provider id —
  // each GitHub App registers its own callback) and a slug field that
  // synthesises authorizeUrl as the admin types.
  const isGithubPreset = preset === 'github' && !isEditing;
  const idValue = form.watch('id');
  const appSlugValue = form.watch('appSlug') ?? '';
  const callbackUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = idValue !== '' ? idValue : 'github';
    return `${window.location.origin}/api/oauth/${slug}/callback`;
  }, [idValue]);

  useEffect(() => {
    if (!isGithubPreset) return;
    const slug = appSlugValue.trim();
    if (slug === '') return;
    if (!githubAppSlugPattern.test(slug)) return;
    form.setValue('authorizeUrl', authorizeUrlFromGithubAppSlug(slug), {
      shouldValidate: false,
      shouldDirty: true,
    });
  }, [appSlugValue, isGithubPreset, form]);

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
      {isGithubPreset && (
        <GithubAppSetupGuide callbackUrl={callbackUrl} providerId={idValue} />
      )}

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

      {isGithubPreset && (
        <Field
          label="GitHub App slug"
          hint="From github.com/apps/<slug> — the URL of your installed App."
          error={form.formState.errors.appSlug?.message}
        >
          <input
            id="provider-app-slug"
            {...form.register('appSlug')}
            placeholder="my-org-mediforce"
            className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </Field>
      )}

      <div className="flex flex-col gap-4 rounded-md border bg-muted/20 px-3 py-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          aria-controls="provider-advanced"
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {advancedOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Advanced — endpoints, scopes, icon
        </button>

        {advancedOpen && (
          <div id="provider-advanced" className="flex flex-col gap-4">
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
          </div>
        )}
      </div>

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

/** Inline runbook for the GitHub App setup. We default to the App flow (not
 *  classic OAuth Apps) because Apps offer install-scoped, fine-grained
 *  permissions per repo/org — the right shape for agents that open PRs. */
function GithubAppSetupGuide({
  callbackUrl,
  providerId,
}: {
  callbackUrl: string;
  providerId: string;
}) {
  const callbackPlaceholder = callbackUrl !== ''
    ? callbackUrl
    : `<deployment>/api/oauth/${providerId !== '' ? providerId : 'github'}/callback`;

  return (
    <div className="rounded-md border bg-muted/40 px-4 py-3 text-xs">
      <p className="mb-2 text-sm font-medium text-foreground">Setting up a GitHub App</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
        <li>
          Open{' '}
          <a
            href="https://github.com/settings/apps/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-foreground underline underline-offset-2"
          >
            github.com/settings/apps/new
            <ExternalLink className="h-3 w-3" />
          </a>{' '}
          (or your org's developer settings to install at org scope).
        </li>
        <li>
          <span className="font-medium text-foreground">Callback URL:</span>{' '}
          <code className="rounded bg-background px-1 py-0.5 font-mono">
            {callbackPlaceholder}
          </code>{' '}
          — derived from the <span className="font-mono">Id</span> field above; change Id to bind
          a different App.
        </li>
        <li>
          Disable webhook (we don't consume events).{' '}
          <span className="font-medium text-foreground">Permissions:</span> Contents (Read &amp;
          write), Pull requests (Read &amp; write), Metadata (Read).
        </li>
        <li>Save, then generate a client secret on the App page.</li>
        <li>Install the App on your account / org and grant access to the repos the agent will touch.</li>
        <li>
          Copy the App slug from the install URL (
          <code className="rounded bg-background px-1 py-0.5 font-mono">
            github.com/apps/&lt;slug&gt;
          </code>
          ) and paste it into <span className="font-medium text-foreground">GitHub App slug</span>{' '}
          below — that builds the Authorize URL.
        </li>
        <li>Paste the App's client id and the secret you generated, then Create.</li>
      </ol>
    </div>
  );
}
