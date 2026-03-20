import { cn } from '@/lib/utils';

interface VersionLabelProps {
  version: number | string;
  title?: string;
  variant?: 'badge' | 'inline';
  className?: string;
}

export function VersionLabel({ version, title, variant = 'badge', className }: VersionLabelProps) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 text-xs',
        variant === 'badge' && 'bg-muted px-1.5 py-0.5 rounded',
        className,
      )}
    >
      <span className="font-mono font-medium shrink-0">v{version}</span>
      {title && <span className="text-muted-foreground truncate">{title}</span>}
    </span>
  );
}
