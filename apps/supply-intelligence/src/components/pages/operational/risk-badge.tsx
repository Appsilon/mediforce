import type { RiskLevel } from '@mediforce/supply-intelligence';
import { Badge } from '@/components/ui/badge';

const riskConfig: Record<RiskLevel, { label: string; className: string; variant?: 'destructive' }> = {
  red: {
    label: 'Red',
    className: '',
    variant: 'destructive',
  },
  orange: {
    label: 'Orange',
    className: 'bg-orange-500 text-white hover:bg-orange-500/80 border-transparent',
  },
  green: {
    label: 'Green',
    className: 'bg-green-600 text-white hover:bg-green-600/80 border-transparent',
  },
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  const config = riskConfig[level];
  return (
    <Badge variant={config.variant ?? 'default'} className={config.className}>
      {config.label}
    </Badge>
  );
}
