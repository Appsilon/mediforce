'use client';

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
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
import { User, Bot, Terminal, Users, Trash2, Plus, PenLine, Search, GitBranch, Flag, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

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

const STEP_TYPE_CONFIG: Record<string, { icon: typeof PenLine; label: string; color: string }> = {
  creation: { icon: PenLine,    label: 'Creation', color: 'text-blue-500 dark:text-blue-400' },
  review:   { icon: Search,     label: 'Review',   color: 'text-amber-500 dark:text-amber-400' },
  decision: { icon: GitBranch,  label: 'Decision', color: 'text-purple-500 dark:text-purple-400' },
  terminal: { icon: Flag,       label: 'End',      color: 'text-emerald-500 dark:text-emerald-400' },
};

const EXECUTOR_STYLES: Record<string, { icon: typeof User; color: string; bg: string }> = {
  human: { icon: User, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  agent: { icon: Bot, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-900/30' },
  script: { icon: Terminal, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  cowork: { icon: Users, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-100 dark:bg-teal-900/30' },
};

// ---------------------------------------------------------------------------
// Custom nodes
// ---------------------------------------------------------------------------

type StepNodeData = {
  label: string;
  stepType: string;
  executor: string;
  autonomyLevel?: string;
  plugin?: string;
  hasError?: boolean;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
};

const NODE_WIDTH = 240;
const NODE_INNER_HEIGHT = 85;
const ROW_GAP = 58;

const HANDLE_CLASS = '!bg-transparent !border-0 !w-px !h-px';

function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
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
  const exec = EXECUTOR_STYLES[data.executor] ?? EXECUTOR_STYLES.human;
  const Icon = exec.icon;
  const typeConfig = STEP_TYPE_CONFIG[data.stepType] ?? STEP_TYPE_CONFIG.creation;
  const TypeIcon = typeConfig.icon;

  return (
    <>
      <Handle id="top" type="target" position={Position.Top} className={HANDLE_CLASS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      <Handle id="right-out" type="source" position={Position.Right} className={HANDLE_CLASS} />
      <Handle id="right-in" type="target" position={Position.Right} className={HANDLE_CLASS} />

      <div
        style={{ width: NODE_WIDTH, minHeight: NODE_INNER_HEIGHT }}
        className={cn(
          'group rounded-xl border-[1.5px] px-4 py-3 transition-all cursor-pointer relative',
          'hover:shadow-md',
          style.bg,
          selected
            ? `${style.activeBorder} ${style.activeRing} shadow-lg`
            : data.hasError
              ? 'border-red-400 ring-2 ring-red-200 dark:ring-red-900/50'
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
        <div className="flex items-start gap-2.5">
          <div className={cn('rounded-lg p-1.5 mt-0.5', exec.bg)}>
            <Icon className={cn('h-3.5 w-3.5', exec.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold leading-tight text-foreground truncate">
              {data.label}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <TypeIcon className={cn('h-3 w-3 shrink-0', typeConfig.color)} strokeWidth={1.5} />
              <span className={cn('text-[10px] font-semibold', typeConfig.color)}>{typeConfig.label}</span>
              <span className="text-[10px] text-muted-foreground/30">·</span>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {{ human: 'Human', agent: 'Agent', script: 'Script', cowork: 'Cowork' }[data.executor] ?? data.executor}
              </span>
              {data.autonomyLevel && data.executor === 'agent' && (
                <span className="text-[10px] font-mono text-muted-foreground/70">
                  {data.autonomyLevel}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const nodeTypes = { step: StepNode };

// ---------------------------------------------------------------------------
// Custom edge — forward edges with a mid-point "add step" button
// ---------------------------------------------------------------------------

type AddStepEdgeData = {
  onAdd?: (type: WorkflowStep['type'], executor: WorkflowStep['executor']) => void;
};

const STEP_TYPE_OPTIONS = [
  { type: 'creation' as const, icon: PenLine,  label: 'Creation', description: 'A step where content or data is produced — by a human, an AI agent, or a script.', color: 'text-blue-600 dark:text-blue-400',    activeBg: 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-400' },
  { type: 'review'   as const, icon: Search,    label: 'Review',   description: 'A step where someone evaluates work and gives a verdict such as approve or reject.',  color: 'text-amber-600 dark:text-amber-400',  activeBg: 'bg-amber-50 dark:bg-amber-900/30 ring-1 ring-amber-400' },
  { type: 'decision' as const, icon: GitBranch, label: 'Decision', description: 'A branching step that routes the workflow to different paths based on a condition.',   color: 'text-purple-600 dark:text-purple-400', activeBg: 'bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-400' },
] as const;

function AddStepEdge({
  id,
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  style, markerEnd,
  label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius,
  data,
}: EdgeProps & { data?: AddStepEdgeData }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pendingType, setPendingType] = useState<WorkflowStep['type'] | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as HTMLElement) &&
        buttonRef.current && !buttonRef.current.contains(e.target as HTMLElement)
      ) {
        setPopoverOpen(false);
        setPendingType(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [popoverOpen]);

  const [path, midX, midY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  // Position the button 40% along the source→target vector (10% closer to source than midpoint).
  const buttonX = sourceX + 0.4 * (targetX - sourceX);
  const buttonY = sourceY + 0.4 * (targetY - sourceY);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (popoverOpen) {
      setPopoverOpen(false);
      setPendingType(null);
      setPopoverPos(null);
    } else {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setPopoverPos({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX + rect.width / 2,
        });
      }
      setPopoverOpen(true);
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
      {popoverOpen && popoverPos && data?.onAdd && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: popoverPos.top,
            left: popoverPos.left,
            transform: 'translateX(-50%)',
            zIndex: 9999,
          }}
          className="bg-background border rounded-xl shadow-xl p-3 w-80 space-y-3"
        >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Step type</p>
            <div className="flex flex-col gap-1">
              {STEP_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  onClick={(e) => { e.stopPropagation(); setPendingType(opt.type); }}
                  className={cn(
                    'rounded-lg px-3 py-2 text-left transition-all w-full',
                    pendingType === opt.type ? opt.activeBg : 'hover:bg-muted',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <opt.icon className={cn('h-3.5 w-3.5 shrink-0', opt.color)} strokeWidth={1.5} />
                    <span className={cn('text-xs font-semibold', opt.color)}>{opt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>
          {pendingType && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Who handles this step?</p>
              <div className="flex gap-1.5">
                {(pendingType === 'creation'
                  ? (['human', 'agent', 'script', 'cowork'] as const)
                  : (['human', 'agent'] as const)
                ).map((executor) => (
                  <button
                    key={executor}
                    onClick={(e) => { e.stopPropagation(); data.onAdd?.(pendingType, executor); setPopoverOpen(false); setPendingType(null); setPopoverPos(null); }}
                    className="flex-1 rounded-lg py-1.5 text-xs font-semibold hover:bg-muted transition-all capitalize border"
                  >
                    {executor}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

const edgeTypes = { addStep: AddStepEdge };

// ---------------------------------------------------------------------------
// Layout engine — top-down, even spacing
// ---------------------------------------------------------------------------

function buildLayout(definition: WorkflowDefinition): { nodes: Node<StepNodeData>[]; edges: Edge[]; height: number } {
  const stepMap = new Map(definition.steps.map((s) => [s.id, s]));

  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();

  function link(from: string, to: string) {
    const existing = children.get(from) ?? [];
    if (!existing.includes(to)) {
      children.set(from, [...existing, to]);
      parents.set(to, [...(parents.get(to) ?? []), from]);
    }
  }

  for (const t of definition.transitions) link(t.from, t.to);
  for (const step of definition.steps) {
    if (step.verdicts) {
      for (const verdict of Object.values(step.verdicts)) {
        if (verdict.target) link(step.id, verdict.target);
      }
    }
  }

  const roots = definition.steps.filter((s) => !parents.has(s.id) || parents.get(s.id)!.length === 0);
  if (roots.length === 0 && definition.steps.length > 0) roots.push(definition.steps[0]);

  const layer = new Map<string, number>();
  const queue = roots.map((r) => r.id);
  for (const root of queue) layer.set(root, 0);

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentLayer = layer.get(current) ?? 0;
    for (const child of children.get(current) ?? []) {
      if (!layer.has(child)) {
        layer.set(child, currentLayer + 1);
        queue.push(child);
      }
    }
  }

  const maxBfsLayer = Math.max(...layer.values(), -1);
  let nextLayer = maxBfsLayer + 1;
  for (const step of definition.steps) {
    if (!layer.has(step.id)) layer.set(step.id, nextLayer++);
  }

  const rows = new Map<number, string[]>();
  for (const [stepId, row] of layer) {
    rows.set(row, [...(rows.get(row) ?? []), stepId]);
  }

  const ROW_HEIGHT = NODE_INNER_HEIGHT + ROW_GAP;
  const H_GAP = 24;

  const nodes: Node<StepNodeData>[] = [];
  for (const [row, stepIds] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    for (let i = 0; i < stepIds.length; i++) {
      const step = stepMap.get(stepIds[i]);
      if (!step) continue;
      nodes.push({
        id: step.id,
        type: 'step',
        position: { x: i * (NODE_WIDTH + H_GAP), y: row * ROW_HEIGHT },
        data: {
          label: step.name,
          stepType: step.type,
          executor: step.executor,
          autonomyLevel: step.autonomyLevel,
          plugin: step.plugin,
        },
      });
    }
  }

  // Edges
  const edgeSet = new Set<string>();
  const edges: Edge[] = [];
  let backIdx = 0;

  function addEdge(from: string, to: string, label?: string) {
    const key = `${from}->${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);

    const fromLayer = layer.get(from) ?? 0;
    const toLayer = layer.get(to) ?? 0;
    const isBack = toLayer <= fromLayer;
    const idx = isBack ? backIdx++ : 0;

    const shortLabel = label
      ?.replace(/^when:\s*/, '')
      .replace(/output\./g, '')
      .replace(/\s*==\s*/g, ' = ');

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
      labelStyle: {
        fontSize: 11,
        fontWeight: 500,
        fill: isBack ? COLORS.label.back : COLORS.label.forward,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: isBack ? COLORS.back.arrow : COLORS.forward.arrow,
      },
    });
  }

  for (const t of definition.transitions) {
    addEdge(t.from, t.to, t.when ? `when: ${t.when}` : undefined);
  }
  for (const step of definition.steps) {
    if (step.verdicts) {
      for (const [name, verdict] of Object.entries(step.verdicts)) {
        if (verdict.target) addEdge(step.id, verdict.target, name);
      }
    }
  }

  const totalRows = Math.max(...layer.values(), 0) + 1;
  const height = totalRows * ROW_HEIGHT + 40;

  return { nodes, edges, height };
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
  onEdgeAdd?: (fromStepId: string, type: WorkflowStep['type'], executor: WorkflowStep['executor']) => void;
  onPaneClick?: () => void;
  selectedStepId?: string | null;
  errorStepIds?: Set<string>;
  canMoveUp?: Set<string>;
  canMoveDown?: Set<string>;
}

export function WorkflowDiagram({ definition, className, style, onNodeClick, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onEdgeAdd, onPaneClick, selectedStepId, errorStepIds, canMoveUp, canMoveDown }: WorkflowDiagramProps) {
  const { nodes: layoutNodes, edges: layoutEdges, height } = useMemo(
    () => buildLayout(definition),
    [definition],
  );

  const { nodes, edges } = useMemo(() => {
    const styledNodes: Node<StepNodeData>[] = layoutNodes.map((n) => ({
      ...n,
      selected: n.id === selectedStepId,
      data: {
        ...n.data,
        hasError: errorStepIds?.has(n.id) ?? false,
        onDelete: onNodeDelete && n.data.stepType !== 'terminal' ? () => onNodeDelete(n.id) : undefined,
        onMoveUp: onNodeMoveUp && canMoveUp?.has(n.id) ? () => onNodeMoveUp(n.id) : undefined,
        onMoveDown: onNodeMoveDown && canMoveDown?.has(n.id) ? () => onNodeMoveDown(n.id) : undefined,
      },
    }));
    const styledEdges: Edge[] = layoutEdges.map((e) => {
      const isForward = e.sourceHandle !== 'right-out';
      if (isForward && onEdgeAdd) {
        return {
          ...e,
          type: 'addStep',
          data: { onAdd: (type, executor) => onEdgeAdd(e.source, type, executor) } satisfies AddStepEdgeData,
        };
      }
      return e;
    });
    return { nodes: styledNodes, edges: styledEdges };
  }, [layoutNodes, layoutEdges, selectedStepId, errorStepIds, onNodeDelete, onNodeMoveUp, onNodeMoveDown, onEdgeAdd, canMoveUp, canMoveDown]);

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
          nodes={nodes}
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
    </ReactFlowProvider>
  );
}
