'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { WorkflowStep, McpServerConfig } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { FieldRow, FieldGroup, Section, inputBase, inputBaseMono, selectBase, textareaBase } from './step-editor-fields';

const VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

const ri = inputBase;
const riMono = inputBaseMono;
const rs = selectBase;
const rt = textareaBase;

const TIP = {
  model:              'LLM model for the cowork session. For voice, use a realtime-capable model (e.g. gpt-4o-realtime-preview).',
  voice:              'Voice used for text-to-speech in voice sessions (alloy, echo, fable, onyx, nova, shimmer).',
  synthesisModel:     'Model used to synthesise spoken responses. Can differ from the main reasoning model.',
  maxDuration:        'Maximum session duration in seconds. The session auto-ends when this limit is reached.',
  idleTimeout:        'Seconds of silence before the session auto-ends. Prevents orphaned open sessions.',
  systemPrompt:       'Instructions for the AI collaborator in the shared workspace. Sets its goal and behaviour for this step.',
  outputSchema:       'JSON Schema describing the structured artifact both parties are working toward. Guides the AI\'s output format.',
  mcpName:            'Unique identifier for this MCP server binding.',
  mcpCommand:         'Command to launch the MCP server process (stdio transport).',
  mcpUrl:             'URL of the MCP server (HTTP/SSE transport).',
  mcpAllowedTools:    'Tools the agent may use from this server, comma-separated. Leave empty to allow all tools.',
};

export function CoworkSection({
  step,
  onChange,
  isNewStep,
}: {
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
  isNewStep: boolean;
}) {
  const cowork = step.cowork ?? { agent: 'chat' as const };
  const isVoice = cowork.agent === 'voice-realtime';

  const patchCowork = (patch: Partial<NonNullable<WorkflowStep['cowork']>>) =>
    onChange({ cowork: { ...cowork, ...patch } });

  return (
    <Section title="Cowork">
      {isNewStep && (
        <div className="rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-3 mb-3 space-y-1.5">
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">What is a Cowork step?</p>
          <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 leading-relaxed">
            A Cowork step opens a shared workspace where a human and an AI agent collaborate to produce a structured
            artifact — a document, decision, or dataset — before the workflow can continue.
          </p>
          <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 leading-relaxed">
            Choose <strong>Chat</strong> for a text conversation with Claude, or <strong>Voice</strong> for a spoken
            session with a real-time voice model. The artifact schema defines the structured output both sides are
            working toward.
          </p>
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-muted mb-3">
        {(['chat', 'voice-realtime'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => patchCowork({
              agent: mode,
              chat: mode === 'chat' ? (cowork.chat ?? {}) : undefined,
              voiceRealtime: mode === 'voice-realtime' ? (cowork.voiceRealtime ?? {}) : undefined,
            })}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-all',
              cowork.agent === mode
                ? 'bg-teal-500 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mode === 'chat' ? 'Chat' : 'Voice'}
          </button>
        ))}
      </div>

      {/* Fields */}
      <FieldGroup>
        <FieldRow label={isVoice ? 'voiceRealtime.model' : 'chat.model'} tooltip={TIP.model}>
          <input
            value={isVoice ? (cowork.voiceRealtime?.model ?? '') : (cowork.chat?.model ?? '')}
            onChange={(e) => isVoice
              ? patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, model: e.target.value || undefined } })
              : patchCowork({ chat: { ...cowork.chat, model: e.target.value || undefined } })
            }
            className={ri}
          />
        </FieldRow>

        {isVoice && (
          <>
            <FieldRow label="voiceRealtime.voice" tooltip={TIP.voice}>
              <select
                value={cowork.voiceRealtime?.voice ?? ''}
                onChange={(e) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, voice: e.target.value || undefined } })}
                className={rs}
              >
                <option value="">Default</option>
                {VOICE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </FieldRow>

            <FieldRow label="voiceRealtime.synthesisModel" tooltip={TIP.synthesisModel}>
              <input
                value={cowork.voiceRealtime?.synthesisModel ?? ''}
                onChange={(e) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, synthesisModel: e.target.value || undefined } })}
                className={ri}
              />
            </FieldRow>

            <FieldRow label="voiceRealtime.maxDurationSeconds" tooltip={TIP.maxDuration}>
              <input
                type="number"
                value={cowork.voiceRealtime?.maxDurationSeconds ?? ''}
                onChange={(e) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, maxDurationSeconds: e.target.value ? Number(e.target.value) : undefined } })}
                className={ri}
              />
            </FieldRow>

            <FieldRow label="voiceRealtime.idleTimeoutSeconds" tooltip={TIP.idleTimeout}>
              <input
                type="number"
                value={cowork.voiceRealtime?.idleTimeoutSeconds ?? ''}
                onChange={(e) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, idleTimeoutSeconds: e.target.value ? Number(e.target.value) : undefined } })}
                className={ri}
              />
            </FieldRow>
          </>
        )}

        <FieldRow label="cowork.systemPrompt" tooltip={TIP.systemPrompt} alignStart>
          <textarea
            value={cowork.systemPrompt ?? ''}
            onChange={(e) => patchCowork({ systemPrompt: e.target.value || undefined })}
            rows={4}
            placeholder="Instructions for the AI collaborator…"
            className={cn(rt, 'placeholder:italic placeholder:text-muted-foreground/40')}
          />
        </FieldRow>

        <FieldRow label="cowork.outputSchema" tooltip={TIP.outputSchema} alignStart>
          <CoworkOutputSchemaEditor
            value={cowork.outputSchema}
            onChange={(schema) => patchCowork({ outputSchema: schema })}
          />
        </FieldRow>
      </FieldGroup>

      {/* MCP Servers */}
      <McpServersEditor
        servers={cowork.mcpServers ?? []}
        onChange={(servers) => patchCowork({ mcpServers: servers.length > 0 ? servers : undefined })}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// MCP Servers editor
