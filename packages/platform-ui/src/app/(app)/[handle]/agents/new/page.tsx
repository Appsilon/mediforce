'use client';

import * as React from 'react';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings, Info,
} from 'lucide-react';
import { mediforce } from '@/lib/mediforce';
import type { AgentMcpBindingMap } from '@mediforce/platform-core';
import { ModelPicker } from '@/components/agents/model-picker';
import { AgentMcpSection } from '@/components/agents/agent-mcp-section';
import { cn } from '@/lib/utils';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
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

const RECOGNITION_ONLY_HINT =
  'Not used by the model. This is for people to recognise the agent when wiring a step.';

function RecognitionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium">
      {children}
      <InstantTooltip label={RECOGNITION_ONLY_HINT}>
        <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label={RECOGNITION_ONLY_HINT} />
      </InstantTooltip>
    </label>
  );
}

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
  const [prompt, setPrompt] = useState('');
  const [mcpServers, setMcpServers] = useState<AgentMcpBindingMap>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const canSave = name.trim().length > 0 && selectedModelId !== '' && !saving;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { agent } = await mediforce.agents.create({
        kind: 'plugin',
        name: name.trim(),
        iconName: selectedIcon,
        description,
        inputDescription,
        outputDescription,
        foundationModel: selectedModelId,
        systemPrompt: prompt,
        mcpServers,
        namespace: handle,
        visibility: 'private',
      });
      // Land on the Configure page so OAuth bindings can be connected now that the agent exists.
      router.push(`/${handle}/agents/definitions/${agent.id}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not create the agent: ${err.message}`
          : 'Could not create the agent.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 max-w-2xl" data-tour="agent-new-form">
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
          <RecognitionLabel>Description (optional)</RecognitionLabel>
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

        {/* 5. Foundation model */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Foundation model</label>
          <ModelPicker value={selectedModelId} onChange={setSelectedModelId} />
          <p className="text-xs text-muted-foreground">
            Used by every workflow step that calls this agent, unless the step sets its own model.
          </p>
        </div>

        {/* 6. System prompt */}
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

        {/* 7. MCP servers */}
        <AgentMcpSection
          handle={handle}
          draft={{ bindings: mcpServers, onChange: setMcpServers }}
        />

        {/* 8. Save */}
        <div className="flex flex-col items-start gap-1.5 pt-2 pb-6">
          <button
            type="button"
            onClick={handleSave}
            data-tour="agent-new-save"
            disabled={!canSave}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              !canSave && 'opacity-50 cursor-not-allowed',
            )}
          >
            {saving ? 'Saving…' : 'Save new agent'}
          </button>
          {error !== null && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
