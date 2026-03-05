import { cn } from '@/lib/utils';

const AUTONOMY_STYLE = 'bg-muted text-muted-foreground';

const AUTONOMY_LABELS: Record<string, string> = {
  L0: 'Observer',
  L1: 'Shadow',
  L2: 'Annotator',
  L3: 'Advisor',
  L4: 'Autopilot',
};

export function AutonomyBadge({ level, showLabel = false }: { level: string; showLabel?: boolean }) {
  return (
    <span className={cn(
      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
      AUTONOMY_STYLE,
    )}>
      {level}{showLabel ? ` ${AUTONOMY_LABELS[level] ?? ''}` : ''}
    </span>
  );
}
