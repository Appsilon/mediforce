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
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  },
  {
    label: 'Paused',
    count: 0,
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  },
  {
    label: 'Failed',
    count: 0,
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  },
  {
    label: 'Completed',
    count: 0,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30 border-border',
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
