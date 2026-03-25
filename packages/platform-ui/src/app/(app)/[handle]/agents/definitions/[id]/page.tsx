'use client';

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings,
  Check, Upload, X, ChevronDown,
} from 'lucide-react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { FOUNDATION_MODELS } from '@/lib/agent-models';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { AgentDefinition } from '@mediforce/platform-core';

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
  const [existingSkillPaths, setExistingSkillPaths] = useState<string[]>([]);
  const [newSkillFiles, setNewSkillFiles] = useState<File[]>([]);
  const [skillsDragOver, setSkillsDragOver] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/agent-definitions/${id}`)
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
        setExistingSkillPaths(def.skillFileNames);
        setPrompt(def.systemPrompt);
      })
      .finally(() => setLoadingDef(false));
  }, [id]);

  const activeModel = FOUNDATION_MODELS.find((m) => m.id === selectedModelId);
  const canSave = name.trim().length > 0 && selectedModelId !== '' && !saving;

  function addSkillFiles(incoming: FileList | File[]) {
    const files = Array.from(incoming);
    setNewSkillFiles((prev) => [...prev, ...files]);
  }

  function handleSkillDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setSkillsDragOver(false);
    if (event.dataTransfer.files.length > 0) addSkillFiles(event.dataTransfer.files);
  }

  function removeSkillEntry(index: number) {
    if (index < existingSkillPaths.length) {
      setExistingSkillPaths((prev) => prev.filter((_, i) => i !== index));
    } else {
      const newIdx = index - existingSkillPaths.length;
      setNewSkillFiles((prev) => prev.filter((_, i) => i !== newIdx));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      let uploadedPaths: string[] = [];
      if (newSkillFiles.length > 0) {
        uploadedPaths = await Promise.all(
          newSkillFiles.map(async (file) => {
            const storagePath = `agentSkills/${id}/${file.name}`;
            await uploadBytes(ref(storage, storagePath), file, {
              contentType: file.type || 'application/octet-stream',
            });
            return storagePath;
          }),
        );
      }

      const payload = {
        name: name.trim(),
        iconName: selectedIcon,
        description,
        inputDescription,
        outputDescription,
        foundationModel: selectedModelId,
        systemPrompt: prompt,
        skillFileNames: [...existingSkillPaths, ...uploadedPaths],
      };
      await fetch(`/api/agent-definitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      router.push(`/${handle}/agents`);
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
      {/* Back link + title */}
      <div>
        <Link
          href={`/${handle}/agents`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Agents
        </Link>
        <h1 className="text-xl font-headline font-semibold">Configure Agent</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
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

          {/* 4. Input / Output descriptions */}
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

          {/* 5. Skills file upload */}
          <div className="space-y-2">
            <div>
              <label className="text-sm font-medium">Skills</label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload skill definition files (.yaml, .json, .md) that extend agent capabilities.
              </p>
            </div>

            <div
              onDrop={handleSkillDrop}
              onDragOver={(e) => { e.preventDefault(); setSkillsDragOver(true); }}
              onDragLeave={() => setSkillsDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors',
                skillsDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50',
              )}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Drop files here or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".yaml,.yml,.json,.md,.txt"
                onChange={(e) => {
                  if (e.target.files) { addSkillFiles(e.target.files); e.target.value = ''; }
                }}
                className="hidden"
              />
            </div>

            {(existingSkillPaths.length > 0 || newSkillFiles.length > 0) && (
              <ul className="space-y-1.5">
                {[
                  ...existingSkillPaths.map((p) => p.split('/').pop() ?? p),
                  ...newSkillFiles.map((f) => f.name),
                ].map((displayName, index) => (
                  <li
                    key={`${displayName}-${index}`}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate text-foreground/80">{displayName}</span>
                    <button
                      type="button"
                      onClick={() => removeSkillEntry(index)}
                      className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={`Remove ${displayName}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

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