// ---------------------------------------------------------------------------

function McpServersEditor({
  servers,
  onChange,
}: {
  servers: McpServerConfig[];
  onChange: (servers: McpServerConfig[]) => void;
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">MCP Servers</p>
        <button
          onClick={() => onChange([...servers, { name: '', command: undefined, args: [] }])}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Add
        </button>
      </div>

      {servers.length === 0 && (
        <p className="text-[11px] text-muted-foreground/50 italic">No MCP servers configured.</p>
      )}

      <div className="space-y-2">
        {servers.map((server, index) => (
          <McpServerEntry
            key={index}
            server={server}
            onChange={(patch) => onChange(servers.map((s, i) => (i === index ? { ...s, ...patch } : s)))}
            onRemove={() => onChange(servers.filter((_, i) => i !== index))}
          />
        ))}
      </div>
    </div>
  );
}

function McpServerEntry({
  server,
  onChange,
  onRemove,
}: {
  server: McpServerConfig;
  onChange: (patch: Partial<McpServerConfig>) => void;
  onRemove: () => void;
}) {
  const [transportMode, setTransportMode] = useState<'command' | 'url'>(
    server.url !== undefined ? 'url' : 'command',
  );

  const toggleTransport = () => {
    if (transportMode === 'command') {
      setTransportMode('url');
      onChange({ command: undefined });
    } else {
      setTransportMode('command');
      onChange({ url: undefined });
    }
  };

  return (
    <FieldGroup>
      <FieldRow label="name" tooltip={TIP.mcpName}>
        <div className="flex items-center gap-2">
          <input
            value={server.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="server-name"
            className={cn(riMono, 'flex-1')}
          />
          <button
            onClick={toggleTransport}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors border border-border/60 rounded px-1.5 py-0.5 shrink-0"
            title={`Switch to ${transportMode === 'command' ? 'URL' : 'command'} transport`}
          >
            {transportMode === 'command' ? 'stdio' : 'http'}
          </button>
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </FieldRow>

      {transportMode === 'command' ? (
        <FieldRow label="command" tooltip={TIP.mcpCommand}>
          <input
            value={server.command ?? ''}
            onChange={(e) => onChange({ command: e.target.value || undefined })}
            placeholder="e.g. tealflow-mcp"
            className={riMono}
          />
        </FieldRow>
      ) : (
        <FieldRow label="url" tooltip={TIP.mcpUrl}>
          <input
            value={server.url ?? ''}
            onChange={(e) => onChange({ url: e.target.value || undefined })}
            placeholder="localhost:8080/mcp"
            className={riMono}
          />
        </FieldRow>
      )}

      <FieldRow label="allowedTools" tooltip={TIP.mcpAllowedTools}>
        <input
          value={server.allowedTools?.join(', ') ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({ allowedTools: raw.trim() === '' ? undefined : raw.split(',').map((t) => t.trim()).filter(Boolean) });
          }}
          className={ri}
        />
      </FieldRow>
    </FieldGroup>
  );
}

// ---------------------------------------------------------------------------
// Output schema editor
// ---------------------------------------------------------------------------

function CoworkOutputSchemaEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (schema: Record<string, unknown> | undefined) => void;
}) {
  const [draft, setDraft] = useState(() => value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  const valueRef = useRef(value);
  useEffect(() => {
    if (value !== valueRef.current) {
      valueRef.current = value;
      setDraft(value !== undefined ? JSON.stringify(value, null, 2) : '');
      setError(null);
    }
  }, [value]);

  const handleBlur = () => {
    if (draft.trim() === '') { onChange(undefined); setError(null); return; }
    try { onChange(JSON.parse(draft)); setError(null); }
    catch { setError('Invalid JSON'); }
  };

  return (
    <div className="w-full">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        rows={5}
        placeholder={'{\n  "type": "object",\n  "required": [],\n  "properties": {}\n}'}
        className={cn(
          rt, 'font-mono text-[11px]',
          error ? 'border-destructive ring-1 ring-destructive' : '',
        )}
      />
      {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
    </div>
  );
}
