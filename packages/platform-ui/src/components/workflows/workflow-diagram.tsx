'use client';

import React, { useMemo, useCallback, useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Background,
  BackgroundVariant,
  useReactFlow,
  useStore,
  applyNodeChanges,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeProps,
  type NodeChange,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { User, Bot, Terminal, Trash2, Plus, Search, ArrowUp, ArrowDown, ArrowRight, ChevronRight, ChevronDown, AlertTriangle, Zap, Eye, EyeOff, Wand2, Undo2, Redo2 } from 'lucide-react';
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
        <span className="relative inline-flex shrink-0 mr-2">
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
          'group rounded-xl border-[1.5px] px-4 pt-3 transition-shadow cursor-pointer relative overflow-hidden',
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

        {/* Row 1: executor identity + step type, separated by a dot */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-1 min-w-0 shrink-0">
            <ExecutorIcon executor={data.executor} autonomyLevel={data.autonomyLevel} />
            <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
              {getExecutorLabel(data.executor, mode)}
            </span>
          </div>
          <span className="text-muted-foreground/40 text-[10px] shrink-0">&middot;</span>
          <span className={cn('text-[10px] font-semibold truncate', typeConfig.color)}>
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
  onRequestAdd?: () => void;
};

function AddStepEdge({
  id,
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  style, markerEnd,
  label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius,
  data,
}: EdgeProps & { data?: AddStepEdgeData }) {
  const { fitView } = useReactFlow();
  const [path, midX, midY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        label={label}
        labelX={midX}
        labelY={data?.onRequestAdd && label ? midY - 16 : midY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        labelShowBg={true}
      />
      {data?.onRequestAdd && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onRequestAdd?.();
                setTimeout(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }), 60);
              }}
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
// Canvas controls — horizontal pill, replaces built-in Controls
// ---------------------------------------------------------------------------

type CanvasControlsProps = {
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onAddBlock?: () => void;
  addBlockActive?: boolean;
  onTidy?: () => void;
};

function CanvasControls({ onUndo, onRedo, canUndo, canRedo, onAddBlock, addBlockActive, onTidy }: CanvasControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-white dark:bg-background border border-border/60 rounded-xl shadow-sm px-1.5 py-1.5 z-10 whitespace-nowrap">
      {(onUndo || onRedo) && (
        <>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo last change (Ctrl+Z)"
            className={cn(
              'h-7 w-7 flex items-center justify-center rounded-lg transition-colors',
              canUndo ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'text-muted-foreground/30 cursor-not-allowed',
            )}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo last change (Ctrl+Shift+Z)"
            className={cn(
              'h-7 w-7 flex items-center justify-center rounded-lg transition-colors',
              canRedo ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'text-muted-foreground/30 cursor-not-allowed',
            )}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-border mx-1" />
        </>
      )}
      <button
        onClick={() => zoomOut()}
        className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-base font-medium leading-none"
        aria-label="Zoom out"
      >
        −
      </button>
      <span className="text-[11px] font-medium text-muted-foreground tabular-nums w-10 text-center select-none">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => zoomIn()}
        className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-base font-medium leading-none"
        aria-label="Zoom in"
      >
        +
      </button>
      <div className="w-px h-4 bg-border mx-1" />
      <button
        onClick={() => {
          onTidy?.();
          setTimeout(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }), 60);
        }}
        className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Tidy up"
        title="Tidy up"
      >
        <Wand2 className="h-3.5 w-3.5" />
      </button>
      {onAddBlock && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            onClick={() => {
              onAddBlock?.();
              setTimeout(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }), 60);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 h-7 text-sm font-medium transition-colors shrink-0 whitespace-nowrap',
              addBlockActive
                ? 'bg-foreground text-background'
                : 'bg-foreground text-background hover:bg-foreground/90',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Block
          </button>
        </>
      )}
    </div>
  );
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
  onRequestAddStep?: (fromStepId: string, toStepId: string) => void;
  onPaneClick?: () => void;
  selectedStepId?: string | null;
  errorStepIds?: Set<string>;
  warningStepIds?: Map<string, string>;
  canMoveUp?: Set<string>;
  canMoveDown?: Set<string>;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onAddBlock?: () => void;
  addBlockActive?: boolean;
}

