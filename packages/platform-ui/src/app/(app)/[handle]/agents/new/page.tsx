'use client';

import * as React from 'react';
import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings,
  Check, ChevronDown,
} from 'lucide-react';
import { mediforce } from '@/lib/mediforce';
import { FOUNDATION_MODELS } from '@/lib/agent-models';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

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
  const { handle } = useParams<{ handle: string }>();
  const router = useRouter();

  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('Bot');
  const [description, setDescription] = useState('');
  const [inputDescription, setInputDescription] = useState('');
  const [outputDescription, setOutputDescription] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeModel = FOUNDATION_MODELS.find((m) => m.id === selectedModelId);
  const canSave = name.trim().length > 0 && selectedModelId !== '' && !saving;

  async function handleSave() {
    setSaving(true);
    try {
      await mediforce.agents.create({
        kind: 'plugin',
        name: name.trim(),
        iconName: selectedIcon,
        description,
        inputDescription,
        outputDescription,
        foundationModel: selectedModelId,
        systemPrompt: prompt,
        visibility: 'private',
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
      <div>
        <p className="text-sm text-muted-foreground">
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
