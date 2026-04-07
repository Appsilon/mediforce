'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { WorkflowStep } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { EditableField, Section } from './step-editor-fields';

const VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

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

  const selectInline = 'bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors cursor-pointer';

  return (
    <Section title="Cowork">
      {isNewStep && (
        <div className="rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-3 mb-3 space-y-1.5">
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">What is a Cowork step?</p>
          <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 leading-relaxed">
            A Cowork step opens a shared workspace where a human and an AI agent collaborate to produce a structured artifact — a document, decision, or dataset — before the workflow can continue.
          </p>
          <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 leading-relaxed">
            Choose <strong>Chat</strong> for a text conversation with Claude, or <strong>Voice</strong> for a spoken session with a real-time voice model. The artifact schema defines the structured output both sides are working toward.
          </p>
        </div>
      )}

      {/* Agent mode toggle */}
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

      <div className="space-y-1.5">
        {/* Model */}
        <EditableField
          label="Model"
          value={isVoice ? (cowork.voiceRealtime?.model ?? '') : (cowork.chat?.model ?? '')}
          placeholder={isVoice ? 'gpt-4o-realtime-preview' : 'anthropic/claude-sonnet-4'}
          onChange={(v) => isVoice
            ? patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, model: v || undefined } })
            : patchCowork({ chat: { ...cowork.chat, model: v || undefined } })
          }
        />

        {/* Voice-specific fields */}
        {isVoice && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground shrink-0">Voice</span>
              <select
                value={cowork.voiceRealtime?.voice ?? ''}
                onChange={(e) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, voice: e.target.value || undefined } })}
                className={selectInline}
              >
                <option value="">Default</option>
                {VOICE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <EditableField
              label="Synthesis model"
              value={cowork.voiceRealtime?.synthesisModel ?? ''}
              placeholder="e.g. claude-sonnet-4"
              onChange={(v) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, synthesisModel: v || undefined } })}
            />
            <EditableField
              label="Max duration"
              value={cowork.voiceRealtime?.maxDurationSeconds !== undefined ? String(cowork.voiceRealtime.maxDurationSeconds) : ''}
              placeholder="600"
              suffix="sec"
              onChange={(v) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, maxDurationSeconds: v ? Number(v) : undefined } })}
            />
            <EditableField
              label="Idle timeout"
              value={cowork.voiceRealtime?.idleTimeoutSeconds !== undefined ? String(cowork.voiceRealtime.idleTimeoutSeconds) : ''}
              placeholder="30"
              suffix="sec"
              onChange={(v) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, idleTimeoutSeconds: v ? Number(v) : undefined } })}
            />
          </>
        )}
      </div>

      {/* System prompt */}
      <div className="mt-3">
        <p className="text-[11px] text-muted-foreground mb-1">System prompt</p>
        <textarea
          value={cowork.systemPrompt ?? ''}
          onChange={(e) => patchCowork({ systemPrompt: e.target.value || undefined })}
          rows={4}
          placeholder="Instructions for the AI collaborator…"
          className="w-full text-xs bg-muted/50 rounded-md p-2.5 leading-relaxed border-0 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
        />
      </div>

      {/* Output schema */}
      <div className="mt-2">
        <p className="text-[11px] text-muted-foreground mb-1">Output schema <span className="opacity-60">(JSON)</span></p>
        <CoworkOutputSchemaEditor
          value={cowork.outputSchema}
          onChange={(schema) => patchCowork({ outputSchema: schema })}
        />
      </div>
    </Section>
  );
}

function CoworkOutputSchemaEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (schema: Record<string, unknown> | undefined) => void;
}) {
  const [draft, setDraft] = useState(() => value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  // Keep draft in sync when value changes externally (e.g. YAML apply)
  const valueRef = useRef(value);
  useEffect(() => {
    if (value !== valueRef.current) {
      valueRef.current = value;
      setDraft(value !== undefined ? JSON.stringify(value, null, 2) : '');
      setError(null);
    }
  }, [value]);

  const handleBlur = () => {
    if (draft.trim() === '') {
      onChange(undefined);
      setError(null);
      return;
    }
    try {
      onChange(JSON.parse(draft));
      setError(null);
    } catch {
      setError('Invalid JSON');
    }
  };

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        rows={5}
        placeholder={'{\n  "type": "object",\n  "required": [],\n  "properties": {}\n}'}
        className={cn(
          'w-full text-xs font-mono bg-muted/50 rounded-md p-2.5 leading-relaxed border-0 focus:outline-none focus:ring-1 resize-y',
          error ? 'ring-1 ring-destructive' : 'focus:ring-primary',
        )}
      />
      {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
    </div>
  );
}
