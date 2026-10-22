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
import { User, Bot, Terminal, Trash2, Plus, Search, ArrowUp, ArrowDown, ArrowRight, AlertTriangle, Zap, Wand2, Undo2, Redo2, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { StepExecutionStatus, WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import type { StepValidation } from '@mediforce/platform-api/contract';
import { VALIDATION_STATUS } from '@/components/evaluation/validation-status';
import {
  getControlMode,
  CONTROL_MODE_LABELS,
  type ControlMode,
  type NewStepPayload,
} from '@/lib/control-mode';
import { computeGraphLayout, makeRoomForResized, placeNewNodes, edgeIdOf, NODE_WIDTH, type GraphEdge } from './workflow-graph-layout';
import { childWorkflowTargetOf, type ChildWorkflowExpansion, type ExpandedChildWorkflow } from '@/lib/child-workflow';
import { routes } from '@/lib/routes';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLORS = {
  forward: { stroke: '#cbd5e1', arrow: '#94a3b8' },
  back: { stroke: '#f59e0b', arrow: '#d97706' },
  label: { forward: '#64748b', back: '#b45309' },
  replay: { ball: '#2563eb' },
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

/** An agent step's evaluation in the version shown: its validation, and where the Evaluation tab opens on it. */
export interface StepEvaluationMark {
  status: StepValidation['status'];
  title: string;
  href: string;
}

/** An expanded step's child workflow, sized for the frame drawn under its card. */
type ChildFrame = ExpandedChildWorkflow & { width: number; height: number };

type StepNodeData = {
  label: string;
  stepType: string;
  executor: string;
  autonomyLevel?: string;
  plugin?: string;
  hasError?: boolean;
  hasWarning?: boolean;
  warningTooltip?: string;
  evaluation?: StepEvaluationMark;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  backBranches?: BackBranch[];
  /** Starts a child workflow the card can open — it carries a footer row for the toggle. */
  expandable?: boolean;
  expand?: { expanded: boolean; onToggle: () => void };
  child?: ChildFrame;
  /** A step of a child workflow drawn inside its parent step: read-only. */
  nested?: boolean;
  /** A nested step that starts a workflow of its own links to it instead of expanding. */
  childHref?: string;
  status?: StepExecutionStatus;
};

const NODE_INNER_HEIGHT = 85;
const TERMINAL_HEIGHT = 64;
const BRANCH_ROW_HEIGHT = 32;
const EXPAND_ROW_HEIGHT = 28;

function stepNodeHeight(stepType: string, backBranchCount: number, expandable = false): number {
  if (stepType === 'terminal') return TERMINAL_HEIGHT;
  return NODE_INNER_HEIGHT + backBranchCount * BRANCH_ROW_HEIGHT + (expandable ? EXPAND_ROW_HEIGHT : 0);
}

const FRAME_GAP = 12;
const FRAME_PADDING = 16;
const FRAME_HEADER_HEIGHT = 32;
const FRAME_RUNS_HEIGHT = 30;
const FRAME_MESSAGE_HEIGHT = 40;

function nodeHeight(node: Node): number {
  const data = node.data as StepNodeData;
  const cardHeight = stepNodeHeight(data.stepType, data.backBranches?.length ?? 0, data.expandable === true);
  return data.child === undefined ? cardHeight : cardHeight + FRAME_GAP + data.child.height;
}

function nodeWidth(node: Node): number {
  return (node.data as StepNodeData).child?.width ?? NODE_WIDTH;
}

const STEP_STATUS_CLASS: Partial<Record<StepExecutionStatus, string>> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  escalated: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

function StepStatusMark({ status }: { status: StepExecutionStatus }) {
  return (
    <span
      data-testid="child-step-status"
      data-status={status}
      className={cn(
        'ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium',
        STEP_STATUS_CLASS[status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
      )}
    >
      {status}
    </span>
  );
}

/** The dashed group under an expanded step's card; the child's steps are drawn into it as sub-nodes. */
function ChildWorkflowFrame({ child }: { child: ChildFrame }) {
  return (
    <div
      data-testid="child-workflow-frame"
      style={{ height: child.height, marginTop: FRAME_GAP }}
      className="rounded-xl border-[1.5px] border-dashed border-pink-300 bg-pink-50/30 px-4 dark:border-pink-800 dark:bg-pink-950/10 cursor-default"
      onClick={(event) => event.stopPropagation()}
    >
      <div style={{ height: FRAME_HEADER_HEIGHT }} className="flex items-center gap-2 min-w-0 text-[11px]">
        {child.href !== undefined ? (
          <Link href={child.href} className="nodrag font-semibold text-foreground truncate hover:underline">
            {child.title}
          </Link>
        ) : (
          <span className="font-semibold text-foreground truncate">{child.title}</span>
        )}
        {child.badge !== undefined && (
          <span className="shrink-0 rounded-full bg-pink-100 px-1.5 py-px text-[10px] font-medium text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
            {child.badge}
          </span>
        )}
      </div>
      {child.runs !== undefined && child.runs.length > 0 && (
        <div style={{ height: FRAME_RUNS_HEIGHT }} className="nodrag nowheel flex items-center gap-1 overflow-x-auto">
          {child.runs.map((run) => (
            <span key={run.id} className="inline-flex shrink-0 items-center rounded-md border border-border/60 bg-white text-[10px] dark:bg-slate-900">
              <button
                type="button"
                onClick={run.onSelect}
                aria-pressed={run.selected}
                className={cn('px-1.5 py-0.5 rounded-l-md', run.selected === true ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
              >
                {run.label}
              </button>
              <Link href={run.href} className="px-1 py-0.5 text-muted-foreground hover:text-foreground" aria-label={`Open run ${run.label}`} title="Open the child run">
                ↗
              </Link>
            </span>
          ))}
        </div>
      )}
      {child.message !== undefined && (
        <p className="text-[11px] text-muted-foreground">{child.message}</p>
      )}
    </div>
  );
}

const HANDLE_CLASS = '!bg-transparent !border-0 !w-px !h-px';
const CHILD_FOOTER_CLASS = 'nodrag -mx-4 w-[calc(100%+2rem)] flex items-center gap-1.5 px-4 text-[11px] font-medium border-t border-border/40 '
  + 'text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-950/30';

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
  const expanded = data.expand?.expanded === true;

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

      <div style={{ width: data.child?.width ?? NODE_WIDTH }}>
      <div
        style={{ width: NODE_WIDTH, minHeight: NODE_INNER_HEIGHT }}
        className={cn(
          'group rounded-xl border-[1.5px] px-4 pt-3 transition-shadow relative overflow-hidden mx-auto',
          data.nested === true ? 'cursor-default' : 'cursor-pointer',
          (data.backBranches?.length ?? 0) > 0 || data.expandable === true ? 'pb-0' : 'pb-3',
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
          {data.evaluation !== undefined && <StepEvaluationLink evaluation={data.evaluation} />}
          {data.status !== undefined && <StepStatusMark status={data.status} />}
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

        {data.expand !== undefined && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); data.expand?.onToggle(); }}
            style={{ height: EXPAND_ROW_HEIGHT }}
            className={cn(
              CHILD_FOOTER_CLASS,
              (data.backBranches?.length ?? 0) > 0 ? '' : 'mt-3',
            )}
            aria-label={expanded ? 'Collapse child workflow' : 'Expand child workflow'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Hide child workflow' : 'Show child workflow'}
          </button>
        )}
        {data.childHref !== undefined && (
          <Link
            href={data.childHref}
            onClick={(event) => event.stopPropagation()}
            style={{ height: EXPAND_ROW_HEIGHT }}
            className={cn(
              CHILD_FOOTER_CLASS,
              (data.backBranches?.length ?? 0) > 0 ? '' : 'mt-3',
            )}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Open child workflow
          </Link>
        )}
      </div>
      {data.child !== undefined && <ChildWorkflowFrame child={data.child} />}
      </div>
    </>
  );
}

function StepEvaluationLink({ evaluation }: { evaluation: StepEvaluationMark }) {
  const display = VALIDATION_STATUS[evaluation.status];
  return (
    <Link
      href={evaluation.href}
      title={evaluation.title}
      aria-label={evaluation.title}
      data-testid="step-evaluation-mark"
      data-status={evaluation.status}
      onClick={(event) => event.stopPropagation()}
      className={cn('nodrag shrink-0 rounded p-0.5 hover:bg-muted', display.textClassName)}
    >
      <display.icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
    </Link>
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

// ---------------------------------------------------------------------------
// Custom edge — run replay: a ball rides the edge the run is taking now, and a
// counter names how many times the run has taken it so far.
// ---------------------------------------------------------------------------

/** What a run replay shows at one moment: where the run is, and which edge it is crossing. */
export interface DiagramReplayFrame {
  activeStepId: string | null;
  travel: { edgeId: string; key: number; durationMs: number } | null;
  /** Freezes the ball where it is on its ride, until playback resumes. */
  paused: boolean;
  edgeTraversals: ReadonlyMap<string, number>;
  /** Step the viewport pans to, so a tall diagram keeps the ball in view; null leaves the viewport alone. */
  followStepId: string | null;
}

type ReplayEdgeData = {
  travel: DiagramReplayFrame['travel'];
  paused: boolean;
  traversals: number;
  isBack: boolean;
};

function ReplayEdge({
  id,
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  style, markerEnd, pathOptions,
  label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius,
  data,
}: EdgeProps & { data?: ReplayEdgeData }) {
  const [path, midX, midY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: pathOptions?.borderRadius,
    offset: pathOptions?.offset,
  });
  const motionRef = useRef<SVGAnimateMotionElement>(null);
  const travel = data?.travel ?? null;

  // A freshly mounted <animateMotion> with the default begin would count from
  // page load and already be over — start each hop's animation explicitly.
  useLayoutEffect(() => {
    if (travel !== null) motionRef.current?.beginElement();
  }, [travel]);

  const paused = data?.paused ?? false;
  useLayoutEffect(() => {
    const svg = motionRef.current?.ownerSVGElement;
    if (svg === null || svg === undefined || paused === false) return;
    // SMIL pauses per document: unpause on the way out, or the next ride would start frozen.
    svg.pauseAnimations();
    return () => svg.unpauseAnimations();
  }, [paused, travel]);

  const traversals = data?.traversals ?? 0;
  const counter = traversals > 1 ? `×${traversals}` : undefined;
  const replayLabel = [label, counter].filter((part) => part !== undefined).join('  ');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={traversals > 0 ? { ...style, strokeOpacity: 1 } : { ...style, strokeOpacity: 0.45 }}
        markerEnd={markerEnd}
        label={replayLabel.length > 0 ? replayLabel : undefined}
        // A back edge's midpoint sits on the cards it joins; put its counter on the arc instead.
        labelX={data?.isBack === true ? sourceX + (pathOptions?.offset ?? 0) : midX}
        labelY={midY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle ?? { fill: 'white', fillOpacity: 0.85 }}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        labelShowBg={true}
      />
      {travel !== null && (
        <circle key={travel.key} r={7} fill={COLORS.replay.ball} stroke="white" strokeWidth={2} data-testid="replay-ball">
          <animateMotion ref={motionRef} dur={`${travel.durationMs}ms`} path={path} begin="indefinite" fill="freeze" />
        </circle>
      )}
    </>
  );
}

const edgeTypes = { addStep: AddStepEdge, replay: ReplayEdge };

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
    const key = edgeIdOf(from, to);
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

type DiagramLayout = {
  nodes: Node[];
  edges: Edge[];
  /** The steps of expanded child workflows, positioned inside their parent step's frame. */
  nestedNodes: Node[];
  nestedEdges: Edge[];
  height: number;
  width: number;
};

/** Node id of a child step drawn inside `parentStepId` — unique across the canvas. */
const nestedIdOf = (parentStepId: string, childNodeId: string) => `${parentStepId}::${childNodeId}`;

/** Sizes the frame around a child workflow, and lays the child out to fill it. */
function frameChild(parentStepId: string, cardHeight: number, child: ExpandedChildWorkflow) {
  const headerHeight = FRAME_HEADER_HEIGHT + (child.runs !== undefined && child.runs.length > 0 ? FRAME_RUNS_HEIGHT : 0);
  if (child.definition === null) {
    return { frame: { ...child, width: NODE_WIDTH, height: headerHeight + FRAME_MESSAGE_HEIGHT }, nodes: [], edges: [] };
  }
  const startsWorkflow = new Map(child.definition.steps.flatMap((step) => {
    const target = childWorkflowTargetOf(step);
    if (target === null) return [];
    const href = target.definitionVersion === undefined
      ? routes.workflow(child.namespace, target.definitionName)
      : routes.workflowDefinition(child.namespace, target.definitionName, target.definitionVersion);
    return [[step.id, href] as const];
  }));
  // One level deep: a nested spawn links to its workflow rather than opening a frame of its own.
  const inner = buildLayout(child.definition, undefined, new Set(startsWorkflow.keys()));
  const innerHeight = Math.max(0, ...inner.nodes.map((node) => node.position.y + nodeHeight(node)));
  const width = Math.max(NODE_WIDTH, inner.width + 2 * FRAME_PADDING);
  const offset = { x: (width - inner.width) / 2, y: cardHeight + FRAME_GAP + headerHeight + FRAME_PADDING };
  const nodes: Node[] = inner.nodes.map((node) => ({
    ...node,
    id: nestedIdOf(parentStepId, node.id),
    parentId: parentStepId,
    extent: 'parent',
    draggable: false,
    selectable: false,
    position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
    data: {
      ...(node.data as StepNodeData),
      nested: true,
      status: child.stepStatus?.get(node.id),
      childHref: startsWorkflow.get(node.id),
    } satisfies StepNodeData,
  }));
  const edges: Edge[] = inner.edges.map((edge) => ({
    ...edge,
    id: nestedIdOf(parentStepId, edge.id),
    source: nestedIdOf(parentStepId, edge.source),
    target: nestedIdOf(parentStepId, edge.target),
  }));
  return { frame: { ...child, width, height: headerHeight + innerHeight + 2 * FRAME_PADDING }, nodes, edges };
}

function buildLayout(
  definition: WorkflowDefinition,
  expandedChildren?: ReadonlyMap<string, ExpandedChildWorkflow>,
  expandable?: ReadonlySet<string>,
): DiagramLayout {
  const isExpandable = (stepId: string) => expandable?.has(stepId) === true;
  const stepMap = new Map(definition.steps.map((s) => [s.id, s]));
  const graphEdges = graphEdgesOf(definition);

  // A step's back-edge rows are only known once the layout has run, but the
  // frame sits below them — so frame with the card's base height, then grow the
  // offset by the rows the layout found.
  const framed = new Map<string, ReturnType<typeof frameChild>>();
  for (const [stepId, child] of expandedChildren ?? []) {
    const step = stepMap.get(stepId);
    if (step !== undefined) framed.set(stepId, frameChild(stepId, stepNodeHeight(step.type, 0, isExpandable(stepId)), child));
  }

  const layout = computeGraphLayout(
    definition.steps.map((s) => s.id),
    graphEdges,
    (stepId, outgoingBackEdges) => {
      const cardHeight = stepNodeHeight(stepMap.get(stepId)?.type ?? 'creation', outgoingBackEdges, isExpandable(stepId));
      const frame = framed.get(stepId)?.frame;
      return frame === undefined ? cardHeight : cardHeight + FRAME_GAP + frame.height;
    },
    (stepId) => framed.get(stepId)?.frame.width ?? NODE_WIDTH,
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
        expandable: isExpandable(step.id),
        child: framed.get(step.id)?.frame,
      } as StepNodeData,
    });
  }

  const nestedNodes: Node[] = [];
  const nestedEdges: Edge[] = [];
  for (const [stepId, { nodes: childNodes, edges: childEdges }] of framed) {
    const rowsAbove = (backBranchesByStep.get(stepId)?.length ?? 0) * BRANCH_ROW_HEIGHT;
    nestedNodes.push(...childNodes.map((node) => ({ ...node, position: { ...node.position, y: node.position.y + rowsAbove } })));
    nestedEdges.push(...childEdges);
  }

  // Back edges arc off the right-hand side; each gets its own offset so several
  // loops out of the same region stay readable instead of overlapping.
  let backIdx = 0;
  const edges: Edge[] = layout.edges.map((edge) => {
    const isBack = edge.isBack;
    const offsetIdx = isBack ? backIdx++ : 0;
    return {
      id: edgeIdOf(edge.from, edge.to),
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

  return { nodes, edges, nestedNodes, nestedEdges, height: layout.height, width: layout.width };
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
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-white dark:bg-background border border-border/60 rounded-xl shadow-sm px-1.5 py-1.5 z-10 whitespace-nowrap" data-tour="editor-controls">
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
  /** Per agent step id, its evaluation mark; steps without one show none. */
  stepEvaluation?: Map<string, StepEvaluationMark>;
  canMoveUp?: Set<string>;
  canMoveDown?: Set<string>;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onAddBlock?: () => void;
  addBlockActive?: boolean;
  /** Replays a run on the diagram: highlights its current step and animates the edge it is crossing. */
  replay?: DiagramReplayFrame;
  /** Steps that start a child workflow, and the ones drawn open with the child's steps inside. */
  childWorkflows?: ChildWorkflowExpansion;
}

export function WorkflowDiagram({ definition, className, style, onNodeClick, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onRequestAddStep, onPaneClick, selectedStepId, errorStepIds, warningStepIds, stepEvaluation, canMoveUp, canMoveDown, onUndo, onRedo, canUndo, canRedo, onAddBlock, addBlockActive, replay, childWorkflows }: WorkflowDiagramProps) {
  const expandedChildren = childWorkflows?.expanded;
  const expandable = childWorkflows?.expandable;
  const { nodes: layoutNodes, edges: layoutEdges, nestedNodes, nestedEdges, height } = useMemo(
    () => buildLayout(definition, expandedChildren, expandable),
    [definition, expandedChildren, expandable],
  );

  const { nodes: computedNodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const styledNodes = layoutNodes.map((n) => {
      const d = n.data as StepNodeData;
      return {
        ...n,
        selected: replay !== undefined ? n.id === replay.activeStepId : n.id === selectedStepId,
        data: {
          ...d,
          hasError: errorStepIds?.has(n.id) ?? false,
          hasWarning: warningStepIds?.has(n.id) ?? false,
          warningTooltip: warningStepIds?.get(n.id),
          evaluation: stepEvaluation?.get(n.id),
          onDelete: onNodeDelete && d.stepType !== 'terminal' ? () => onNodeDelete(n.id) : undefined,
          onMoveUp: onNodeMoveUp && canMoveUp?.has(n.id) ? () => onNodeMoveUp(n.id) : undefined,
          onMoveDown: onNodeMoveDown && canMoveDown?.has(n.id) ? () => onNodeMoveDown(n.id) : undefined,
          expand: childWorkflows?.expandable.has(n.id) === true
            ? { expanded: childWorkflows.expanded.has(n.id), onToggle: () => childWorkflows.onToggle(n.id) }
            : undefined,
        },
      };
    });
    const styledEdges: Edge[] = layoutEdges.map((e) => {
      const isForward = e.sourceHandle !== 'right-out';
      if (replay !== undefined) {
        return {
          ...e,
          type: 'replay',
          data: {
            travel: replay.travel?.edgeId === e.id ? replay.travel : null,
            paused: replay.paused,
            traversals: replay.edgeTraversals.get(e.id) ?? 0,
            isBack: isForward === false,
          } satisfies ReplayEdgeData,
        };
      }
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
    // Sub-nodes after their parents: XYFlow positions a child against a parent it has already placed.
    return { nodes: [...(styledNodes as Node[]), ...nestedNodes], edges: [...styledEdges, ...nestedEdges] };
  }, [layoutNodes, layoutEdges, nestedNodes, nestedEdges, selectedStepId, errorStepIds, warningStepIds, stepEvaluation, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onRequestAddStep, canMoveUp, canMoveDown, replay, childWorkflows]);

  // Controlled node state, lazily seeded from computedNodes so XYFlow never sees an
  // empty array on first render (an empty seed would throw XYFlow error #015 on drag).
  const [localNodes, setLocalNodes] = useState<Node[]>(() => computedNodes);

  // Re-sync when the underlying definition/styling changes, but keep whatever
  // position the user has dragged each node to. Brand-new nodes get anchored
  // below their actual (possibly dragged) parent position instead of
  // buildLayout's from-scratch coordinates, and any existing downstream node
  // (most commonly the terminal/"Done" step) gets pushed further down if the
  // new node would otherwise land on top of it.
  //
  // Opening or closing a child workflow resizes a step: the nodes around it
  // make room and give it back, keeping the arrangement the user dragged.
  useEffect(() => {
    setLocalNodes((prev) => {
      const sized = (nodes: Node[]) => nodes
        .filter((node) => node.parentId === undefined)
        .map((node) => ({ id: node.id, position: node.position, height: nodeHeight(node), width: nodeWidth(node) }));
      const positioned = placeNewNodes(
        makeRoomForResized(sized(prev), sized(computedNodes)),
        sized(computedNodes),
        layoutEdges
          .filter((e) => e.sourceHandle !== 'right-out')
          .map((e) => ({ from: e.source, to: e.target })),
      );
      return computedNodes.map((node) => {
        const position = node.parentId === undefined ? positioned.get(node.id) : undefined;
        return position ? { ...node, position } : node;
      });
    });
  }, [computedNodes, layoutEdges]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setLocalNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // Tidy up = throw away the dragged positions and re-run the canonical layout,
  // so the canvas snaps back to the same shape a freshly opened workflow has.
  const handleTidy = useCallback(() => {
    const topLevel = localNodes.filter((node) => node.parentId === undefined);
    const layout = computeGraphLayout(
      topLevel.map((node) => node.id),
      layoutEdges.map((e) => ({ from: e.source, to: e.target })),
      (nodeId) => {
        const node = topLevel.find((candidate) => candidate.id === nodeId);
        return node ? nodeHeight(node) : NODE_INNER_HEIGHT;
      },
      (nodeId) => {
        const node = topLevel.find((candidate) => candidate.id === nodeId);
        return node ? nodeWidth(node) : NODE_WIDTH;
      },
    );
    setLocalNodes((prev) => prev.map((node) => {
      const position = node.parentId === undefined ? layout.positions.get(node.id) : undefined;
      return position ? { ...node, position } : node;
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
        followStepId={replay?.followStepId ?? null}
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
  followStepId?: string | null;
} & CanvasControlsProps;

function FlowCanvas({ className, style, height, localNodes, edges, onNodesChange, onNodeClick, onPaneClick, onUndo, onRedo, canUndo, canRedo, onAddBlock, addBlockActive, onTidy, followStepId }: FlowCanvasProps) {
  const { fitView, getZoom } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  // The canvas is as tall as the diagram, so on a short screen the page scrolls
  // rather than the viewport — bring the step into view both ways.
  useEffect(() => {
    if (followStepId === null || followStepId === undefined) return;
    const zoom = getZoom();
    fitView({ nodes: [{ id: followStepId }], duration: 300, minZoom: zoom, maxZoom: zoom });
    canvasRef.current
      ?.querySelector(`.react-flow__node[data-id="${CSS.escape(followStepId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [followStepId, fitView, getZoom]);
  const hasEditableSteps = localNodes.some((node) => node.parentId === undefined && (node.data as StepNodeData).stepType !== 'terminal');

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<StepNodeData>) => {
      if (node.data?.stepType === 'terminal' || node.data?.nested === true) return;
      onNodeClick?.(node.id);
      // Let the settings pane mount/resize the canvas first, then recenter.
      setTimeout(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }), 60);
    },
    [onNodeClick, fitView],
  );

  return (
    <div
      ref={canvasRef}
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
