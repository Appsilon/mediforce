'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/** A checkbox that can also show "some": `indeterminate` is a DOM property,
 *  not an attribute, so React cannot set it from JSX. */
export function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn('h-4 w-4 rounded border-border accent-primary cursor-pointer disabled:cursor-not-allowed', className)}
    />
  );
}