export function WorkflowDiagram({ definition, className, style, onNodeClick, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onRequestAddStep, onPaneClick, selectedStepId, errorStepIds, warningStepIds, canMoveUp, canMoveDown, onUndo, onRedo, canUndo, canRedo, onAddBlock, addBlockActive }: WorkflowDiagramProps) {
  const [expandedBranches, setExpandedBranches] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    setExpandedBranches(new Map());
  }, [definition]);

  const { nodes: layoutNodes, edges: layoutEdges, height } = useMemo(
    () => buildLayout(definition, expandedBranches),
    [definition, expandedBranches],
  );

  const { nodes: computedNodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
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
      if (isForward && onRequestAddStep) {
        return {
          ...e,
          type: 'addStep',
          data: {
            onRequestAdd: () => onRequestAddStep(e.source, e.target),
          } satisfies AddStepEdgeData,
        };
      }
      return e;
    });
    return { nodes: styledNodes as Node[], edges: styledEdges };
  }, [layoutNodes, layoutEdges, selectedStepId, errorStepIds, warningStepIds, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onRequestAddStep, canMoveUp, canMoveDown]);

  // Controlled node state, lazily seeded from computedNodes so XYFlow never sees an
  // empty array on first render (an empty seed would throw XYFlow error #015 on drag).
  const [localNodes, setLocalNodes] = useState<Node[]>(() => computedNodes);

  // Re-sync when the underlying definition/styling changes, but keep whatever
  // position the user has dragged each node to. Brand-new nodes get anchored
  // below their actual (possibly dragged) parent position instead of
  // buildLayout's from-scratch coordinates, and any existing downstream node
  // (most commonly the terminal/"Done" step) gets pushed further down if the
  // new node would otherwise land on top of it.
  useEffect(() => {
    setLocalNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));

      const forwardEdges = layoutEdges.filter((e) => e.sourceHandle !== 'right-out');
      const parentOf = new Map<string, string[]>();
      const childOf = new Map<string, string[]>();
      for (const e of forwardEdges) {
        parentOf.set(e.target, [...(parentOf.get(e.target) ?? []), e.source]);
        childOf.set(e.source, [...(childOf.get(e.source) ?? []), e.target]);
      }

      const heightById = new Map(computedNodes.map((n) => {
        const d = n.data as StepNodeData;
        const numBranches = d.branches?.length ?? 0;
        const h = d.stepType === 'terminal' ? 64 : NODE_INNER_HEIGHT + numBranches * BRANCH_ROW_HEIGHT;
        return [n.id, h];
      }));

      const positioned = new Map<string, { x: number; y: number }>();
      for (const n of prev) positioned.set(n.id, n.position);

      const newIds = computedNodes.filter((n) => !prevById.has(n.id)).map((n) => n.id);
      for (const id of newIds) {
        const parents = parentOf.get(id) ?? [];
        const parentPos = parents.length === 1 ? positioned.get(parents[0]) : undefined;
        if (parentPos) {
          const parentHeight = heightById.get(parents[0]) ?? NODE_INNER_HEIGHT;
          positioned.set(id, { x: parentPos.x, y: parentPos.y + parentHeight + ROW_GAP });
        } else {
          const fresh = computedNodes.find((n) => n.id === id);
          if (fresh) positioned.set(id, fresh.position);
        }
      }

      // Push existing downstream nodes (e.g. the terminal step) out of the way
      // if a newly-placed node now overlaps them.
      for (const id of newIds) {
        const newPos = positioned.get(id);
        if (!newPos) continue;
        const newBottom = newPos.y + (heightById.get(id) ?? NODE_INNER_HEIGHT);
        for (const childId of childOf.get(id) ?? []) {
          if (!prevById.has(childId)) continue;
          const childPos = positioned.get(childId);
          if (!childPos) continue;
          const requiredY = newBottom + ROW_GAP;
          if (childPos.y < requiredY) {
            positioned.set(childId, { ...childPos, y: requiredY });
          }
        }
      }

      return computedNodes.map((n) => {
        const pos = positioned.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
    });
  }, [computedNodes, layoutEdges]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setLocalNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // Layered auto-layout: groups nodes into depth levels (via forward edges only),
  // then spaces each level evenly — vertically by the tallest node in the level,
  // horizontally by a fixed node-width + gap — so nothing overlaps. Within a level,
  // nodes are ordered/centered by their parents' x so simple chains stay straight.
  const handleTidy = useCallback(() => {
    const NODE_H_GAP = 40;

    const forwardEdges = layoutEdges.filter((e) => e.sourceHandle !== 'right-out');
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const e of forwardEdges) {
      incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
      outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
    }

    const allIds = localNodes.map((n) => n.id);
    const heightById = new Map(localNodes.map((n) => {
      const d = n.data as StepNodeData;
      const numBranches = d.branches?.length ?? 0;
      const h = d.stepType === 'terminal' ? 64 : NODE_INNER_HEIGHT + numBranches * BRANCH_ROW_HEIGHT;
      return [n.id, h];
    }));

    // Depth = longest path from any root, computed via Kahn's algorithm so a
    // node's depth is only finalized once every parent has been processed.
    const depth = new Map<string, number>();
    const roots = allIds.filter((id) => !incoming.has(id));
    for (const r of roots) depth.set(r, 0);
    const indegree = new Map(allIds.map((id) => [id, (incoming.get(id) ?? []).length]));
    const queue = [...roots];
    const queued = new Set(roots);
    while (queue.length) {
      const current = queue.shift()!;
      for (const child of outgoing.get(current) ?? []) {
        depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(current) ?? 0) + 1));
        indegree.set(child, (indegree.get(child) ?? 1) - 1);
        if ((indegree.get(child) ?? 0) <= 0 && !queued.has(child)) {
          queued.add(child);
          queue.push(child);
        }
      }
    }
    for (const id of allIds) if (!depth.has(id)) depth.set(id, 0);

    const levels = new Map<number, string[]>();
    for (const id of allIds) {
      const d = depth.get(id) ?? 0;
      levels.set(d, [...(levels.get(d) ?? []), id]);
    }
    const maxDepth = Math.max(0, ...levels.keys());

    // Vertical position per level, based on the tallest node in each level.
    const yByLevel = new Map<number, number>();
    let cumulativeY = 0;
    for (let d = 0; d <= maxDepth; d++) {
      yByLevel.set(d, cumulativeY);
      const ids = levels.get(d) ?? [];
      const maxH = Math.max(NODE_INNER_HEIGHT, ...ids.map((id) => heightById.get(id) ?? NODE_INNER_HEIGHT));
      cumulativeY += maxH + ROW_GAP;
    }

    const posById = new Map(localNodes.map((n) => [n.id, { ...n.position }]));

    // Horizontal position per level: order siblings by their parents' average x
    // (keeping chains visually aligned), then space them evenly so none overlap.
    for (let d = 0; d <= maxDepth; d++) {
      const ids = levels.get(d) ?? [];
      const targets = ids.map((id) => {
        const parents = incoming.get(id) ?? [];
        const x = parents.length > 0
          ? parents.reduce((sum, p) => sum + (posById.get(p)?.x ?? 0), 0) / parents.length
          : posById.get(id)?.x ?? 0;
        return { id, x };
      });
      targets.sort((a, b) => a.x - b.x);
      const gap = NODE_WIDTH + NODE_H_GAP;
      const avgTarget = targets.reduce((sum, t) => sum + t.x, 0) / targets.length;
      const startX = avgTarget - ((targets.length - 1) * gap) / 2;
      targets.forEach((t, i) => {
        posById.set(t.id, { x: startX + i * gap, y: yByLevel.get(d)! });
      });
    }

    setLocalNodes((prev) => prev.map((n) => (posById.has(n.id) ? { ...n, position: posById.get(n.id)! } : n)));
  }, [layoutEdges, localNodes]);

  return (
    <ReactFlowProvider>
      <FlowCanvas
        className={className}
        style={style}
        height={height}
        localNodes={localNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onAddBlock={onAddBlock}
        addBlockActive={addBlockActive}
        onTidy={handleTidy}
      />
    </ReactFlowProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner canvas — rendered inside ReactFlowProvider so it can call useReactFlow
// (needed to recenter the viewport after a node selection changes the layout).
// ---------------------------------------------------------------------------

type FlowCanvasProps = {
  className?: string;
  style?: React.CSSProperties;
  height: number;
  localNodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeClick?: (stepId: string) => void;
  onPaneClick?: () => void;
} & CanvasControlsProps;

function FlowCanvas({ className, style, height, localNodes, edges, onNodesChange, onNodeClick, onPaneClick, onUndo, onRedo, canUndo, canRedo, onAddBlock, addBlockActive, onTidy }: FlowCanvasProps) {
  const { fitView } = useReactFlow();

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<StepNodeData>) => {
      if (node.data?.stepType === 'terminal') return;
      onNodeClick?.(node.id);
      // Let the settings pane mount/resize the canvas first, then recenter.
      setTimeout(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }), 60);
    },
    [onNodeClick, fitView],
  );

  return (
    <div
      className={cn('rounded-lg', className)}
      style={{ width: '100%', height: `${Math.max(360, height)}px`, ...style }}
    >
      <ReactFlow
        nodes={localNodes as Node<StepNodeData>[]}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        preventScrolling={true}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ minZoom: 0.95, maxZoom: 0.95 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="!bg-white dark:!bg-background" />
        <CanvasControls
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onAddBlock={onAddBlock}
          addBlockActive={addBlockActive}
          onTidy={onTidy}
        />
      </ReactFlow>
    </div>
  );
}
