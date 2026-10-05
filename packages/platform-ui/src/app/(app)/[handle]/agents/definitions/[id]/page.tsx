'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { ModelPicker } from '@/components/workflows/workflow-editor/model-picker';
import { cn } from '@/lib/utils';
import type { AgentDefinition } from '@mediforce/platform-core';
import { AgentMcpSection } from '@/components/agents/agent-mcp-section';
import { AGENT_ICON_OPTIONS, RecognitionLabel } from '@/components/agents/agent-form-parts';
import { ConceptIntro } from '@/components/ui/concept-intro';

// ── Loading skeleton ──────────────────────────────────────────────────────────

function FormSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-9 w-full rounded-md bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { handle } = useParams<{ handle: string }>();
  const router = useRouter();
  const { id } = React.use(params);

  const [loadingDef, setLoadingDef] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('Bot');
  const [description, setDescription] = useState('');
  const [inputDescription, setInputDescription] = useState('');
  const [outputDescription, setOutputDescription] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/api/agents/${id}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.json() as Promise<{ agent: AgentDefinition }>;
      })
      .then((data) => {
        if (!data) return;
        const def = data.agent;
        setName(def.name);
        setSelectedIcon(def.iconName);
        setDescription(def.description);
        setInputDescription(def.inputDescription);
        setOutputDescription(def.outputDescription);
        setSelectedModelId(def.foundationModel);
        setPrompt(def.systemPrompt);
        setVisibility(def.visibility ?? 'private');
      })
      .finally(() => setLoadingDef(false));
  }, [id]);

  const canSave = name.trim().length > 0 && selectedModelId !== '' && !saving;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        iconName: selectedIcon,
        description,
        inputDescription,
        outputDescription,
        foundationModel: selectedModelId,
        systemPrompt: prompt,
        visibility,
      };
      const res = await apiFetch(`/api/agents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      router.push(`/${handle}/agents`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not save the agent: ${err.message}`
          : 'Could not save the agent.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 max-w-2xl">
      <ConceptIntro>
        <p>
          <strong>An agent is a reusable configuration workflow steps call by id</strong> — its system prompt, its
          foundation model and its MCP server bindings are the parts a run consumes. Agents are not versioned, so a change here applies to
          every step that already references this one.
        </p>
      </ConceptIntro>

      {loadingDef ? (
        <FormSkeleton />
      ) : notFound ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Agent definition not found.
        </div>
      ) : (
        <div className="space-y-6">

          {/* 1. Agent name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Agent name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Risk Analysis Agent"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* 2. Icon picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Icon</label>
            <div className="flex flex-wrap gap-2">
              {AGENT_ICON_OPTIONS.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedIcon(label)}
                  title={label}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
                    selectedIcon === label
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* 3. Description */}
          <div className="space-y-1.5">
            <RecognitionLabel>Description (optional)</RecognitionLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this agent does and when to use it."
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* 4. Visibility */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Visibility</label>
            <div className="flex gap-2">
              {(['private', 'public'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
                    visibility === v
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'hover:border-primary/50',
                  )}
                >
                  {v === 'private' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {v === 'private' ? 'Private' : 'Public'}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {visibility === 'private'
                ? 'Only members of this namespace can see this agent.'
                : 'This agent is visible to everyone.'}
            </p>
          </div>

          {/* 5. Input / Output descriptions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <RecognitionLabel>Input (optional)</RecognitionLabel>
              <input
                type="text"
                value={inputDescription}
                onChange={(e) => setInputDescription(e.target.value)}
                placeholder="e.g. Vendor submission data"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <RecognitionLabel>Output (optional)</RecognitionLabel>
              <input
                type="text"
                value={outputDescription}
                onChange={(e) => setOutputDescription(e.target.value)}
                placeholder="e.g. Risk assessment report"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* 6. Foundation model */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Foundation model</label>
            <ModelPicker
              ariaLabel="Foundation model"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedModelId === '' ? undefined : selectedModelId}
              onChange={(model) => setSelectedModelId(model ?? '')}
            />
            <p className="text-xs text-muted-foreground">
              Used by every workflow step that calls this agent, unless the step sets its own model.
            </p>
          </div>

          {/* 7. System prompt */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">System prompt (optional)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Optional custom system prompt to guide this agent's behavior and constraints."
              rows={5}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono"
            />
          </div>

          {/* MCP Servers — bindings persisted separately via /mcp-servers endpoints */}
          <AgentMcpSection agentId={id} handle={handle} />

          {/* 8. Save */}
          <div className="flex flex-col items-start gap-1.5 pt-2 pb-6">
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                !canSave && 'opacity-50 cursor-not-allowed',
              )}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {error !== null && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
