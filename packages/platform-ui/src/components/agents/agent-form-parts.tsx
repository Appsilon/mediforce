'use client';

import * as React from 'react';
import {
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings, Info,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AgentOutputSchemaSchema, CoworkAgentSchema, DEFAULT_AGENT_IMAGE, type AgentDefinition, type AgentOutputSchema } from '@mediforce/platform-core';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { usePlugins } from '@/hooks/use-plugins';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useImageCatalogEntries } from '@/hooks/use-image-catalog';
import { buildImagePicker } from '@/components/workflows/workflow-editor/image-picker-options';
import { pickerImageValue } from '@/components/workflows/workflow-editor/image-options';
import { ReadyImagePicker } from '@/components/workflows/workflow-editor/image-source-fields';
import { humanizeToken } from '@/components/workflows/workflow-editor/step-editor-fields';
import { OutputSchemaEditor } from '@/components/workflows/workflow-editor/output-schema-editor';

export const AGENT_ICON_OPTIONS: Array<{ icon: LucideIcon; label: string }> = [
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

export function RecognitionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium">
      {children}
      <InstantTooltip label={RECOGNITION_ONLY_HINT}>
        <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label={RECOGNITION_ONLY_HINT} />
      </InstantTooltip>
    </label>
  );
}

const selectClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export type AgentKind = AgentDefinition['kind'];

/** Runtime of an agent. Its kind is fixed at creation: a container agent runs on a registered plugin, a cowork agent on a chat or voice runtime. */
export function AgentRuntimeField({ kind, runtimeId, onChange }: {
  kind: AgentKind;
  runtimeId: string | undefined;
  onChange: (runtimeId: string) => void;
}) {
  const { plugins } = usePlugins();
  const options: string[] = kind === 'cowork' ? [...CoworkAgentSchema.options] : plugins.map((plugin) => plugin.name);
  if (runtimeId !== undefined && !options.includes(runtimeId)) options.push(runtimeId);

  return (
    <div className="space-y-1.5">
      <label htmlFor="agent-runtime" className="text-sm font-medium">Runtime</label>
      <select
        id="agent-runtime"
        value={runtimeId ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        {runtimeId === undefined && <option value="" disabled>Select a runtime</option>}
        {options.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
      </select>
      <p className="text-xs text-muted-foreground">
        {kind === 'plugin'
          ? 'What executes this agent. Required before the agent can be evaluated.'
          : 'The chat or voice runtime of this cowork agent.'}
      </p>
    </div>
  );
}

/** Image a container agent runs in, picked from the workspace's image catalog. Blank is the golden image. */
export function AgentImageField({ namespace, image, onChange }: {
  namespace: string;
  image: string | undefined;
  onChange: (image: string | undefined) => void;
}) {
  const { images: dockerImages } = useDockerImages();
  const { entries: catalogEntries } = useImageCatalogEntries(namespace);
  const picker = React.useMemo(
    () => buildImagePicker({ catalogEntries, dockerImages: dockerImages ?? [], executor: 'agent' }),
    [catalogEntries, dockerImages],
  );

  return (
    <div className="space-y-1.5">
      <ReadyImagePicker
        label="Image"
        picker={picker}
        image={image}
        onChange={onChange}
        blankOptionLabel={`Default — ${DEFAULT_AGENT_IMAGE}`}
        placeholder={DEFAULT_AGENT_IMAGE}
        pickerValue={pickerImageValue}
      />
      <p className="text-xs text-muted-foreground">
        The image the agent runs in, which decides the tools it has. Its evaluations run in it, and a workflow step that names no image of its own is given it when the workflow is saved.
      </p>
    </div>
  );
}

export function AgentOutputSchemaField({ value, onChange }: {
  value: AgentOutputSchema | undefined;
  onChange: (outputSchema: AgentOutputSchema | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Output schema (optional)</label>
      <OutputSchemaEditor value={value} onChange={onChange} schema={AgentOutputSchemaSchema} />
      <p className="text-xs text-muted-foreground">
        JSON Schema the agent&apos;s result must match. It is shown to the agent and checked after every run, unless the step sets its own.
      </p>
    </div>
  );
}
