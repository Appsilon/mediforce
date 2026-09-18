'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatBytes } from '@mediforce/platform-core';
import { IndeterminateCheckbox } from '@/components/ui/indeterminate-checkbox';
import { cn } from '@/lib/utils';
import {
  contextFileState,
  contextTree,
  type ContextSelection,
  type ContextSummary,
  type ContextTreeNode,
  type PickedFolder,
} from './picked-folder';

interface RowProps {
  node: ContextTreeNode;
  depth: number;
  selection: ContextSelection;
  summaries: ReadonlyMap<string, ContextSummary>;
  expanded: ReadonlySet<string>;
  onExpand: (path: string) => void;
  onToggle: (path: string) => void;
}

/** What a row's checkbox shows, and why it cannot be changed when it cannot. */
function rowState(node: ContextTreeNode, selection: ContextSelection, summary: ContextSummary | undefined) {
  if (node.children === null) {
    const state = contextFileState(selection, node.path);
    return {
      checked: state === 'selected' || state === 'required',
      indeterminate: false,
      disabled: state === 'ignored' || state === 'required',
      leftOut: state === 'ignored' || state === 'unchecked',
      note: state === 'ignored' ? `in ${selection.ignoreFile ?? '.dockerignore'}` : state === 'required' ? 'always sent' : '',
    };
  }
  const toggleable = summary?.toggleable ?? 0;
  const toggleableSelected = summary?.toggleableSelected ?? 0;
  const selected = summary?.selectedFiles ?? 0;
  const allIgnored = summary !== undefined && summary.ignoredFiles === summary.files;
  return {
    checked: toggleable > 0 ? toggleableSelected === toggleable : selected > 0,
    indeterminate: toggleableSelected > 0 && toggleableSelected < toggleable,
    disabled: toggleable === 0,
    leftOut: selected === 0,
    note: allIgnored ? `in ${selection.ignoreFile ?? '.dockerignore'}` : '',
  };
}

function ContextTreeRow({ node, depth, selection, summaries, expanded, onExpand, onToggle }: RowProps) {
  const isDirectory = node.children !== null;
  const open = expanded.has(node.path);
  const state = rowState(node, selection, summaries.get(node.path));
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <div
        className="flex items-center gap-1.5 py-0.5 pr-2 hover:bg-muted/50"
        // Indented per level; the depth has no Tailwind class to name it.
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <IndeterminateCheckbox
          aria-label={`Upload ${node.path}`}
          checked={state.checked}
          indeterminate={state.indeterminate}
          disabled={state.disabled}
          onChange={() => onToggle(node.path)}
          className="h-3.5 w-3.5 shrink-0"
        />
        {isDirectory ? (
          <button
            type="button"
            onClick={() => onExpand(node.path)}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.path}`}
            className={cn(
              'flex min-w-0 items-center gap-0.5 text-left hover:text-foreground',
              state.leftOut && 'text-muted-foreground',
            )}
          >
            <Chevron className="h-3 w-3 shrink-0" />
            <span className="truncate">{node.name}/</span>
          </button>
        ) : (
          <span className={cn('truncate pl-3.5', state.leftOut && 'text-muted-foreground line-through')}>
            {node.name}
          </span>
        )}
        {state.note !== '' && (
          <span className="shrink-0 font-sans text-[10px] text-muted-foreground">{state.note}</span>
        )}
        <span className="ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground">{formatBytes(node.size)}</span>
      </div>
      {isDirectory && open && (
        <ul>
          {node.children?.map((child) => (
            <ContextTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selection={selection}
              summaries={summaries}
              expanded={expanded}
              onExpand={onExpand}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The picked folder as a tree to uncheck what the build does not need (#1345).
 * Directories open on demand, so a folder of many thousand files renders only
 * what is looked at.
 */
export function ContextTree({
  folder,
  selection,
  summaries,
  onToggle,
}: {
  folder: PickedFolder;
  selection: ContextSelection;
  summaries: ReadonlyMap<string, ContextSummary>;
  onToggle: (path: string) => void;
}) {
  const tree = useMemo(() => contextTree(folder), [folder]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  function toggleExpanded(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <ul
      aria-label="Build context"
      className="max-h-64 overflow-auto rounded-md border bg-background py-1 font-mono text-xs"
    >
      {tree.map((node) => (
        <ContextTreeRow
          key={node.path}
          node={node}
          depth={0}
          selection={selection}
          summaries={summaries}
          expanded={expanded}
          onExpand={toggleExpanded}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}
