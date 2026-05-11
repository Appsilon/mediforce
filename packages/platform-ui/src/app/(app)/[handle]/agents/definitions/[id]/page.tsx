'use client';

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings,
  Check, Plus, X, ChevronDown, Eye, EyeOff,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { FOUNDATION_MODELS } from '@/lib/agent-models';
import { listSkillRegistries } from '@/lib/skill-registries-client';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { AgentDefinition, AgentSkillRef, SkillRegistry } from '@mediforce/platform-core';
import { AgentMcpSection } from '@/components/agents/agent-mcp-section';

const ICON_OPTIONS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Bot,      label: 'Bot'      },
  { icon: Cpu,      label: 'CPU'      },
  { icon: Terminal, label: 'Terminal' },
  { icon: BarChart3,label: 'Chart'    },
  { icon: Brain,    label: 'Brain'    },
  { icon: Zap,      label: 'Zap'      },
  { icon: Shield,   label: 'Shield'   },
  { icon: Code,     label: 'Code'     },
  { icon: Database, label: 'Database' },
  { icon: Globe,    label: 'Globe'    },
  { icon: Sparkles, label: 'Sparkles' },
  { icon: Settings, label: 'Settings' },
];

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
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [skillRows, setSkillRows] = useState<AgentSkillRef[]>([]);
  const [registries, setRegistries] = useState<SkillRegistry[]>([]);
  const [registriesError, setRegistriesError] = useState<string | null>(null);
  const [skillRowErrors, setSkillRowErrors] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch(`/api/agent-definitions/${id}`)
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
        setSkillRows(def.skills);
        setPrompt(def.systemPrompt);
        setVisibility(def.visibility ?? 'private');
      })
      .finally(() => setLoadingDef(false));
  }, [id]);

  useEffect(() => {
    listSkillRegistries()
      .then((all) => {
        setRegistries(all.filter((registry) => registry.namespace === handle));
      })
      .catch((err: unknown) => {
        setRegistriesError(err instanceof Error ? err.message : 'Failed to load skill registries.');
      });
  }, [handle]);

  const activeModel = FOUNDATION_MODELS.find((m) => m.id === selectedModelId);
  const canSave = name.trim().length > 0 && selectedModelId !== '' && !saving;

  function addSkillRow() {
    setSkillRows((prev) => [...prev, { registryId: '', name: '' }]);
  }

  function updateSkillRow(index: number, patch: Partial<AgentSkillRef>) {
    setSkillRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeSkillRow(index: number) {
    setSkillRows((prev) => prev.filter((_, i) => i !== index));
  }

  function validateSkillRows(): string[] {
    const errors: string[] = [];
    skillRows.forEach((row, i) => {
      if (row.registryId.trim() === '') {
        errors.push(`Skill ${i + 1}: select a registry.`);
      }
      if (row.name.trim() === '') {
        errors.push(`Skill ${i + 1}: enter a skill name.`);
      }
    });
    return errors;
  }

  async function handleSave() {
    setSaveError(null);
    const errors = validateSkillRows();
    setSkillRowErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        iconName: selectedIcon,
        description,
        inputDescription,
        outputDescription,
        foundationModel: selectedModelId,
        systemPrompt: prompt,
        skills: skillRows.map((row) => ({
          registryId: row.registryId.trim(),
          name: row.name.trim(),
        })),
        visibility,
      };
      const res = await apiFetch(`/api/agent-definitions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed with status ${res.status}`);
      }
      router.push(`/${handle}/agents`);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!modelDropdownOpen) return;
    function handleClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setModelDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modelDropdownOpen]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 max-w-2xl">
      <div>
        <p className="text-sm text-muted-foreground">
          Edit this AI agent&apos;s configuration and capabilities.
        </p>
      </div>

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
              {ICON_OPTIONS.map(({ icon: Icon, label }) => (
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
            <label className="text-sm font-medium">Description</label>
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
              <label className="text-sm font-medium">Input</label>
              <input
                type="text"
                value={inputDescription}
                onChange={(e) => setInputDescription(e.target.value)}
                placeholder="e.g. Vendor submission data"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Output</label>
              <input
                type="text"
                value={outputDescription}
                onChange={(e) => setOutputDescription(e.target.value)}
                placeholder="e.g. Risk assessment report"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* 5. Foundation model */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Foundation model</label>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setModelDropdownOpen((prev) => !prev)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm transition-colors',
                  'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring',
                  modelDropdownOpen && 'ring-2 ring-ring border-ring',
                )}
              >
                {activeModel ? (
                  <span className="flex items-center gap-2">
                    <activeModel.Logo className="h-4 w-4 shrink-0" style={{ color: activeModel.logoColor }} />
                    <span>{activeModel.name}</span>
                    <span className="text-muted-foreground text-xs">— {activeModel.provider}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Select a model…</span>
                )}
                <ChevronDown
                  className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', modelDropdownOpen && 'rotate-180')}
                />
              </button>

              {modelDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md py-1">
                  {FOUNDATION_MODELS.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => { setSelectedModelId(model.id); setModelDropdownOpen(false); }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                        selectedModelId === model.id && 'bg-accent',
                      )}
                    >
                      <model.Logo className="h-4 w-4 shrink-0" style={{ color: model.logoColor }} />
                      <span className="flex-1">{model.name}</span>
                      <span className="text-xs text-muted-foreground">{model.provider}</span>
                      {selectedModelId === model.id && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 5. Skills — registry-backed */}
          <div className="space-y-2">
            <div>
              <label className="text-sm font-medium">Skills</label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bind skills from workspace skill registries. Each row picks a registry and names a skill folder
                within it.
              </p>
            </div>

            {registriesError !== null && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {registriesError}
              </div>
            )}

            {skillRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No skills bound yet.</p>
            ) : (
              <ul className="space-y-2">
                {skillRows.map((row, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <select
                      value={row.registryId}
                      onChange={(e) => updateSkillRow(index, { registryId: e.target.value })}
                      className="w-1/2 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label={`Skill ${index + 1} registry`}
                    >
                      <option value="">Select registry…</option>
                      {registries.map((registry) => (
                        <option key={registry.id} value={registry.id}>
                          {registry.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateSkillRow(index, { name: e.target.value })}
                      placeholder="skill-folder-name"
                      aria-label={`Skill ${index + 1} name`}
                      className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => removeSkillRow(index)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      aria-label={`Remove skill ${index + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={addSkillRow}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add skill
            </button>

            {skillRowErrors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                {skillRowErrors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">{err}</p>
                ))}
              </div>
            )}
          </div>

          {/* MCP Servers — bindings persisted separately via /mcp-servers endpoints */}
          <AgentMcpSection agentId={id} handle={handle} />

          {/* 6. System prompt */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">System prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Optional custom system prompt to guide this agent's behavior and constraints."
              rows={5}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono"
            />
          </div>

          {/* 7. Save */}
          <div className="flex flex-col items-start gap-1.5 pt-2 pb-6">
            {saveError !== null && (
              <div className="w-full rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {saveError}
              </div>
            )}
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
          </div>

        </div>
      )}
    </div>
  );
}
