'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Info } from 'lucide-react';
import type { AgentMcpBinding, ToolCatalogEntry } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { routes } from '@/lib/routes';
import { InstantTooltip } from '@/components/ui/instant-tooltip';

function deriveBindingName(catalogId: string, existingNames: string[]): string {
  const base = catalogId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'mcp';
  let candidate = base;
  for (let suffix = 2; existingNames.includes(candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

const BindingFormSchema = z.object({
  catalogId: z.string().min(1, 'Choose an MCP server'),
  allowedTools: z.array(z.string()),
});
type BindingFormValues = z.infer<typeof BindingFormSchema>;

interface AgentMcpBindingFormProps {
  existing: { name: string; binding: AgentMcpBinding } | null;
  existingNames: string[];
  catalogEntries: ToolCatalogEntry[];
  namespace: string;
  onSubmit: (name: string, binding: AgentMcpBinding) => Promise<void>;
  onCancel: () => void;
}

function discoveryFor(entry: ToolCatalogEntry | undefined, namespace: string): ToolDiscovery {
  if (entry === undefined) return { unavailableReason: 'Choose an MCP server first.' };
  if (entry.type === 'stdio') {
    return { unavailableReason: 'Tool discovery is not available for stdio servers. Enter tool names manually.' };
  }
  if (entry.auth !== undefined) {
    return { unavailableReason: 'Tool discovery is only available for servers without authentication.' };
  }
  return {
    run: async () => (await mediforce.toolCatalog.discoverTools({ namespace, type: 'http', url: entry.url })).tools,
  };
}

/** Binds one MCP server from the workspace catalog to an agent. The agent can
 *  only pick a server that already exists there — servers are added on the MCP
 *  page — and can narrow its tools with an allowlist. */
export function AgentMcpBindingForm({
  existing,
  existingNames,
  catalogEntries,
  namespace,
  onSubmit,
  onCancel,
}: AgentMcpBindingFormProps) {
  const isEdit = existing !== null;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<BindingFormValues>({
    resolver: zodResolver(BindingFormSchema),
    defaultValues: {
      catalogId: existing?.binding.catalogId ?? '',
      allowedTools: existing?.binding.allowedTools ?? [],
    },
  });
  const catalogId = form.watch('catalogId');
  const selected = catalogEntries.find((entry) => entry.id === catalogId);

  const handleSubmit = form.handleSubmit(async (values) => {
    const entry = catalogEntries.find((candidate) => candidate.id === values.catalogId);
    if (entry === undefined) return;
    const binding: AgentMcpBinding = {
      type: entry.type,
      catalogId: entry.id,
      ...(values.allowedTools.length > 0 ? { allowedTools: values.allowedTools } : {}),
    };
    setSubmitError(null);
    try {
      await onSubmit(existing?.name ?? deriveBindingName(entry.id, existingNames), binding);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed.');
      throw err;
    }
  });

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="MCP server" error={form.formState.errors.catalogId?.message}>
        <select
          aria-label="MCP server"
          {...form.register('catalogId')}
          className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select an MCP server…</option>
          {catalogEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id} ({entry.type === 'stdio' ? 'stdio' : 'HTTP'})
              {entry.description !== undefined ? ` — ${entry.description}` : ''}
            </option>
          ))}
        </select>
        {catalogEntries.length === 0 && (
          <span className="mt-1 text-xs text-muted-foreground">
            No MCP servers in this workspace yet. Add one on the{' '}
            <Link href={routes.mcp(namespace, { create: true })} className="underline">MCP page</Link>.
          </span>
        )}
      </Field>

      <AllowedToolsSection
        selected={form.watch('allowedTools')}
        onChange={(tools) => form.setValue('allowedTools', tools)}
        discoveryKey={catalogId}
        discover={discoveryFor(selected, namespace)}
      />

      <FormFooter
        submitError={submitError}
        onCancel={onCancel}
        submitting={form.formState.isSubmitting}
        submitLabel={isEdit ? 'Save' : 'Create binding'}
      />
    </form>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

interface DiscoveredTool {
  name: string;
  description?: string;
}

type ToolDiscovery =
  | { run: () => Promise<DiscoveredTool[]> }
  | { unavailableReason: string };

const ALLOWED_TOOLS_HELP =
  'Restrict which tools of this server the agent may call. By default every tool the server exposes is available. ' +
  'Select tools to allow only a subset; steps can narrow it further via denyTools.';

/** Transport-agnostic allowed-tools editor. An empty selection means "no
 *  restriction"; unchecking tools in the discovered list stores the remaining
 *  ones as the allowlist. `discoveryKey` resets the loaded list when the
 *  target server changes. */
function AllowedToolsSection({
  selected,
  onChange,
  discover,
  discoveryKey,
}: {
  selected: string[];
  onChange: (tools: string[]) => void;
  discover: ToolDiscovery;
  discoveryKey: string;
}) {
  const [tools, setTools] = useState<DiscoveredTool[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [manualText, setManualText] = useState(selected.join(', '));

  useEffect(() => {
    setTools(null);
    setDiscoverError(null);
  }, [discoveryKey]);

  async function handleSelectTools() {
    if (!('run' in discover)) return;
    setLoading(true);
    setDiscoverError(null);
    try {
      setTools(await discover.run());
    } catch (err: unknown) {
      setDiscoverError(err instanceof Error ? err.message : 'Failed to load tools.');
    } finally {
      setLoading(false);
    }
  }

  const discoveryUnavailable = 'unavailableReason' in discover;
  const unlisted = selected.filter((name) => tools?.some((tool) => tool.name === name) !== true);
  const rows: DiscoveredTool[] = [...(tools ?? []), ...unlisted.map((name) => ({ name }))];
  const checkedNames = selected.length === 0 ? rows.map((row) => row.name) : selected;

  function toggle(name: string, checked: boolean) {
    const next = rows
      .map((row) => row.name)
      .filter((rowName) => (rowName === name ? checked : checkedNames.includes(rowName)));
    onChange(next.length === rows.length ? [] : next);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          Allowed tools
          <InstantTooltip label={ALLOWED_TOOLS_HELP}>
            <button
              type="button"
              aria-label="About allowed tools"
              className="text-muted-foreground hover:text-foreground"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </InstantTooltip>
        </span>
        <InstantTooltip label={'unavailableReason' in discover ? discover.unavailableReason : undefined}>
          <span>
            <button
              type="button"
              onClick={handleSelectTools}
              disabled={loading || 'unavailableReason' in discover}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Select tools'}
            </button>
          </span>
        </InstantTooltip>
      </div>
      {(discoverError !== null || discoveryUnavailable) && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground" title={discoverError ?? undefined}>
            {discoverError !== null
              ? 'Unable to list the tools for this MCP server. Enter the tool names manually instead.'
              : 'Enter the allowed tool names manually.'}
          </p>
          <input
            aria-label="Allowed tool names"
            value={manualText}
            onChange={(event) => {
              setManualText(event.target.value);
              onChange(
                event.target.value
                  .split(',')
                  .map((name) => name.trim())
                  .filter((name) => name !== ''),
              );
            }}
            placeholder="Enter tool names manually, comma-separated"
            className="rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </div>
      )}
      {tools === null ? (
        <p className="text-xs text-muted-foreground">
          {selected.length === 0 ? 'All tools available' : `${String(selected.length)} allowed: ${selected.join(', ')}`}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {selected.length === 0
              ? 'All tools available'
              : `${String(selected.length)} of ${String(rows.length)} tools allowed`}
          </p>
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground">This server exposes no tools.</p>
          )}
          {rows.map((row) => {
            const isChecked = checkedNames.includes(row.name);
            return (
              <label key={row.name} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Allow tool ${row.name}`}
                  checked={isChecked}
                  disabled={isChecked && checkedNames.length === 1}
                  onChange={(event) => toggle(row.name, event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span className="flex flex-col">
                  <span className="font-mono">{row.name}</span>
                  {row.description !== undefined && (
                    <span className="text-xs text-muted-foreground">{row.description}</span>
                  )}
                </span>
              </label>
            );
          })}
        </>
      )}
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
