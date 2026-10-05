import * as React from 'react';
import {
  Bot, Cpu, Terminal, BarChart3, Brain, Zap,
  Shield, Code, Database, Globe, Sparkles, Settings, Info,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { InstantTooltip } from '@/components/ui/instant-tooltip';

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
