'use client';

import * as React from 'react';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings,
  Check, Upload, X, ChevronDown,
} from 'lucide-react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

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

function DeepSeekLogo({ className, style }: LogoProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.908 11.43c-.171-.088-.343-.022-.487.088-.057.044-.11.09-.163.137a5.08 5.08 0 01-.125.11c-.38.309-.793.42-1.278.302-.701-.17-1.172-.63-1.562-1.196-.38-.551-.638-1.17-.891-1.786-.087-.214-.175-.427-.268-.637a6.607 6.607 0 00-1.03-1.73c-.639-.794-1.437-1.342-2.46-1.508a4.436 4.436 0 00-.657-.057c-.11 0-.219.004-.328.013-.048.004-.097.01-.145.018a4.26 4.26 0 00-.572.127 4.35 4.35 0 00-1.018.47c-.04.026-.08.053-.119.08a4.418 4.418 0 00-.85.793 4.466 4.466 0 00-.655 1.141 4.438 4.438 0 00-.223.876c-.013.088-.022.177-.028.266v.054c-.004.063-.006.126-.006.189 0 .095.004.19.013.284.009.092.022.184.04.274a4.463 4.463 0 00.397 1.184c.104.212.225.415.361.607a4.47 4.47 0 001.103.993c.204.129.42.24.645.33.225.09.457.158.695.202.118.022.237.038.356.046.12.009.239.011.358.009.12-.003.239-.011.357-.024a4.43 4.43 0 001.342-.432c.209-.107.409-.231.598-.37.19-.14.368-.295.534-.463.165-.168.317-.35.453-.542.136-.193.257-.395.361-.606a4.48 4.48 0 00.397-1.185c.018-.09.031-.182.04-.274.009-.094.013-.189.013-.284 0-.063-.002-.126-.006-.189v-.054a4.37 4.37 0 00-.028-.266 4.463 4.463 0 00-.223-.876 4.465 4.465 0 00-.655-1.14 4.419 4.419 0 00-.85-.794c-.04-.027-.08-.054-.119-.08a4.35 4.35 0 00-1.018-.47 4.26 4.26 0 00-.572-.127c-.048-.008-.097-.014-.145-.018a4.39 4.39 0 00-.328-.013c-.219 0-.439.019-.657.057-1.023.166-1.821.714-2.46 1.508a6.607 6.607 0 00-1.03 1.73c-.093.21-.181.423-.268.637-.253.617-.511 1.235-.891 1.786-.39.566-.861 1.026-1.562 1.196-.485.118-.898.007-1.278-.302a5.124 5.124 0 01-.125-.11 4.04 4.04 0 00-.163-.137c-.144-.11-.316-.176-.487-.088-.195.1-.26.32-.189.524.028.08.066.155.11.225.044.07.095.135.152.193.113.116.247.209.393.276.146.067.303.107.464.117.16.01.321-.009.476-.055.155-.046.301-.12.432-.218.13-.098.243-.218.333-.354.09-.136.157-.285.198-.44.04-.156.053-.317.038-.477-.015-.159-.059-.315-.13-.46a2.33 2.33 0 00-.252-.402c-.102-.13-.221-.247-.353-.348a2.33 2.33 0 00-.428-.232 2.34 2.34 0 00-.479-.112 2.36 2.36 0 00-.493.002 2.344 2.344 0 00-.468.107" />
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
  { id: 'anthropic/claude-opus-4-5',   name: 'Claude Opus 4.5',   provider: 'Anthropic', Logo: AnthropicLogo, logoColor: '#D97757' },
  { id: 'anthropic/claude-sonnet-4',   name: 'Claude Sonnet 4',   provider: 'Anthropic', Logo: AnthropicLogo, logoColor: '#D97757' },
  { id: 'anthropic/claude-haiku-4-5',  name: 'Claude Haiku 4.5',  provider: 'Anthropic', Logo: AnthropicLogo, logoColor: '#D97757' },
  { id: 'openai/gpt-4o',               name: 'GPT-4o',             provider: 'OpenAI',    Logo: OpenAILogo,    logoColor: '#10a37f' },
  { id: 'openai/gpt-4o-mini',          name: 'GPT-4o mini',        provider: 'OpenAI',    Logo: OpenAILogo,    logoColor: '#10a37f' },
  { id: 'google/gemini-2.5-pro',       name: 'Gemini 2.5 Pro',     provider: 'Google',    Logo: GeminiLogo,    logoColor: '#4285F4' },
  { id: 'deepseek/deepseek-chat',      name: 'DeepSeek Chat',      provider: 'DeepSeek',  Logo: DeepSeekLogo,  logoColor: '#4D6BFE' },
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewAgentPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('Bot');
  const [description, setDescription] = useState('');
  const [inputDescription, setInputDescription] = useState('');
  const [outputDescription, setOutputDescription] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [skillFiles, setSkillFiles] = useState<File[]>([]);
  const [skillsDragOver, setSkillsDragOver] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeModel = FOUNDATION_MODELS.find((m) => m.id === selectedModelId);
  const canSave = name.trim().length > 0 && selectedModelId !== '' && !saving;

  function addSkillFiles(incoming: FileList | File[]) {
    const files = Array.from(incoming);
    setSkillFiles((prev) => [...prev, ...files]);
  }

  function handleSkillDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setSkillsDragOver(false);
    if (event.dataTransfer.files.length > 0) addSkillFiles(event.dataTransfer.files);
  }

  async function handleSave() {
    setSaving(true);
    try {
      let skillFileNames: string[] = [];
      if (skillFiles.length > 0) {
        const batchId = crypto.randomUUID();
        skillFileNames = await Promise.all(
          skillFiles.map(async (file) => {
            const storagePath = `agentSkills/new_${batchId}/${file.name}`;
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
        skillFileNames,
      };
      await fetch('/api/agent-definitions', {
        method: 'POST',
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
        <h1 className="text-xl font-headline font-semibold">New Agent</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Register a new AI agent and configure its capabilities.
        </p>
      </div>

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

          {skillFiles.length > 0 && (
            <ul className="space-y-1.5">
              {skillFiles.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span className="truncate text-foreground/80">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setSkillFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label={`Remove ${file.name}`}
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
            {saving ? 'Saving…' : 'Save new agent'}
          </button>
        </div>

      </div>
    </div>
  );
}
