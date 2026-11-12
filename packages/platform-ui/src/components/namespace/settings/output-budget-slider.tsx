'use client';

import { useEffect, useState } from 'react';
import { OUTPUT_BUDGETS, type OutputBudget } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';

export const OUTPUT_BUDGET_LABELS: Record<OutputBudget, string> = {
  low: 'Low',
  default: 'Default',
  high: 'High',
  max: 'Max',
};

interface OutputBudgetSliderProps {
  id: string;
  title: string;
  description: string;
  value: OutputBudget;
  onCommit: (value: OutputBudget) => void;
  children?: React.ReactNode;
}

/**
 * One budget step picked on a range input; saved when the person lets go, not while
 * dragging. The save is optimistic, so the slider never waits on it or disables itself.
 */
export function OutputBudgetSlider({
  id,
  title,
  description,
  value,
  onCommit,
  children,
}: OutputBudgetSliderProps) {
  const valueIndex = OUTPUT_BUDGETS.indexOf(value);
  const [index, setIndex] = useState(valueIndex);

  useEffect(() => {
    setIndex(valueIndex);
  }, [valueIndex]);

  const picked = OUTPUT_BUDGETS[index] ?? 'default';

  function commit() {
    if (picked !== value) onCommit(picked);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <label htmlFor={id} className="text-sm font-medium">{title}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">
          {OUTPUT_BUDGET_LABELS[picked]}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={OUTPUT_BUDGETS.length - 1}
        step={1}
        value={index}
        onChange={(event) => setIndex(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        aria-valuetext={OUTPUT_BUDGET_LABELS[picked]}
        className="mt-2 w-full accent-primary"
      />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        {OUTPUT_BUDGETS.map((step, stepIndex) => (
          <span key={step} className={cn(stepIndex === index && 'font-medium text-primary')}>
            {OUTPUT_BUDGET_LABELS[step]}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}
