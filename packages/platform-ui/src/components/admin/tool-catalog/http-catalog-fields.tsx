'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { HttpToolCatalogEntry, OAuthProviderConfig } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { mediforce } from '@/lib/mediforce';
import type { CatalogFormProps } from './catalog-form';
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

const HttpFormSchema = z
  .object({
    id: catalogIdSchema,
    url: z.string().url('Must be a valid URL'),
    authMode: z.enum(['none', 'headers', 'oauth']),
    headers: z.array(
      z.object({
        key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Header name'),
        value: z.string(),
      }),
    ),
    oauthProvider: z.string().optional(),
    oauthHeaderName: z.string().optional(),
    oauthHeaderValueTemplate: z.string().optional(),
    description: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.authMode !== 'oauth') return;
    if (values.oauthProvider === undefined || values.oauthProvider === '') {
      ctx.addIssue({ path: ['oauthProvider'], code: z.ZodIssueCode.custom, message: 'Select a provider' });
    }
    if (values.oauthHeaderName === undefined || values.oauthHeaderName.trim() === '') {
      ctx.addIssue({ path: ['oauthHeaderName'], code: z.ZodIssueCode.custom, message: 'Header name is required' });
    }
    if (values.oauthHeaderValueTemplate === undefined || !values.oauthHeaderValueTemplate.includes('{token}')) {
      ctx.addIssue({
        path: ['oauthHeaderValueTemplate'],
        code: z.ZodIssueCode.custom,
        message: 'Template must include {token}',
      });
    }
  });
type HttpFormValues = z.infer<typeof HttpFormSchema>;

const AUTH_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'headers', label: 'Static headers' },
  { value: 'oauth', label: 'OAuth' },
] as const;

function valuesFromEntry(entry: HttpToolCatalogEntry | null): HttpFormValues {
  const auth = entry?.auth;
  return {
    id: entry?.id ?? '',
    url: entry?.url ?? '',
    authMode: auth?.type ?? 'none',
    headers: auth?.type === 'headers' ? Object.entries(auth.headers).map(([key, value]) => ({ key, value })) : [],
    oauthProvider: auth?.type === 'oauth' ? auth.provider : '',
    oauthHeaderName: auth?.type === 'oauth' ? auth.headerName : 'Authorization',
    oauthHeaderValueTemplate: auth?.type === 'oauth' ? auth.headerValueTemplate : 'Bearer {token}',
    description: entry?.description ?? '',
  };
}

function valuesToEntry(values: HttpFormValues, existingId?: string): HttpToolCatalogEntry {
  const headers = values.headers.filter((header) => header.key !== '');
  let auth: HttpToolCatalogEntry['auth'];
  if (values.authMode === 'headers' && headers.length > 0) {
    auth = { type: 'headers', headers: Object.fromEntries(headers.map((header) => [header.key, header.value])) };
  } else if (values.authMode === 'oauth') {
    auth = {
      type: 'oauth',
      provider: values.oauthProvider ?? '',
      headerName: (values.oauthHeaderName ?? 'Authorization').trim(),
      headerValueTemplate: (values.oauthHeaderValueTemplate ?? 'Bearer {token}').trim(),
    };
  }
  const description = values.description.trim();
  return {
    id: existingId ?? values.id.trim(),
    type: 'http',
    url: values.url.trim(),
    ...(auth !== undefined ? { auth } : {}),
    ...(description !== '' ? { description } : {}),
  };
}

/** A remote MCP server: its URL and how an agent authenticates to it. OAuth
 *  tokens are per agent, so the connect flow lives on each agent's binding. */
