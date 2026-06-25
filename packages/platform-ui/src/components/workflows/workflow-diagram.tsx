'use client';

import React, { useMemo, useCallback, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { User, Bot, Terminal, Trash2, Plus, PenLine, Search, GitBranch, ArrowUp, ArrowDown, ArrowRight, ChevronRight, ChevronDown, AlertTriangle, Zap, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import {
  getControlMode,
  CONTROL_MODE_LABELS,
  type ControlMode,
  type NewStepPayload,
} from '@/lib/control-mode';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLORS = {
  forward: { stroke: '#cbd5e1', arrow: '#94a3b8' },
  back: { stroke: '#f59e0b', arrow: '#d97706' },
  label: { forward: '#64748b', back: '#b45309' },
} as const;

const STEP_STYLES: Record<string, { bg: string; border: string; activeBorder: string; activeRing: string }> = {
  creation: {
    bg: 'bg-white dark:bg-slate-900',
    border: 'border-blue-200 dark:border-blue-800',
    activeBorder: 'border-blue-600 dark:border-blue-400',
    activeRing: 'ring-2 ring-blue-400 ring-offset-1 dark:ring-blue-500',
  },
  review: {
    bg: 'bg-amber-50/50 dark:bg-amber-950/20',
    border: 'border-amber-200 dark:border-amber-800',
    activeBorder: 'border-amber-500 dark:border-amber-400',
    activeRing: 'ring-2 ring-amber-400 ring-offset-1 dark:ring-amber-500',
  },
  decision: {
    bg: 'bg-purple-50/50 dark:bg-purple-950/20',
    border: 'border-purple-200 dark:border-purple-800',
    activeBorder: 'border-purple-600 dark:border-purple-400',
    activeRing: 'ring-2 ring-purple-400 ring-offset-1 dark:ring-purple-500',
  },
  terminal: {
    bg: 'bg-slate-50 dark:bg-slate-900',
    border: 'border-slate-200 dark:border-slate-700',
    activeBorder: 'border-slate-600 dark:border-slate-400',
    activeRing: 'ring-2 ring-slate-400 ring-offset-1 dark:ring-slate-500',
  },
};

const STEP_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  creation: { label: 'Creation', color: 'text-blue-500 dark:text-blue-400' },
  review:   { label: 'Review',   color: 'text-amber-500 dark:text-amber-400' },
  decision: { label: 'Decision', color: 'text-purple-500 dark:text-purple-400' },
  terminal: { label: 'End',      color: 'text-emerald-500 dark:text-emerald-400' },
};

// ---------------------------------------------------------------------------
// Custom nodes
// ---------------------------------------------------------------------------

function ExecutorIcon({ executor, autonomyLevel }: { executor: string; autonomyLevel?: string }) {
  const mode = getControlMode(executor, autonomyLevel);
  if (executor === 'script') return <Terminal className="h-3.5 w-3.5 shrink-0 text-yellow-500 dark:text-yellow-400" />;
  if (executor === 'action') return <Zap className="h-3.5 w-3.5 shrink-0 text-pink-500 dark:text-pink-400" />;
  if (executor === 'cowork') return (
    <span className="inline-flex items-center gap-0.5">
      <User className="h-3.5 w-3.5 shrink-0 text-teal-500 dark:text-teal-400" />
      <Bot className="h-3.5 w-3.5 shrink-0 text-teal-500 dark:text-teal-400" />
    </span>
  );
  if (executor === 'agent') {
    if (mode === 'human-review') return (
      <span className="inline-flex items-center gap-0.5">
        <Bot className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" />
        <span className="relative inline-flex shrink-0">
          <User className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
          <Search className="absolute -bottom-0.5 -right-1.5 h-2 w-2 text-indigo-500 dark:text-indigo-400" strokeWidth={2.5} />
        </span>
      </span>
    );
    if (mode === 'autonomous-agent') return <Bot className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-400" />;
    return <Bot className="h-3.5 w-3.5 shrink-0 text-lime-500 dark:text-lime-400" />;
  }
  return <User className="h-3.5 w-3.5 shrink-0 text-orange-500 dark:text-orange-400" />;
}

function getExecutorLabel(executor: string, mode: ControlMode): string {
  if (executor === 'human') return 'Human';
  if (executor === 'script') return 'Script';
  if (executor === 'action') return 'Action';
  return CONTROL_MODE_LABELS[mode];
}

type BranchInfo = {
  branchIdx: number;
  label: string;
  isActive: boolean;
  isBackEdge: boolean;
  backTargetName?: string;
  onExpand?: () => void;
};

type StepNodeData = {
  label: string;
  stepType: string;
  executor: string;
  autonomyLevel?: string;
  plugin?: string;
  hasError?: boolean;
  hasWarning?: boolean;
  warningTooltip?: string;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  branches?: BranchInfo[];
};

const NODE_WIDTH = 240;
const NODE_INNER_HEIGHT = 85;
const BRANCH_ROW_HEIGHT = 32;
const ROW_GAP = 58;

const HANDLE_CLASS = '!bg-transparent !border-0 !w-px !h-px';

function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  // Measure the actual offsetTop of the branch section so the right-out handle
  // is anchored to the visual center of the revise row, not a pixel estimate.
  const branchSectionRef = useRef<HTMLDivElement>(null);
  const [branchSectionTop, setBranchSectionTop] = useState(NODE_INNER_HEIGHT);
  useLayoutEffect(() => {
    if (branchSectionRef.current) {
      const top = branchSectionRef.current.offsetTop;
      if (top !== branchSectionTop) setBranchSectionTop(top);
    }
  });

  const isTerminal = data.stepType === 'terminal';

  if (isTerminal) {
    return (
      <>
        <Handle id="top" type="target" position={Position.Top} className={HANDLE_CLASS} />
        <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
        <Handle id="right-out" type="source" position={Position.Right} className={HANDLE_CLASS} />
        <Handle id="right-in" type="target" position={Position.Right} className={HANDLE_CLASS} />
        <div style={{ width: NODE_WIDTH }} className="flex flex-col items-center gap-2 cursor-default">
          <div className="w-12 h-12 rounded-full flex items-center justify-center border-[3px] border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30">
            <div className="w-5 h-5 rounded-full bg-emerald-400 dark:bg-emerald-600" />
          </div>
          <span className="text-[11px] font-medium text-emerald-500 dark:text-emerald-400">
            {data.label}
          </span>
        </div>
      </>
    );
  }

  const style = STEP_STYLES[data.stepType] ?? STEP_STYLES.creation;
  const typeConfig = STEP_TYPE_CONFIG[data.stepType] ?? STEP_TYPE_CONFIG.creation;
  const mode = getControlMode(data.executor, data.autonomyLevel);

  const firstBackEdgeIdx = data.branches?.findIndex((b) => b.isBackEdge) ?? -1;
  // branchSectionTop is measured via ref; firstBackEdgeIdx is always 0 (revise rows come first)
  const rightOutTop = firstBackEdgeIdx >= 0
    ? branchSectionTop + firstBackEdgeIdx * BRANCH_ROW_HEIGHT + BRANCH_ROW_HEIGHT / 2
    : undefined;

  return (
    <>
      <Handle id="top" type="target" position={Position.Top} className={HANDLE_CLASS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      <Handle id="right-out" type="source" position={Position.Right} className={HANDLE_CLASS} style={rightOutTop !== undefined ? { top: rightOutTop } : undefined} />
      <Handle id="right-in" type="target" position={Position.Right} className={HANDLE_CLASS} />

      <div
        style={{ width: NODE_WIDTH, minHeight: NODE_INNER_HEIGHT }}
        className={cn(
          'group rounded-xl border-[1.5px] px-4 pt-3 transition-all cursor-pointer relative overflow-hidden',
          data.branches?.length ? 'pb-0' : 'pb-3',
          'hover:shadow-md',
          style.bg,
          selected
            ? `${style.activeBorder} ${style.activeRing} shadow-lg`
            : data.hasError
              ? 'border-red-400 ring-2 ring-red-200 dark:ring-red-900/50'
              : data.hasWarning
                ? 'border-amber-400 ring-2 ring-amber-200 dark:ring-amber-900/50'
                : style.border,
        )}
      >
        {(data.onMoveUp || data.onMoveDown || data.onDelete) && (
          <div className="absolute top-2.5 right-2.5 z-10 hidden group-hover:flex flex-col gap-0.5">
            {data.onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); data.onDelete?.(); }}
                className="h-5 w-5 flex items-center justify-center rounded text-red-400 hover:text-red-600 transition-colors bg-transparent"
                aria-label="Delete step"
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.5} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); data.onMoveUp?.(); }}
              disabled={!data.onMoveUp}
              className={cn(
                'h-5 w-5 flex items-center justify-center rounded transition-colors bg-transparent',
                data.onMoveUp
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  : 'text-muted-foreground/20 cursor-not-allowed',
              )}
              aria-label="Move step up"
            >
              <ArrowUp className="h-3 w-3" strokeWidth={1.5} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); data.onMoveDown?.(); }}
              disabled={!data.onMoveDown}
              className={cn(
                'h-5 w-5 flex items-center justify-center rounded transition-colors bg-transparent',
                data.onMoveDown
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  : 'text-muted-foreground/20 cursor-not-allowed',
              )}
              aria-label="Move step down"
            >
              <ArrowDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Row 1: executor identity (left) + step type (right) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <ExecutorIcon executor={data.executor} autonomyLevel={data.autonomyLevel} />
            <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
              {getExecutorLabel(data.executor, mode)}
            </span>
          </div>
          <span className={cn('text-[10px] font-semibold shrink-0', typeConfig.color)}>
            {typeConfig.label}
          </span>
        </div>

        {/* Row 2: step name, max 2 lines */}
        <p className="text-[12px] font-semibold leading-snug text-foreground mt-3 line-clamp-2">
          {data.label}
        </p>

        {data.hasWarning && (
          <div className="flex items-center gap-1 mt-1" title={data.warningTooltip}>
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" strokeWidth={2} />
            <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate">Image not found</span>
          </div>
        )}

        {data.branches && data.branches.length > 0 && (
          <div ref={branchSectionRef} className="-mx-4 mt-3 border-t border-border/40">
            {data.branches.map((branch, i) => (
              <button
                key={branch.branchIdx}
                disabled={branch.isBackEdge || branch.isActive}
                onClick={(e) => { e.stopPropagation(); branch.onExpand?.(); }}
                style={{ height: BRANCH_ROW_HEIGHT }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 text-left text-[11px] transition-all',
                  i < data.branches!.length - 1 && 'border-b border-border/20',
                  branch.isActive
                    ? 'bg-blue-100/80 text-blue-700 font-semibold dark:bg-blue-900/30 dark:text-blue-300 cursor-default'
                    : branch.isBackEdge
                    ? 'bg-slate-50/60 text-slate-500 dark:bg-slate-800/30 dark:text-slate-400 cursor-default'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/50 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer',
                )}
              >
                <span className="truncate flex-1">{branch.label}</span>
                {branch.isBackEdge
                  ? <ArrowRight className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" />
                  : branch.isActive
                  ? <Eye className="h-3 w-3 shrink-0 text-blue-500 dark:text-blue-400" />
                  : <EyeOff className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" />
                }
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const nodeTypes = { step: StepNode };

// ---------------------------------------------------------------------------
// Custom edge — forward edges with a mid-point "add step" button
// ---------------------------------------------------------------------------

type AddStepEdgeData = {
  onAdd?: (payload: NewStepPayload) => void;
  onOpenPopover?: (pos: { top: number; left: number }, onAdd: (payload: NewStepPayload) => void) => void;
  onClosePopover?: () => void;
  popoverEdgeId?: string | null;
  edgeId?: string;
};

function AddStepEdge({
  id,
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  style, markerEnd,
  label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius,
  data,
}: EdgeProps & { data?: AddStepEdgeData }) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [path, midX, midY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const buttonX = sourceX + 0.4 * (targetX - sourceX);
  const buttonY = sourceY + 0.4 * (targetY - sourceY);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data?.popoverEdgeId === id) {
      data?.onClosePopover?.();
    } else {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect && data?.onAdd) {
        const POPOVER_WIDTH = 500;
        const rawLeft = rect.left + window.scrollX + rect.width / 2;
        const viewportWidth = document.documentElement.clientWidth;
        const left = Math.max(
          window.scrollX + POPOVER_WIDTH / 2 + 8,
          Math.min(rawLeft, window.scrollX + viewportWidth - POPOVER_WIDTH / 2 - 8),
        );
        data.onOpenPopover?.({
          top: rect.bottom + window.scrollY + 8,
          left,
        }, data.onAdd);
      }
    }
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        label={label}
        labelX={midX}
        labelY={midY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        labelShowBg={true}
      />
      {data?.onAdd && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${buttonX}px, ${buttonY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              ref={buttonRef}
              onClick={handleButtonClick}
              className="h-5 w-5 flex items-center justify-center rounded-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-400 hover:text-primary hover:border-primary transition-colors shadow-sm"
              aria-label="Add step here"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { addStep: AddStepEdge };

// ---------------------------------------------------------------------------
// Layout engine — single column, branch-accordion
// ---------------------------------------------------------------------------

type LayoutItem = { kind: 'step'; stepId: string; branches?: BranchInfo[] };

function shortenCondition(raw: string | undefined): string | undefined {
  return raw
    ?.replace(/^when:\s*/, '')
    .replace(/output\./g, '')
    .replace(/\s*==\s*/g, ' = ');
}

function buildLayout(
  definition: WorkflowDefinition,
  expandedBranches: Map<string, number>,
): { nodes: Node[]; edges: Edge[]; height: number } {
  const stepMap = new Map(definition.steps.map((s) => [s.id, s]));

  // Steps whose branching is fully defined by verdicts — plain transitions from these steps
  // are routing implementation details and must not create extra branch buttons.
  const verdictSteps = new Set(
    definition.steps.filter((s) => s.verdicts && Object.keys(s.verdicts).length > 0).map((s) => s.id),
  );

  // Full adjacency (all transitions + all verdicts) — used for root detection and
  // allReachable, so collapsed-branch steps are correctly excluded from the orphan fallback.
  const fullTargets = new Set<string>();
  const fullOutgoing = new Map<string, string[]>();
  function addFull(from: string, to: string) {
    fullTargets.add(to);
    fullOutgoing.set(from, [...(fullOutgoing.get(from) ?? []), to]);
  }
  for (const t of definition.transitions) addFull(t.from, t.to);
  for (const step of definition.steps) {
    if (step.verdicts) {
      for (const verdict of Object.values(step.verdicts)) {
        if (verdict.target) addFull(step.id, verdict.target);
      }
    }
  }

  // Display outgoing: verdicts only for verdict-based steps; transitions for the rest.
  // Verdicts are processed first so their labels always win over duplicate transitions.
  const outgoing = new Map<string, { to: string; label: string | undefined }[]>();
  function addBranch(from: string, to: string, label?: string) {
    const arr = outgoing.get(from) ?? [];
    if (!arr.some((e) => e.to === to)) outgoing.set(from, [...arr, { to, label }]);
  }
  for (const step of definition.steps) {
    if (step.verdicts) {
      for (const [name, verdict] of Object.entries(step.verdicts)) {
        if (verdict.target) addBranch(step.id, verdict.target, name);
      }
    }
  }
  for (const t of definition.transitions) {
    if (!verdictSteps.has(t.from)) {
      addBranch(t.from, t.to, t.when ? `when: ${t.when}` : undefined);
    }
  }

  // Find roots using full adjacency (steps with no incoming edges in any path)
  const roots = definition.steps.filter((s) => !fullTargets.has(s.id));
  if (roots.length === 0 && definition.steps.length > 0) roots.push(definition.steps[0]);

  // Full reachability (no branch pruning, full graph) — used to exclude collapsed-branch
  // steps from the "disconnected steps" fallback at the end.
  const allReachable = new Set<string>(roots.map((r) => r.id));
  {
    const q = roots.map((r) => r.id);
    let i = 0;
    while (i < q.length) {
      const cur = q[i++];
      for (const to of fullOutgoing.get(cur) ?? []) {
        if (!allReachable.has(to)) { allReachable.add(to); q.push(to); }
      }
    }
  }

  // BFS with branch pruning → ordered layout items
  const layoutItems: LayoutItem[] = [];
  const visited = new Set<string>();
  const bfsQueue: string[] = roots.map((r) => r.id);
  for (const r of roots) visited.add(r.id);

  // Collected during BFS for edge building after node layout
  const decisionStepToNextStep: { stepId: string; nextStepId: string }[] = [];
  const decisionStepToBackTarget: { stepId: string; targetStepId: string }[] = [];
  const accordionSteps = new Set<string>();

  let head = 0;
  while (head < bfsQueue.length) {
    const current = bfsQueue[head++];

    const outs = outgoing.get(current) ?? [];
    if (outs.length <= 1) {
      layoutItems.push({ kind: 'step', stepId: current });
      for (const { to } of outs) {
        if (to && !visited.has(to)) { visited.add(to); bfsQueue.push(to); }
      }
    } else {
      // Multiple branches — render inline inside the step card, no separate placeholder nodes.
      accordionSteps.add(current);
      const forwardOuts = outs.filter(({ to }) => !visited.has(to));
      const backOuts = outs.filter(({ to }) => visited.has(to));
      const rawIdx = expandedBranches.get(current) ?? 0;
      const expandedIdx = rawIdx < forwardOuts.length ? rawIdx : 0;

      const branches: BranchInfo[] = [];

      // Back-edge (revise) branches displayed first so the right-out handle
      // and the orange arc always originate from the top branch row.
      for (let bi = 0; bi < backOuts.length; bi++) {
        const { to, label } = backOuts[bi];
        const backTargetName = to ? stepMap.get(to)?.name : undefined;
        branches.push({ branchIdx: forwardOuts.length + bi, label: shortenCondition(label) ?? `Revise`, isActive: false, isBackEdge: true, backTargetName });
        if (to) decisionStepToBackTarget.push({ stepId: current, targetStepId: to });
      }

      for (let fi = 0; fi < forwardOuts.length; fi++) {
        const { to, label } = forwardOuts[fi];
        const isActive = fi === expandedIdx;
        // branchIdx stays as the forwardOuts index so expandedBranches state is unaffected
        branches.push({ branchIdx: fi, label: shortenCondition(label) ?? `Branch ${fi + 1}`, isActive, isBackEdge: false });
        if (isActive) {
          if (to) decisionStepToNextStep.push({ stepId: current, nextStepId: to });
          if (to && !visited.has(to)) { visited.add(to); bfsQueue.push(to); }
        }
      }

      layoutItems.push({ kind: 'step', stepId: current, branches });
    }
  }

  // Append only truly disconnected steps (not reachable from any root via any branch).
  // Steps in collapsed branches are reachable but intentionally hidden — skip them.
  for (const step of definition.steps) {
    if (!visited.has(step.id) && !allReachable.has(step.id)) {
      layoutItems.push({ kind: 'step', stepId: step.id });
      visited.add(step.id);
    }
  }

  // Assign sequential positions — compound height for decision steps with branches
  const seqIdxMap = new Map<string, number>();
  const nodes: Node[] = [];
  let seqIdx = 0;
  let currentY = 0;

  for (const item of layoutItems) {
    const step = stepMap.get(item.stepId);
    const numBranches = item.branches?.length ?? 0;
    const nodeHeight = NODE_INNER_HEIGHT + numBranches * BRANCH_ROW_HEIGHT;
    if (!step) { seqIdx++; currentY += nodeHeight + ROW_GAP; continue; }
    seqIdxMap.set(step.id, seqIdx);
    nodes.push({
      id: step.id,
      type: 'step',
      position: { x: 0, y: currentY },
      data: {
        label: step.name,
        stepType: step.type,
        executor: step.executor,
        autonomyLevel: step.autonomyLevel,
        plugin: step.plugin,
        branches: item.branches,
      } as StepNodeData,
    });
    currentY += nodeHeight + ROW_GAP;
    seqIdx++;
  }

  // Build edges
  const edgeSet = new Set<string>();
  const edges: Edge[] = [];
  let backIdx = 0;

  function addEdge(from: string, to: string, label?: string) {
    const key = `${from}->${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);

    const fromSeq = seqIdxMap.get(from) ?? 0;
    const toSeq = seqIdxMap.get(to) ?? 0;
    const isBack = toSeq <= fromSeq;
    const idx = isBack ? backIdx++ : 0;
    const shortLabel = shortenCondition(label);

    edges.push({
      id: key,
      source: from,
      target: to,
      sourceHandle: isBack ? 'right-out' : 'bottom',
      targetHandle: isBack ? 'right-in' : 'top',
      label: shortLabel,
      type: 'smoothstep',
      ...(isBack ? { pathOptions: { offset: 40 + idx * 36, borderRadius: 16 } } : {}),
      style: {
        stroke: isBack ? COLORS.back.stroke : COLORS.forward.stroke,
        strokeWidth: isBack ? 1.5 : 2,
        strokeDasharray: isBack ? '5 4' : undefined,
      },
      labelBgStyle: { fill: 'white', fillOpacity: 0.85 },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 4,
      labelStyle: { fontSize: 11, fontWeight: 500, fill: isBack ? COLORS.label.back : COLORS.label.forward },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: isBack ? COLORS.back.arrow : COLORS.forward.arrow },
    });
  }

  // Decision step → first step of active branch (direct, no intermediate placeholder)
  for (const { stepId, nextStepId } of decisionStepToNextStep) {
    if (seqIdxMap.has(stepId) && seqIdxMap.has(nextStepId)) {
      addEdge(stepId, nextStepId);
    }
  }

  // Decision step → back-edge target (amber arc from step's right-out to target's right-in)
  for (const { stepId, targetStepId } of decisionStepToBackTarget) {
    if (seqIdxMap.has(stepId) && seqIdxMap.has(targetStepId)) {
      addEdge(stepId, targetStepId);
    }
  }

  // Edges from definition.transitions (skip accordion steps — handled via branch buttons)
  for (const t of definition.transitions) {
    if (!seqIdxMap.has(t.from) || !seqIdxMap.has(t.to)) continue;
    if (accordionSteps.has(t.from)) continue;
    addEdge(t.from, t.to, t.when ? `when: ${t.when}` : undefined);
  }

  // Edges from verdicts (skip accordion steps — handled via branch buttons)
  for (const step of definition.steps) {
    if (!seqIdxMap.has(step.id) || !step.verdicts) continue;
    if (accordionSteps.has(step.id)) continue;
    for (const [name, verdict] of Object.entries(step.verdicts)) {
      if (!verdict.target || !seqIdxMap.has(verdict.target)) continue;
      addEdge(step.id, verdict.target, name);
    }
  }

  return { nodes, edges, height: currentY + 40 };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface WorkflowDiagramProps {
  definition: WorkflowDefinition;
  className?: string;
  style?: React.CSSProperties;
  onNodeClick?: (stepId: string) => void;
  onNodeDelete?: (stepId: string) => void;
  onNodeMoveUp?: (stepId: string) => void;
  onNodeMoveDown?: (stepId: string) => void;
  onEdgeAdd?: (fromStepId: string, payload: NewStepPayload, toStepId: string) => void;
  onPaneClick?: () => void;
  selectedStepId?: string | null;
  errorStepIds?: Set<string>;
  warningStepIds?: Map<string, string>;
  canMoveUp?: Set<string>;
  canMoveDown?: Set<string>;
}

export function WorkflowDiagram({ definition, className, style, onNodeClick, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onEdgeAdd, onPaneClick, selectedStepId, errorStepIds, warningStepIds, canMoveUp, canMoveDown }: WorkflowDiagramProps) {
  const [expandedBranches, setExpandedBranches] = useState<Map<string, number>>(new Map());
  const [popover, setPopover] = useState<{
    pos: { top: number; left: number };
    onAdd: (payload: NewStepPayload) => void;
    edgeId: string;
  } | null>(null);
  const [pendingType, setPendingType] = useState<'creation' | 'decision'>('creation');
  const popoverRef = useRef<HTMLDivElement>(null);

  const resetWizard = useCallback(() => {
    setPendingType('creation');
  }, []);

  useEffect(() => {
    setExpandedBranches(new Map());
  }, [definition]);

  useEffect(() => {
    if (!popover) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as HTMLElement)) {
        setPopover(null);
        resetWizard();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [popover, resetWizard]);

  const handleOpenPopover = useCallback((edgeId: string, pos: { top: number; left: number }, onAdd: (payload: NewStepPayload) => void) => {
    setPopover({ pos, onAdd, edgeId });
    resetWizard();
  }, [resetWizard]);

  const handleClosePopover = useCallback(() => {
    setPopover(null);
    resetWizard();
  }, [resetWizard]);

  const { nodes: layoutNodes, edges: layoutEdges, height } = useMemo(
    () => buildLayout(definition, expandedBranches),
    [definition, expandedBranches],
  );

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const styledNodes = layoutNodes.map((n) => {
      const d = n.data as StepNodeData;
      return {
        ...n,
        selected: n.id === selectedStepId,
        data: {
          ...d,
          hasError: errorStepIds?.has(n.id) ?? false,
          hasWarning: warningStepIds?.has(n.id) ?? false,
          warningTooltip: warningStepIds?.get(n.id),
          onDelete: onNodeDelete && d.stepType !== 'terminal' ? () => onNodeDelete(n.id) : undefined,
          onMoveUp: onNodeMoveUp && canMoveUp?.has(n.id) ? () => onNodeMoveUp(n.id) : undefined,
          onMoveDown: onNodeMoveDown && canMoveDown?.has(n.id) ? () => onNodeMoveDown(n.id) : undefined,
          branches: d.branches?.map((branch) => ({
            ...branch,
            onExpand: !branch.isBackEdge && !branch.isActive
              ? () => setExpandedBranches((prev) => {
                  const next = new Map(prev);
                  next.set(n.id, branch.branchIdx);
                  return next;
                })
              : undefined,
          })),
        },
      };
    });
    const styledEdges: Edge[] = layoutEdges.map((e) => {
      const isForward = e.sourceHandle !== 'right-out';
      if (isForward && onEdgeAdd) {
        return {
          ...e,
          type: 'addStep',
          data: {
            onAdd: (payload: NewStepPayload) => onEdgeAdd(e.source, payload, e.target),
            onOpenPopover: (pos: { top: number; left: number }, onAdd: (payload: NewStepPayload) => void) => handleOpenPopover(e.id, pos, onAdd),
            onClosePopover: handleClosePopover,
            popoverEdgeId: popover?.edgeId ?? null,
            edgeId: e.id,
          } satisfies AddStepEdgeData,
        };
      }
      return e;
    });
    return { nodes: styledNodes as Node[], edges: styledEdges };
  }, [layoutNodes, layoutEdges, selectedStepId, errorStepIds, warningStepIds, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onEdgeAdd, canMoveUp, canMoveDown, handleOpenPopover, handleClosePopover, popover?.edgeId]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<StepNodeData>) => {
      if (node.data?.stepType !== 'terminal') onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  return (
    <ReactFlowProvider>
      <div
        className={cn('rounded-lg', className)}
        style={{ width: '100%', height: `${Math.max(360, height)}px`, ...style }}
      >
        <ReactFlow
          nodes={nodes as Node<StepNodeData>[]}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          onNodeClick={handleNodeClick}
          onPaneClick={onPaneClick}
          defaultViewport={{ x: 16, y: 16, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      {popover && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: popover.pos.top,
            left: popover.pos.left,
            transform: 'translateX(-50%)',
            zIndex: 9999,
          }}
          className="bg-background border rounded-xl shadow-xl p-3 w-[500px] space-y-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Add new step</p>

          {/* Section 1: step type */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">What do you want to do in this step?</p>
            <div className="flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setPendingType('creation'); }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold border transition-all whitespace-nowrap',
                  pendingType === 'creation'
                    ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
                    : 'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 hover:ring-1 hover:ring-blue-300 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 dark:hover:ring-blue-700',
                )}
              >
                <PenLine className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                Create new result
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setPendingType('decision'); }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold border transition-all whitespace-nowrap',
                  pendingType === 'decision'
                    ? 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700'
                    : 'hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 hover:ring-1 hover:ring-purple-300 dark:hover:bg-purple-900/20 dark:hover:text-purple-300 dark:hover:ring-purple-700',
                )}
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                Make a decision
              </button>
            </div>
          </div>

          {/* Section 2: executor — one row per Control Mode */}
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">Who executes this step?</p>

            {/* CM0 */}
            <div className="flex items-center gap-3 rounded-lg border border-border/40 px-2.5 py-1.5">
              <span className="w-14 shrink-0 flex items-center">
                <User className="h-4 w-4 text-orange-400 dark:text-orange-500" />
              </span>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); popover.onAdd({ type: pendingType, executor: 'human' }); setPopover(null); }}
                  className="inline-flex items-center gap-1 rounded-md py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap hover:bg-orange-50 hover:text-orange-700 hover:border-orange-400 hover:ring-1 hover:ring-orange-200 dark:hover:bg-orange-950/20 dark:hover:text-orange-300 dark:hover:border-orange-500 dark:hover:ring-orange-800"
                >
                  <User className="h-3 w-3 shrink-0" />Human
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); popover.onAdd({ type: pendingType, executor: 'script' }); setPopover(null); }}
                  className="inline-flex items-center gap-1 rounded-md py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap hover:bg-yellow-50 hover:text-yellow-700 hover:border-yellow-400 hover:ring-1 hover:ring-yellow-200 dark:hover:bg-yellow-950/20 dark:hover:text-yellow-300 dark:hover:border-yellow-500 dark:hover:ring-yellow-800"
                >
                  <Terminal className="h-3 w-3 shrink-0" />Script
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); popover.onAdd({ type: pendingType, executor: 'action' }); setPopover(null); }}
                  className="inline-flex items-center gap-1 rounded-md py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap hover:bg-pink-50 hover:text-pink-700 hover:border-pink-400 hover:ring-1 hover:ring-pink-200 dark:hover:bg-pink-950/20 dark:hover:text-pink-300 dark:hover:border-pink-500 dark:hover:ring-pink-800"
                >
                  <Zap className="h-3 w-3 shrink-0" />Action
                </button>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">No AI involved</span>
            </div>

            {/* CM1: Assist — disabled, coming soon */}
            <div className="flex items-center gap-3 rounded-lg border border-border/40 px-2.5 py-1.5 opacity-50">
              <span className="w-14 shrink-0 flex items-center gap-0.5">
                <User className="h-4 w-4 text-lime-500 dark:text-lime-400 shrink-0" />
                <span className="relative inline-flex shrink-0">
                  <Bot className="h-4 w-4 text-lime-500 dark:text-lime-400" />
                  <Search className="absolute -bottom-0.5 -right-1.5 h-2.5 w-2.5 text-lime-500 dark:text-lime-400" strokeWidth={2.5} />
                </span>
              </span>
              <button disabled className="w-36 text-left rounded-md py-1 px-2.5 text-xs font-semibold border cursor-not-allowed whitespace-nowrap shrink-0">
                Assist
              </button>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Human executes, AI reviews — <em>coming soon</em></span>
            </div>

            {/* CM2: Cowork */}
            <div className="flex items-center gap-3 rounded-lg border border-border/40 px-2.5 py-1.5">
              <span className="w-14 shrink-0 flex items-center gap-0.5">
                <User className="h-4 w-4 text-teal-500 dark:text-teal-400 shrink-0" />
                <Bot className="h-4 w-4 text-teal-500 dark:text-teal-400 shrink-0" />
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  popover.onAdd({ type: pendingType, executor: 'cowork', cowork: { agent: 'chat' } });
                  setPopover(null);
                }}
                className="w-36 text-left rounded-md py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap shrink-0 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-400 hover:ring-1 hover:ring-teal-200 dark:hover:bg-teal-900/20 dark:hover:text-teal-300 dark:hover:border-teal-600 dark:hover:ring-teal-800"
              >
                Cowork
              </button>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Human and AI collaborate in real time</span>
            </div>

            {/* CM3: Human review */}
            <div className="flex items-center gap-3 rounded-lg border border-border/40 px-2.5 py-1.5">
              <span className="w-14 shrink-0 flex items-center gap-0.5">
                <Bot className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                <span className="relative inline-flex shrink-0">
                  <User className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                  <Search className="absolute -bottom-0.5 -right-1.5 h-2.5 w-2.5 text-indigo-500 dark:text-indigo-400" strokeWidth={2.5} />
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  popover.onAdd({ type: pendingType, executor: 'agent', autonomyLevel: 'L3' });
                  setPopover(null);
                }}
                className="w-36 text-left rounded-md py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap shrink-0 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-400 hover:ring-1 hover:ring-indigo-200 dark:hover:bg-indigo-950/20 dark:hover:text-indigo-300 dark:hover:border-indigo-500 dark:hover:ring-indigo-800"
              >
                Human review
              </button>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">AI executes, human reviews before proceeding</span>
            </div>

            {/* CM4: Autonomous agent */}
            <div className="flex items-center gap-3 rounded-lg border border-border/40 px-2.5 py-1.5">
              <span className="w-14 shrink-0 flex items-center">
                <Bot className="h-4 w-4 text-violet-500 dark:text-violet-400" />
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  popover.onAdd({ type: pendingType, executor: 'agent', autonomyLevel: 'L4' });
                  setPopover(null);
                }}
                className="w-36 text-left rounded-md py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap shrink-0 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-400 hover:ring-1 hover:ring-violet-200 dark:hover:bg-violet-950/20 dark:hover:text-violet-300 dark:hover:border-violet-500 dark:hover:ring-violet-800"
              >
                Autonomous agent
              </button>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">AI executes without waiting for human review</span>
            </div>

          </div>
        </div>,
        document.body,
      )}
    </ReactFlowProvider>
  );
}
