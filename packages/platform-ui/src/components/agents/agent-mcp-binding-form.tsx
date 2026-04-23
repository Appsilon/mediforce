'use client';

import { useEffect, useState, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import type {
  AgentMcpBinding,
  OAuthProviderConfig,
  ToolCatalogEntry,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { listOAuthProviders } from '@/lib/oauth-admin-client';
import { OAuthConnectionStatus } from './oauth-connection-status';

const nameRegex = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const StdioFormSchema = z.object({
  catalogId: z.string().min(1, 'Choose a catalog entry'),
  allowedTools: z.array(z.object({ value: z.string() })),
});
type StdioFormValues = z.infer<typeof StdioFormSchema>;

const HttpFormSchema = z
  .object({
    url: z.string().url('Must be a valid URL'),
    allowedTools: z.array(z.object({ value: z.string() })),
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
  })
  .superRefine((values, ctx) => {
    if (values.authMode !== 'oauth') return;
    if (values.oauthProvider === undefined || values.oauthProvider === '') {
      ctx.addIssue({
        path: ['oauthProvider'],
        code: z.ZodIssueCode.custom,
        message: 'Select a provider',
      });
    }
    if (values.oauthHeaderName === undefined || values.oauthHeaderName.trim() === '') {
      ctx.addIssue({
        path: ['oauthHeaderName'],
        code: z.ZodIssueCode.custom,
        message: 'Header name is required',
      });
    }
    if (
      values.oauthHeaderValueTemplate === undefined ||
      !values.oauthHeaderValueTemplate.includes('{token}')
    ) {
      ctx.addIssue({
        path: ['oauthHeaderValueTemplate'],
        code: z.ZodIssueCode.custom,
        message: 'Template must include {token}',
      });
    }
  });
type HttpFormValues = z.infer<typeof HttpFormSchema>;

interface AgentMcpBindingFormProps {
  existing: { name: string; binding: AgentMcpBinding } | null;
  existingNames: string[];
  catalogEntries: ToolCatalogEntry[];
  agentId: string;
  namespace: string;
  onSubmit: (name: string, binding: AgentMcpBinding) => Promise<void>;
  onCancel: () => void;
}

export function AgentMcpBindingForm({
  existing,
  existingNames,
  catalogEntries,
  agentId,
  namespace,
  onSubmit,
  onCancel,
}: AgentMcpBindingFormProps) {
  const isEdit = existing !== null;
  const [name, setName] = useState(existing?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [transport, setTransport] = useState<'stdio' | 'http'>(existing?.binding.type ?? 'stdio');
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validateName(value: string): string | null {
    if (!nameRegex.test(value)) return 'Letters, numbers, dashes, underscores; must start with letter or digit.';
    if (!isEdit && existingNames.includes(value)) return `"${value}" is already bound to this agent.`;
    return null;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Server name ------------------------------------------------------- */}
      <Field label="Server name" error={nameError}>
        <input
          aria-label="Server name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          readOnly={isEdit}
          placeholder="filesystem"
          className={cn(
            'rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring',
            isEdit && 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
          autoComplete="off"
        />
      </Field>

      {/* Transport -------------------------------------------------------- */}
      <fieldset className="flex flex-col gap-2" disabled={isEdit} aria-label="Transport">
        <legend className="text-sm font-medium">Transport</legend>
        <div className="flex gap-2">
          {(['stdio', 'http'] as const).map((option) => (
            <label
              key={option}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                transport === option
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border hover:border-primary/40',
                isEdit && 'opacity-60 cursor-not-allowed',
              )}
            >
              <input
                type="radio"
                name="transport"
                value={option}
                checked={transport === option}
                onChange={() => setTransport(option)}
                className="h-3.5 w-3.5"
              />
              {option === 'stdio' ? 'stdio' : 'HTTP'}
            </label>
          ))}
        </div>
      </fieldset>

      {transport === 'stdio' ? (
        <StdioFields
          key="stdio-fields"
          initial={existing?.binding.type === 'stdio' ? existing.binding : null}
          catalogEntries={catalogEntries}
          onSubmit={async (payload) => {
            const err = validateName(name);
            if (err !== null) {
              setNameError(err);
              throw new Error(err);
            }
            setSubmitError(null);
            try {
              await onSubmit(name, payload);
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : 'Save failed.';
              setSubmitError(message);
              throw err;
            }
          }}
          onCancel={onCancel}
          submitError={submitError}
          submitLabel={isEdit ? 'Save' : 'Create binding'}
        />
      ) : (
        <HttpFields
          key="http-fields"
          initial={existing?.binding.type === 'http' ? existing.binding : null}
          agentId={agentId}
          namespace={namespace}
          existingServerName={existing?.name ?? null}
          onSubmit={async (payload) => {
            const err = validateName(name);
            if (err !== null) {
              setNameError(err);
              throw new Error(err);
            }
            setSubmitError(null);
            try {
              await onSubmit(name, payload);
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : 'Save failed.';
              setSubmitError(message);
              throw err;
            }
          }}
          onCancel={onCancel}
          submitError={submitError}
          submitLabel={isEdit ? 'Save' : 'Create binding'}
        />
      )}
    </div>
  );
}

// ── Stdio subform ───────────────────────────────────────────────────────────

function StdioFields({
  initial,
  catalogEntries,
  onSubmit,
  onCancel,
  submitError,
  submitLabel,
}: {
  initial: { type: 'stdio'; catalogId: string; allowedTools?: string[] } | null;
  catalogEntries: ToolCatalogEntry[];
  onSubmit: (binding: AgentMcpBinding) => Promise<void>;
  onCancel: () => void;
  submitError: string | null;
  submitLabel: string;
}) {
  const form = useForm<StdioFormValues>({
    resolver: zodResolver(StdioFormSchema),
    defaultValues: {
      catalogId: initial?.catalogId ?? '',
      allowedTools: (initial?.allowedTools ?? []).map((value) => ({ value })),
    },
  });
  const allowedArray = useFieldArray({ control: form.control, name: 'allowedTools' });

  const handleSubmit = form.handleSubmit(async (values) => {
    const allowed = values.allowedTools.map((tool) => tool.value).filter((value) => value !== '');
    const binding: AgentMcpBinding = {
      type: 'stdio',
      catalogId: values.catalogId,
      ...(allowed.length > 0 ? { allowedTools: allowed } : {}),
    };
    await onSubmit(binding);
  });

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="Catalog entry" error={form.formState.errors.catalogId?.message}>
        <select
          aria-label="Catalog entry"
          {...form.register('catalogId')}
          className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select a catalog entry…</option>
          {catalogEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
              {entry.description !== undefined ? ` — ${entry.description}` : ''}
            </option>
          ))}
        </select>
        {catalogEntries.length === 0 && (
          <span className="mt-1 text-xs text-muted-foreground">
            No catalog entries in this namespace yet. Ask an admin to add one via Manage catalog.
          </span>
        )}
      </Field>

      <AllowedToolsSection
        fields={allowedArray.fields}
        onAdd={() => allowedArray.append({ value: '' })}
        onRemove={(index) => allowedArray.remove(index)}
        registerInput={(index) => form.register(`allowedTools.${index}.value` as const)}
      />

      <FormFooter
        submitError={submitError}
        onCancel={onCancel}
        submitting={form.formState.isSubmitting}
        submitLabel={submitLabel}
      />
    </form>
  );
}

