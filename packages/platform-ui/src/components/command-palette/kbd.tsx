import * as React from 'react';
import { cn } from '@/lib/utils';

type KbdSize = 'sm' | 'md';

const SIZE_STYLES: Record<KbdSize, string> = {
  sm: 'h-4 min-w-4 px-1 text-[10px]',
  md: 'h-5 min-w-5 px-1.5 text-[11px] font-medium',
};

export function Kbd({
  children,
  className,
  size = 'md',
}: {
  children: React.ReactNode;
  className?: string;
  size?: KbdSize;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex select-none items-center justify-center rounded border bg-muted font-mono text-muted-foreground',
        SIZE_STYLES[size],
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function KbdRow({
  keys,
  className,
  size,
}: {
  keys: string[];
  className?: string;
  size?: KbdSize;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`} size={size}>{key}</Kbd>
      ))}
    </span>
  );
}