export function HttpCatalogFields({
  namespace,
  entry,
  onSubmit,
  onDelete,
  onCancel,
  submitError,
}: Omit<CatalogFormProps, 'entry'> & { entry: HttpToolCatalogEntry | null }) {
  const isEditing = entry !== null;
  const form = useForm<HttpFormValues>({
    resolver: zodResolver(HttpFormSchema),
    defaultValues: valuesFromEntry(entry),
  });
  const headersArray = useFieldArray({ control: form.control, name: 'headers' });
  const authMode = form.watch('authMode');
  const oauthProviderId = form.watch('oauthProvider');

  const [providers, setProviders] = useState<OAuthProviderConfig[]>([]);
  const [providersError, setProvidersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { providers: list } = await mediforce.oauthProviders.list({ namespace });
        if (!cancelled) setProviders(list as OAuthProviderConfig[]);
      } catch (err: unknown) {
        if (!cancelled) setProvidersError(err instanceof Error ? err.message : 'Failed to load providers.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [namespace]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === oauthProviderId) ?? null,
    [providers, oauthProviderId],
  );

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(valuesToEntry(values, entry?.id));
  });

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <Field label="Id" error={form.formState.errors.id?.message}>
          <input
            aria-label="Id"
            {...form.register('id')}
            readOnly={isEditing}
            placeholder="github"
            className={cn(inputClass, isEditing && 'bg-muted text-muted-foreground cursor-not-allowed')}
            autoComplete="off"
          />
        </Field>
        <Field label="URL" error={form.formState.errors.url?.message}>
          <input
            aria-label="URL"
            {...form.register('url')}
            placeholder="https://api.example.com/mcp"
            className={inputClass}
            autoComplete="off"
          />
        </Field>
      </div>

      <PillRadioGroup
        legend="Authentication"
        name="authMode"
        options={AUTH_OPTIONS}
        value={authMode}
        onChange={(mode) => form.setValue('authMode', mode)}
      />

      {authMode === 'headers' && (
        <FieldGroup
          label="Headers"
          hint={
            <>
              Values support{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{'{{SECRET:name}}'}</code> — resolved at
              spawn time from the workflow secrets that trigger the run.
            </>
          }
          onAdd={() => headersArray.append({ key: '', value: '' })}
        >
          {headersArray.fields.length === 0 && <p className="text-xs text-muted-foreground">No headers.</p>}
          {headersArray.fields.map((field, index) => (
            <KeyValueRow
              key={field.id}
              keyField={form.register(`headers.${index}.key` as const)}
              valueField={form.register(`headers.${index}.value` as const)}
              keyLabel={`Header key ${index + 1}`}
              valueLabel={`Header value ${index + 1}`}
              keyPlaceholder="Authorization"
              valuePlaceholder="Bearer {{SECRET:api-key}}"
              removeLabel={`Remove header ${index + 1}`}
              onRemove={() => headersArray.remove(index)}
            />
          ))}
        </FieldGroup>
      )}

      {authMode === 'oauth' && (
        <div className="flex flex-col gap-3 rounded-md border bg-card px-3 py-3">
          <Field label="Provider" error={form.formState.errors.oauthProvider?.message}>
            <select
              aria-label="OAuth provider"
              {...form.register('oauthProvider')}
              className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select a provider…</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            {providersError !== null && <span className="mt-1 text-xs text-destructive">{providersError}</span>}
            {providers.length === 0 && providersError === null && (
              <span className="mt-1 text-xs text-muted-foreground">
                No OAuth providers configured for this namespace. Ask an admin to add one via OAuth providers.
              </span>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Header name" error={form.formState.errors.oauthHeaderName?.message}>
              <input
                aria-label="OAuth header name"
                {...form.register('oauthHeaderName')}
                placeholder="Authorization"
                className={inputClass}
                autoComplete="off"
              />
            </Field>
            <Field label="Header value template" error={form.formState.errors.oauthHeaderValueTemplate?.message}>
              <input
                aria-label="OAuth header value template"
                {...form.register('oauthHeaderValueTemplate')}
                placeholder="Bearer {token}"
                className={inputClass}
                autoComplete="off"
              />
            </Field>
          </div>

          {selectedProvider !== null && (
            <p className="text-xs text-muted-foreground">
              Scopes:{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{selectedProvider.scopes.join(' ')}</code>
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Each agent connects its own account: bind this server to an agent, then use Connect on that binding.
          </p>
        </div>
      )}

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
