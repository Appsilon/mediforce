import { cn } from '@/lib/utils';
import { confidenceToTrafficLight } from '@/lib/utils';

export function ConfidenceBadge({
  confidence,
  showLabel = false,
}: {
  confidence: number | null | undefined;
  showLabel?: boolean;
}) {
  if (confidence === null || confidence === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const pct = Math.round(confidence * 100);
  const { color, label } = confidenceToTrafficLight(confidence);

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', color)}>
      {/* Traffic light dot */}
      <span className={cn('h-2 w-2 rounded-full', {
        'bg-green-500': confidence >= 0.8,
        'bg-amber-500': confidence >= 0.5 && confidence < 0.8,
        'bg-red-500': confidence < 0.5,
      })} />
      {pct}%
      {showLabel && <span className="capitalize text-xs font-normal">({label})</span>}
    </span>
  );
}
