'use client';

import React, { useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { User, Bot, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLORS = {
  forward: { stroke: '#cbd5e1', arrow: '#94a3b8' },
  back: { stroke: '#f59e0b', arrow: '#d97706' },
  label: { forward: '#64748b', back: '#b45309' },
} as const;

const STEP_STYLES: Record<string, { bg: string; border: string; activeBorder: string }> = {
  creation: {
    bg: 'bg-white dark:bg-slate-900',
    border: 'border-blue-200 dark:border-blue-800',
    activeBorder: 'border-blue-500',
  },
  review: {
    bg: 'bg-amber-50/50 dark:bg-amber-950/20',
    border: 'border-amber-200 dark:border-amber-800',
    activeBorder: 'border-amber-500',
  },
  decision: {
    bg: 'bg-purple-50/50 dark:bg-purple-950/20',
    border: 'border-purple-200 dark:border-purple-800',
    activeBorder: 'border-purple-500',
  },
  terminal: {
    bg: 'bg-slate-50 dark:bg-slate-900',
    border: 'border-slate-200 dark:border-slate-700',
    activeBorder: 'border-slate-500',
  },
};

const EXECUTOR_STYLES: Record<string, { icon: typeof User; color: string; bg: string }> = {
  human: { icon: User, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  agent: { icon: Bot, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-900/30' },
  script: { icon: Terminal, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
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
  editing?: boolean;
  onRemove?: () => void;
};

const NODE_WIDTH = 240;
const NODE_INNER_HEIGHT = 72;
const ROW_GAP = 48;

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

  return (
    <>
      <Handle id="top" type="target" position={Position.Top} className={HANDLE_CLASS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      <Handle id="right-out" type="source" position={Position.Right} className={HANDLE_CLASS} />
      <Handle id="right-in" type="target" position={Position.Right} className={HANDLE_CLASS} />

      <div
        style={{ width: NODE_WIDTH, minHeight: NODE_INNER_HEIGHT }}
        className={cn(
          'rounded-xl border-[1.5px] px-4 py-3 transition-all cursor-pointer group/node relative',
          'hover:shadow-md',
          style.bg,
          selected ? `${style.activeBorder} shadow-md ring-1 ring-primary/10` : style.border,
        )}
      >
        {/* Delete button — edit mode only */}
        {data.editing && data.onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onRemove?.(); }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs opacity-0 group-hover/node:opacity-100 transition-opacity shadow-sm hover:bg-red-600 z-10"
          >
            ×
          </button>
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
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {data.executor === 'human' ? 'Human' : data.executor === 'agent' ? 'Agent' : 'Script'}
              </span>
              {data.autonomyLevel && (
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

type AddNodeData = {
  onAdd: (executor: 'human' | 'agent' | 'script') => void;
};

const ADD_OPTIONS: { executor: 'human' | 'agent' | 'script'; icon: typeof User; label: string; color: string }[] = [
  { executor: 'human', icon: User, label: 'Human', color: 'hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 dark:hover:bg-blue-900/20 dark:hover:text-blue-400' },
  { executor: 'agent', icon: Bot, label: 'Agent', color: 'hover:bg-violet-50 hover:text-violet-600 hover:border-violet-200 dark:hover:bg-violet-900/20 dark:hover:text-violet-400' },
  { executor: 'script', icon: Terminal, label: 'Script', color: 'hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 dark:hover:bg-amber-900/20 dark:hover:text-amber-400' },
];

function AddStepNode({ data }: NodeProps<Node<AddNodeData>>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Handle id="top" type="target" position={Position.Top} className={HANDLE_CLASS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      <div style={{ width: NODE_WIDTH }} className="flex justify-center relative">
        {!open ? (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="w-7 h-7 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground/50 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
          >
            <span className="text-sm font-bold">+</span>
          </button>
        ) : (
          <div className="flex gap-1 bg-background rounded-lg border shadow-lg p-1 animate-in fade-in zoom-in-95 duration-150">
            {ADD_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.executor}
                  onClick={(e) => { e.stopPropagation(); data.onAdd(opt.executor); setOpen(false); }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-all',
                    opt.color,
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

const nodeTypes = { step: StepNode, addStep: AddStepNode };

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
  selectedStepId?: string | null;
  editing?: boolean;
  onAddStep?: (afterStepId: string, beforeStepId: string, executor: 'human' | 'agent' | 'script') => void;
  onRemoveStep?: (stepId: string) => void;
}

export function WorkflowDiagram({ definition, className, style, onNodeClick, selectedStepId, editing, onAddStep, onRemoveStep }: WorkflowDiagramProps) {
  const { nodes: layoutNodes, edges: layoutEdges, height } = useMemo(
    () => buildLayout(definition),
    [definition],
  );

  // Inject editing callbacks into node data + add "+" nodes between steps in edit mode
  const { nodes, edges } = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const styledNodes: Node<any>[] = layoutNodes.map((n) => ({
      ...n,
      selected: n.id === selectedStepId,
      data: {
        ...n.data,
        editing,
        onRemove: onRemoveStep ? () => onRemoveStep(n.id) : undefined,
      },
    }));

    let finalEdges = [...layoutEdges];

    // In edit mode, insert "+" nodes between sequential forward edges
    if (editing && onAddStep) {
      const forwardEdges = layoutEdges.filter((e) => e.sourceHandle === 'bottom');
      for (const edge of forwardEdges) {
        const sourceNode = styledNodes.find((n) => n.id === edge.source);
        const targetNode = styledNodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;

        const addId = `add-${edge.source}-${edge.target}`;
        const midY = (sourceNode.position.y + targetNode.position.y) / 2;

        styledNodes.push({
          id: addId,
          type: 'addStep',
          position: { x: sourceNode.position.x, y: midY - 14 },
          data: { onAdd: (executor: 'human' | 'agent' | 'script') => onAddStep(edge.source, edge.target, executor) },
        });

        // Replace original edge with two edges through the add node
        finalEdges = finalEdges.filter((e) => e.id !== edge.id);
        finalEdges.push(
          { ...edge, id: `${edge.source}->add`, target: addId, targetHandle: 'top', label: undefined, markerEnd: undefined },
          { ...edge, id: `add->${edge.target}`, source: addId, sourceHandle: 'bottom', label: edge.label },
        );
      }
    }

    return { nodes: styledNodes, edges: finalEdges };
  }, [layoutNodes, layoutEdges, selectedStepId, editing, onAddStep, onRemoveStep]);

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
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          onNodeClick={handleNodeClick}
          defaultViewport={{ x: 16, y: 16, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </ReactFlowProvider>
  );
}
