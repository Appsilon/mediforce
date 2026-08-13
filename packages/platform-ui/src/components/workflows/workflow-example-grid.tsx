'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ManifestEntry } from '@mediforce/platform-api/contract';

const ALL_TAGS = '__all__';

export interface WorkflowExampleGridProps {
  workflows: ManifestEntry[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  /** Select-all is scoped to the names passing the tag filter, which only the
   *  grid knows — a bulk action must not reach workflows the user cannot see. */
  onSelectMany: (names: string[], select: boolean) => void;
}

export function WorkflowExampleGrid({
  workflows,
  selected,
  onToggle,
  onSelectMany,
}: WorkflowExampleGridProps) {
  const [tag, setTag] = React.useState<string>(ALL_TAGS);

  const tags = React.useMemo(() => {
    const distinct = new Set<string>();
    for (const workflow of workflows) {
      for (const workflowTag of workflow.tags ?? []) distinct.add(workflowTag);
    }
    return [...distinct].sort((a, b) => a.localeCompare(b));
  }, [workflows]);

  // A tag the current list does not carry (the caller swapped `workflows`) reads
  // as no filter, so the grid can never strand the user on an empty view whose
  // active chip is gone.
  const activeTag = tags.includes(tag) ? tag : ALL_TAGS;

  const visible = React.useMemo(
    () =>
      activeTag === ALL_TAGS
        ? workflows
        : workflows.filter((wf) => (wf.tags ?? []).includes(activeTag)),
    [workflows, activeTag],
  );

  const allVisibleSelected = visible.length > 0 && visible.every((wf) => selected.has(wf.name));
  // Selection survives a filter change, so a pick made under another tag is
  // still imported. Say so rather than letting it import unseen.
  const hiddenSelectedCount = workflows.filter(
    (wf) => selected.has(wf.name) && !visible.includes(wf),
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tags.length > 1 && (
            <>
              <TagChip label="All" active={activeTag === ALL_TAGS} onClick={() => setTag(ALL_TAGS)} />
              {tags.map((candidate) => (
                <TagChip
                  key={candidate}
                  label={candidate}
                  active={activeTag === candidate}
                  onClick={() => setTag(candidate)}
                />
              ))}
            </>
          )}
        </div>
        {visible.length > 1 && (
          <button
            type="button"
            onClick={() => onSelectMany(visible.map((wf) => wf.name), !allVisibleSelected)}
            className="text-xs text-primary hover:underline shrink-0"
          >
            {allVisibleSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>

      {hiddenSelectedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {hiddenSelectedCount} selected {hiddenSelectedCount === 1 ? 'workflow is' : 'workflows are'}{' '}
          hidden by this filter and will still be imported.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No workflows match this tag.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 max-h-[26rem] overflow-y-auto pr-1">
          {visible.map((workflow) => (
            <label
              key={workflow.name}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all hover:border-primary/40 hover:shadow-sm',
                selected.has(workflow.name) && 'border-primary bg-primary/5',
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(workflow.name)}
                onChange={() => onToggle(workflow.name)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" title={workflow.name}>
                  {workflow.name}
                </p>
                {workflow.description !== undefined && workflow.description !== '' && (
                  <p
                    className="text-xs text-muted-foreground mt-1 line-clamp-3"
                    title={workflow.description}
                  >
                    {workflow.description}
                  </p>
                )}
                {workflow.tags !== undefined && workflow.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {workflow.tags.map((workflowTag) => (
                      <span
                        key={workflowTag}
                        className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {workflowTag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
