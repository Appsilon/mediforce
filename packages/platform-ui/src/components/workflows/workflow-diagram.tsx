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
import { User, Bot, Terminal, Trash2, Plus, Search, ArrowUp, ArrowDown, ArrowRight, AlertTriangle, Zap, Wand2, Undo2, Redo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import {
  getControlMode,
  CONTROL_MODE_LABELS,
  type ControlMode,
  type NewStepPayload,
} from '@/lib/control-mode';
import { computeGraphLayout, placeNewNodes, NODE_WIDTH, type GraphEdge } from './workflow-graph-layout';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLORS = {
  forward: { stroke: '#cbd5e1', arrow: '#94a3b8' },
  back: { stroke: '#f59e0b', arrow: '#d97706' },
  label: { forward: '#64748b', back: '#b45309' },
} as const;

export const STEP_STYLES: Record<string, { bg: string; border: string; activeBorder: string; activeRing: string }> = {
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

export const STEP_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  creation: { label: 'Creation', color: 'text-blue-500 dark:text-blue-400' },
  review:   { label: 'Review',   color: 'text-amber-500 dark:text-amber-400' },
  decision: { label: 'Decision', color: 'text-purple-500 dark:text-purple-400' },
  terminal: { label: 'End',      color: 'text-emerald-500 dark:text-emerald-400' },
};

// ---------------------------------------------------------------------------
// Custom nodes
// ---------------------------------------------------------------------------

export function ExecutorIcon({ executor, autonomyLevel }: { executor: string; autonomyLevel?: string }) {
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

export function getExecutorLabel(executor: string, mode: ControlMode): string {
  if (executor === 'human') return 'Human';
  if (executor === 'script') return 'Script';
  if (executor === 'action') return 'Action';
  return CONTROL_MODE_LABELS[mode];
}

/** One row per loop the step can take, naming where the amber arc lands.
 *  Forward paths need no row — they are drawn as labelled edges. */
type BackBranch = {
  label: string;
  targetName?: string;
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
  backBranches?: BackBranch[];
};

const NODE_INNER_HEIGHT = 85;
const TERMINAL_HEIGHT = 64;
const BRANCH_ROW_HEIGHT = 32;

function stepNodeHeight(stepType: string, backBranchCount: number): number {
  if (stepType === 'terminal') return TERMINAL_HEIGHT;
  return NODE_INNER_HEIGHT + backBranchCount * BRANCH_ROW_HEIGHT;
}

function nodeHeight(node: Node): number {
  const data = node.data as StepNodeData;
  return stepNodeHeight(data.stepType, data.backBranches?.length ?? 0);
}

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

  // Anchor the right-out handle to the first loop row, so the amber arc leaves
  // the card next to the row that names where it goes. branchSectionTop is measured.
  const rightOutTop = data.backBranches?.length
    ? branchSectionTop + BRANCH_ROW_HEIGHT / 2
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
          data.backBranches?.length ? 'pb-0' : 'pb-3',
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

        {data.backBranches && data.backBranches.length > 0 && (
          <div ref={branchSectionRef} className="-mx-4 mt-3 border-t border-border/40">
            {data.backBranches.map((branch, i) => (
              <div
                key={branch.label}
                title={branch.targetName ? `Loops back to ${branch.targetName}` : undefined}
                style={{ height: BRANCH_ROW_HEIGHT }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 text-left text-[11px]',
                  'bg-slate-50/60 text-slate-500 dark:bg-slate-800/30 dark:text-slate-400',
                  i < data.backBranches!.length - 1 && 'border-b border-border/20',
                )}
              >
                <span className="truncate flex-1">{branch.label}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" />
              </div>
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
// Layout engine — layered, every path placed
// ---------------------------------------------------------------------------

function shortenCondition(raw: string | undefined): string | undefined {
  return raw
    ?.replace(/^when:\s*/, '')
    .replace(/output\./g, '')
    .replace(/\s*==\s*/g, ' = ');
}

/** Every path a step can take, in the order the definition declares them.
 *  Verdicts win over a plain transition to the same target, because the verdict
 *  carries the label a reader recognises. */
export function graphEdgesOf(definition: WorkflowDefinition): GraphEdge[] {
  // A step whose branching is defined by verdicts also carries plain transitions
  // to the same targets — routing detail that would duplicate the verdict edges.
  const verdictSteps = new Set(
    definition.steps.filter((s) => s.verdicts && Object.keys(s.verdicts).length > 0).map((s) => s.id),
  );

  const edges: GraphEdge[] = [];
  const byKey = new Map<string, GraphEdge>();
  // Labels per arrow are kept as whole names, never matched as substrings — with
  // `approve_only` and `approve` on the same target, a substring test would drop
  // one of the two paths the shared arrow is supposed to name.
  const labelsByKey = new Map<string, string[]>();
  function add(from: string, to: string, label?: string) {
    const key = `${from}->${to}`;
    const labels = labelsByKey.get(key) ?? [];
    if (label !== undefined && labels.includes(label) === false) labels.push(label);
    labelsByKey.set(key, labels);

    // Two verdicts landing on the same step share one arrow — name both on it.
    const joined = labels.length > 0 ? labels.join(' / ') : undefined;
    const existing = byKey.get(key);
    if (existing) {
      existing.label = joined;
      return;
    }
    const edge = { from, to, label: joined };
    byKey.set(key, edge);
    edges.push(edge);
  }

  for (const step of definition.steps) {
    if (!step.verdicts) continue;
    for (const [name, verdict] of Object.entries(step.verdicts)) {
      if (verdict.target) add(step.id, verdict.target, name);
    }
  }
  for (const t of definition.transitions) {
    if (verdictSteps.has(t.from)) continue;
    add(t.from, t.to, t.when ? `when: ${t.when}` : undefined);
  }
  return edges;
}

function buildLayout(definition: WorkflowDefinition): { nodes: Node[]; edges: Edge[]; height: number } {
  const stepMap = new Map(definition.steps.map((s) => [s.id, s]));
  const graphEdges = graphEdgesOf(definition);

  const layout = computeGraphLayout(
    definition.steps.map((s) => s.id),
    graphEdges,
    (stepId, outgoingBackEdges) => stepNodeHeight(stepMap.get(stepId)?.type ?? 'creation', outgoingBackEdges),
  );

  const backBranchesByStep = new Map<string, BackBranch[]>();
  for (const edge of layout.edges) {
    if (edge.isBack === false) continue;
    backBranchesByStep.set(edge.from, [
      ...(backBranchesByStep.get(edge.from) ?? []),
      { label: shortenCondition(edge.label) ?? 'Revise', targetName: stepMap.get(edge.to)?.name },
    ]);
  }

  const nodes: Node[] = [];
  for (const stepId of layout.order) {
    const step = stepMap.get(stepId);
    const position = layout.positions.get(stepId);
    if (!step || !position) continue;
    nodes.push({
      id: step.id,
      type: 'step',
      position,
      data: {
        label: step.name,
        stepType: step.type,
        executor: step.executor,
        autonomyLevel: step.autonomyLevel,
        plugin: step.plugin,
        backBranches: backBranchesByStep.get(step.id),
      } as StepNodeData,
    });
  }

  // Back edges arc off the right-hand side; each gets its own offset so several
  // loops out of the same region stay readable instead of overlapping.
  let backIdx = 0;
  const edges: Edge[] = layout.edges.map((edge) => {
    const isBack = edge.isBack;
    const offsetIdx = isBack ? backIdx++ : 0;
    return {
      id: `${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: isBack ? 'right-out' : 'bottom',
      targetHandle: isBack ? 'right-in' : 'top',
      label: isBack ? undefined : shortenCondition(edge.label),
      type: 'smoothstep',
      ...(isBack ? { pathOptions: { offset: 40 + offsetIdx * 36, borderRadius: 16 } } : {}),
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
    };
  });

  return { nodes, edges, height: layout.height };
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
  const { nodes: layoutNodes, edges: layoutEdges, height } = useMemo(
    () => buildLayout(definition),
    [definition],
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
      const anchored = (nodes: Node[]) => nodes.map((n) => ({ id: n.id, position: n.position, height: nodeHeight(n) }));
      const positioned = placeNewNodes(
        anchored(prev),
        anchored(computedNodes),
        layoutEdges
          .filter((e) => e.sourceHandle !== 'right-out')
          .map((e) => ({ from: e.source, to: e.target })),
      );
      return computedNodes.map((n) => {
        const position = positioned.get(n.id);
        return position ? { ...n, position } : n;
      });
    });
  }, [computedNodes, layoutEdges]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setLocalNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // Tidy up = throw away the dragged positions and re-run the canonical layout,
  // so the canvas snaps back to the same shape a freshly opened workflow has.
  const handleTidy = useCallback(() => {
    const layout = computeGraphLayout(
      localNodes.map((n) => n.id),
      layoutEdges.map((e) => ({ from: e.source, to: e.target })),
      (nodeId) => {
        const node = localNodes.find((n) => n.id === nodeId);
        return node ? nodeHeight(node) : NODE_INNER_HEIGHT;
      },
    );
    setLocalNodes((prev) => prev.map((n) => {
      const position = layout.positions.get(n.id);
      return position ? { ...n, position } : n;
    }));
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
  const hasEditableSteps = localNodes.some((node) => (node.data as StepNodeData).stepType !== 'terminal');

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
        minZoom={0.2}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.95 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="!bg-white dark:!bg-background" />
        {!hasEditableSteps && onAddBlock && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <button
              onClick={() => {
                onAddBlock();
                setTimeout(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }), 60);
              }}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-white/90 px-4 py-2.5 text-sm font-medium text-primary shadow-sm transition-colors hover:border-primary hover:bg-primary/5 dark:bg-background/90"
              aria-label="Add step here"
            >
              <Plus className="h-4 w-4" />
              Add your first step
            </button>
          </div>
        )}
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
