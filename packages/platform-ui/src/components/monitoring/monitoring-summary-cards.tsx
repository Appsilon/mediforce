import { cn } from '@/lib/utils';

interface StatusCard {
  label: string;
  count: number;
  color: string;
  bgColor: string;
}

const CARD_STYLES: StatusCard[] = [
  {
    label: 'Running',
    count: 0,
    color: 'text-foreground',
    bgColor: 'bg-card border-border',
  },
  {
    label: 'Paused',
    count: 0,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-card border-border',
  },
  {
    label: 'Failed',
    count: 0,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-card border-border',
  },
  {
    label: 'Completed',
    count: 0,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-card border-border',
  },
];

export function MonitoringSummaryCards({
  running,
  paused,
  failed,
  completed,
  loading,
}: {
  running: number;
  paused: number;
  failed: number;
  completed: number;
  loading: boolean;
}) {
  const cards = [
    { ...CARD_STYLES[0], count: running },
    { ...CARD_STYLES[1], count: paused },
    { ...CARD_STYLES[2], count: failed },
    { ...CARD_STYLES[3], count: completed },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(({ label, count, color, bgColor }) => (
        <div key={label} className={cn('rounded-lg border p-4 space-y-1', bgColor)}>
          {loading ? (
            <div className="h-8 w-12 rounded bg-muted animate-pulse" />
          ) : (
            <div className={cn('text-3xl font-bold font-headline', color)}>{count}</div>
          )}
          <div className="text-sm font-medium text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}