// ── HTTP subform ────────────────────────────────────────────────────────────

function HttpFields({
  initial,
  agentId,
  namespace,
  existingServerName,
  onSubmit,
  onCancel,
  submitError,
  submitLabel,
}: {
  initial: Extract<AgentMcpBinding, { type: 'http' }> | null;
  agentId: string;
  namespace: string;
  existingServerName: string | null;
  onSubmit: (binding: AgentMcpBinding) => Promise<void>;
  onCancel: () => void;
  submitError: string | null;
  submitLabel: string;
}) {
  const initialHeaders = useMemo(() => {
    if (initial?.auth?.type !== 'headers') return [];
    return Object.entries(initial.auth.headers).map(([key, value]) => ({ key, value }));
  }, [initial]);

  const initialAuthMode: 'none' | 'headers' | 'oauth' = useMemo(() => {
    if (initial?.auth?.type === 'oauth') return 'oauth';
    if (initial?.auth?.type === 'headers') return 'headers';
    return 'none';
  }, [initial]);

  const form = useForm<HttpFormValues>({
    resolver: zodResolver(HttpFormSchema),
    defaultValues: {
      url: initial?.url ?? '',
      allowedTools: (initial?.allowedTools ?? []).map((value) => ({ value })),
      authMode: initialAuthMode,
      headers: initialHeaders,
      oauthProvider: initial?.auth?.type === 'oauth' ? initial.auth.provider : '',
      oauthHeaderName:
        initial?.auth?.type === 'oauth' ? initial.auth.headerName : 'Authorization',
      oauthHeaderValueTemplate:
        initial?.auth?.type === 'oauth' ? initial.auth.headerValueTemplate : 'Bearer {token}',
    },
  });
  const allowedArray = useFieldArray({ control: form.control, name: 'allowedTools' });
  const headersArray = useFieldArray({ control: form.control, name: 'headers' });
  const authMode = form.watch('authMode');
  const oauthProviderId = form.watch('oauthProvider');

  const [providers, setProviders] = useState<OAuthProviderConfig[]>([]);
  const [providersError, setProvidersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listOAuthProviders(namespace);
        if (!cancelled) setProviders(list);
      } catch (err: unknown) {
        if (!cancelled) {
          setProvidersError(err instanceof Error ? err.message : 'Failed to load providers.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [namespace]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === oauthProviderId) ?? null,
    [providers, oauthProviderId],
  );

  const handleSubmit = form.handleSubmit(async (values) => {
    const allowed = values.allowedTools.map((tool) => tool.value).filter((value) => value !== '');
    const headers = values.headers.filter((header) => header.key !== '');

    let auth: Extract<AgentMcpBinding, { type: 'http' }>['auth'];
    if (values.authMode === 'headers' && headers.length > 0) {
      auth = {
        type: 'headers' as const,
        headers: Object.fromEntries(headers.map((header) => [header.key, header.value])),
      };
    } else if (values.authMode === 'oauth') {
      auth = {
        type: 'oauth' as const,
        provider: values.oauthProvider ?? '',
        headerName: (values.oauthHeaderName ?? 'Authorization').trim(),
        headerValueTemplate: (values.oauthHeaderValueTemplate ?? 'Bearer {token}').trim(),
      };
    }

    const binding: AgentMcpBinding = {
      type: 'http',
      url: values.url,
      ...(allowed.length > 0 ? { allowedTools: allowed } : {}),
      ...(auth !== undefined ? { auth } : {}),
    };
    await onSubmit(binding);
  });

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="URL" error={form.formState.errors.url?.message}>
        <input
          aria-label="URL"
          {...form.register('url')}
          placeholder="https://api.example.com/mcp"
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </Field>

      <fieldset className="flex flex-col gap-2" aria-label="Authentication">
        <legend className="text-sm font-medium">Authentication</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: 'none', label: 'None' },
              { value: 'headers', label: 'Static headers' },
              { value: 'oauth', label: 'OAuth' },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                authMode === option.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border hover:border-primary/40',
              )}
            >
              <input
                type="radio"
                value={option.value}
                checked={authMode === option.value}
                onChange={() => form.setValue('authMode', option.value)}
                className="h-3.5 w-3.5"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {authMode === 'headers' && (
        <div className="flex flex-col gap-2 rounded-md border bg-card px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Headers</span>
            <button
              type="button"
              onClick={() => headersArray.append({ key: '', value: '' })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Add header
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Values support{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{'{{SECRET:name}}'}</code> — resolved at spawn
            time from the workflow secrets that trigger the run.
          </p>
          {headersArray.fields.length === 0 && (
            <p className="text-xs text-muted-foreground">No headers.</p>
          )}
          {headersArray.fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <input
                aria-label={`Header key ${index + 1}`}
                {...form.register(`headers.${index}.key` as const)}
                placeholder="Authorization"
                className="w-40 rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
              <input
                aria-label={`Header value ${index + 1}`}
                {...form.register(`headers.${index}.value` as const)}
                placeholder="Bearer {{SECRET:api-key}}"
                className="flex-1 rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => headersArray.remove(index)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label={`Remove header ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
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
            {providersError !== null && (
              <span className="mt-1 text-xs text-destructive">{providersError}</span>
            )}
            {providers.length === 0 && providersError === null && (
              <span className="mt-1 text-xs text-muted-foreground">
                No OAuth providers configured for this namespace. Ask an admin to add one via
                OAuth providers.
              </span>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Header name" error={form.formState.errors.oauthHeaderName?.message}>
              <input
                aria-label="OAuth header name"
                {...form.register('oauthHeaderName')}
                placeholder="Authorization"
                className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Header value template"
              error={form.formState.errors.oauthHeaderValueTemplate?.message}
            >
              <input
                aria-label="OAuth header value template"
                {...form.register('oauthHeaderValueTemplate')}
                placeholder="Bearer {token}"
                className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
            </Field>
          </div>

          {selectedProvider !== null && (
            <p className="text-xs text-muted-foreground">
              Scopes:{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {selectedProvider.scopes.join(' ')}
              </code>
            </p>
          )}

          {existingServerName !== null && oauthProviderId !== undefined && oauthProviderId !== '' && (
            <OAuthConnectionStatus
              agentId={agentId}
              serverName={existingServerName}
              provider={oauthProviderId}
              namespace={namespace}
            />
          )}

          {existingServerName === null && (
            <p className="text-xs text-muted-foreground">
              Save the binding first, then you can connect the account.
            </p>
          )}
        </div>
      )}

      <AllowedToolsSection
        fields={allowedArray.fields}
        onAdd={() => allowedArray.append({ value: '' })}
        onRemove={(index) => allowedArray.remove(index)}
        registerInput={(index) => form.register(`allowedTools.${index}.value` as const)}
      />

      <FormFooter
        submitError={submitError}
        onCancel={onCancel}
        submitting={form.formState.isSubmitting}
        submitLabel={submitLabel}
      />
    </form>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

/** Transport-agnostic allowed-tools editor. Takes pre-resolved field array
 *  state + a register callback so the caller's specific RHF value type stays
 *  generic at this boundary. */
function AllowedToolsSection({
  fields,
  onAdd,
  onRemove,
  registerInput,
}: {
  fields: { id: string }[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  registerInput: (index: number) => ReturnType<ReturnType<typeof useForm>['register']>;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Allowed tools</span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add tool
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional. When empty, the agent may call any tool exposed by the server. When set, steps may
        additionally narrow via <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">denyTools</code>.
      </p>
      {fields.length === 0 && <p className="text-xs text-muted-foreground">No allowlist.</p>}
      {fields.map((field, index) => (
        <div key={field.id} className="flex items-center gap-2">
          <input
            aria-label={`Allowed tool ${index + 1}`}
            {...registerInput(index)}
            placeholder="query"
            className="flex-1 rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            aria-label={`Remove allowed tool ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function FormFooter({
  submitError,
  onCancel,
  submitting,
  submitLabel,
}: {
  submitError: string | null;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <>
      {submitError !== null && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error !== undefined && error !== null && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}
