'use client';

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings,
  Check, Upload, X, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { AgentDefinition } from '@mediforce/platform-core';

// ── Brand logo SVG components ─────────────────────────────────────────────────

type LogoProps = { className?: string; style?: React.CSSProperties };

function AnthropicLogo({ className, style }: LogoProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.827 3.539h-3.653L3.539 20.462h3.576l1.404-3.884h7.002l1.403 3.884h3.576L13.827 3.539zm-4.269 10.023L12 6.646l2.442 6.916H9.558z" />
    </svg>
  );
}

function OpenAILogo({ className, style }: LogoProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 004.981 4.18a5.985 5.985 0 00-3.998 2.9 6.046 6.046 0 00.743 7.097 5.98 5.98 0 00.511 4.911 6.051 6.051 0 006.515 2.9A5.985 5.985 0 0013.26 24a6.056 6.056 0 005.772-4.206 5.99 5.99 0 003.997-2.9 6.056 6.056 0 00-.747-7.073zM13.26 22.43a4.476 4.476 0 01-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 00.392-.681v-6.737l2.02 1.168a.071.071 0 01.038.052v5.583a4.504 4.504 0 01-4.494 4.494zM3.6 18.304a4.47 4.47 0 01-.535-3.014l.142.085 4.783 2.759a.771.771 0 00.78 0l5.843-3.369v2.332a.08.08 0 01-.033.062L9.74 19.95a4.5 4.5 0 01-6.14-1.646zM2.34 7.896a4.485 4.485 0 012.366-1.973V11.6a.766.766 0 00.388.676l5.815 3.355-2.02 1.168a.076.076 0 01-.071 0L4.5 14.295A4.501 4.501 0 012.34 7.896zm16.597 3.855l-5.843-3.372 2.02-1.168a.076.076 0 01.072 0l4.717 2.724a4.498 4.498 0 01-.689 8.109v-5.677a.79.79 0 00-.277-.616zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 00-.786 0L9.409 9.23V6.897a.066.066 0 01.028-.061l4.713-2.72a4.498 4.498 0 016.678 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 01-.038-.057V6.075a4.5 4.5 0 017.375-3.453l-.142.08L8.704 5.46a.795.795 0 00-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

function GeminiLogo({ className, style }: LogoProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 24A14.304 14.304 0 000 12 14.304 14.304 0 0012 0a14.305 14.305 0 0012 12 14.305 14.305 0 00-12 12" />
    </svg>
  );
}

function GrokLogo({ className, style }: LogoProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MistralLogo({ className, style }: LogoProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="5.5" height="5.5" rx="0.5" />
      <rect x="9.25" y="2" width="5.5" height="5.5" rx="0.5" />
      <rect x="16.5" y="2" width="5.5" height="5.5" rx="0.5" />
      <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="0.5" />
      <rect x="16.5" y="9.25" width="5.5" height="5.5" rx="0.5" />
      <rect x="2" y="16.5" width="5.5" height="5.5" rx="0.5" />
      <rect x="16.5" y="16.5" width="5.5" height="5.5" rx="0.5" />
    </svg>
  );
}

function QwenLogo({ className, style }: LogoProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 2.136.67 4.116 1.81 5.74L2 22l4.432-1.77A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.952 7.952 0 01-4.017-1.08l-.29-.174-2.99 1.196.958-3.078-.19-.3A7.96 7.96 0 014 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8zm1-11h-2v4H7v2h4v2h2v-2h4v-2h-4z" />
    </svg>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

interface FoundationModel {
  id: string;
  name: string;
  provider: string;
  Logo: React.ComponentType<LogoProps>;
  logoColor: string;
}

const FOUNDATION_MODELS: FoundationModel[] = [
  { id: 'claude-opus-4.6',    name: 'Claude Opus 4.6',    provider: 'Anthropic', Logo: AnthropicLogo, logoColor: '#D97757' },
  { id: 'claude-sonnet-4.6',  name: 'Claude Sonnet 4.6',  provider: 'Anthropic', Logo: AnthropicLogo, logoColor: '#D97757' },
  { id: 'gpt-5.3',            name: 'OpenAI GPT-5.3',     provider: 'OpenAI',    Logo: OpenAILogo,    logoColor: '#10a37f' },
  { id: 'gemini-3.1-pro',     name: 'Gemini 3.1 Pro',     provider: 'Google',    Logo: GeminiLogo,    logoColor: '#4285F4' },
  { id: 'grok-4.20',          name: 'Grok 4.20',          provider: 'xAI',       Logo: GrokLogo,      logoColor: '#000000' },
  { id: 'mistral-large-3',    name: 'Mistral Large 3',    provider: 'Mistral',   Logo: MistralLogo,   logoColor: '#FF7000' },
  { id: 'qwen-3.5',           name: 'Alibaba Qwen 3.5',   provider: 'Alibaba',   Logo: QwenLogo,      logoColor: '#FF6A00' },
];

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
  const router = useRouter();
  const { id } = React.use(params);

  const [loadingDef, setLoadingDef] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('Bot');
  const [description, setDescription] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [skillFileNames, setSkillFileNames] = useState<string[]>([]);
  const [skillsDragOver, setSkillsDragOver] = useState(false);
  const [skillFiles, setSkillFiles] = useState<File[]>([]);
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
        setSelectedModelId(def.foundationModel);
        setSkillFileNames(def.skillFileNames);
        setPrompt(def.systemPrompt);
      })
      .finally(() => setLoadingDef(false));
  }, [id]);

  const activeModel = FOUNDATION_MODELS.find((m) => m.id === selectedModelId);
  const canSave = name.trim().length > 0 && selectedModelId !== '' && !saving;

  function addSkillFiles(incoming: FileList | File[]) {
    const newFiles = Array.from(incoming);
    setSkillFiles((prev) => [...prev, ...newFiles]);
    setSkillFileNames((prev) => [...prev, ...newFiles.map((f) => f.name)]);
  }

  function handleSkillDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setSkillsDragOver(false);
    if (event.dataTransfer.files.length > 0) addSkillFiles(event.dataTransfer.files);
  }

  function removeSkillFileName(index: number) {
    setSkillFileNames((prev) => prev.filter((_, i) => i !== index));
    setSkillFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        iconName: selectedIcon,
        description,
        foundationModel: selectedModelId,
        systemPrompt: prompt,
        skillFileNames: skillFileNames,
      };
      await fetch(`/api/agent-definitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      router.push('/agents');
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
          href="/agents"
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

          {/* 4. Foundation model */}
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

            {skillFileNames.length > 0 && (
              <ul className="space-y-1.5">
                {skillFileNames.map((fileName, index) => (
                  <li
                    key={`${fileName}-${index}`}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate text-foreground/80">{fileName}</span>
                    <button
                      type="button"
                      onClick={() => removeSkillFileName(index)}
                      className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={`Remove ${fileName}`}
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
