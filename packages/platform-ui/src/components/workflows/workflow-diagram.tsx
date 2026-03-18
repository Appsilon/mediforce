'use client';

import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
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
// Custom node — clean, consistent sizing
// ---------------------------------------------------------------------------

type StepNodeData = {
  label: string;
  stepType: string;
  executor: string;
  autonomyLevel?: string;
  plugin?: string;
};

const NODE_WIDTH = 240;
const NODE_INNER_HEIGHT = 72;
const ROW_GAP = 48;

function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const style = STEP_STYLES[data.stepType] ?? STEP_STYLES.terminal;
  const exec = EXECUTOR_STYLES[data.executor] ?? EXECUTOR_STYLES.human;
  const Icon = exec.icon;

  return (
    <>
      <Handle id="top" type="target" position={Position.Top} className="!bg-transparent !border-0 !w-px !h-px" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-px !h-px" />
      <Handle id="right-out" type="source" position={Position.Right} className="!bg-transparent !border-0 !w-px !h-px" />
      <Handle id="right-in" type="target" position={Position.Right} className="!bg-transparent !border-0 !w-px !h-px" />

      <div
        style={{ width: NODE_WIDTH, minHeight: NODE_INNER_HEIGHT }}
        className={cn(
          'rounded-xl border-[1.5px] px-4 py-3 transition-all cursor-pointer',
          'hover:shadow-md',
          style.bg,
          selected ? `${style.activeBorder} shadow-md ring-1 ring-primary/10` : style.border,
        )}
      >
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
                {data.executor}
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

const nodeTypes = { step: StepNode };

// ---------------------------------------------------------------------------
// Layout engine — top-down, even spacing
// ---------------------------------------------------------------------------

function buildLayout(definition: WorkflowDefinition): { nodes: Node<StepNodeData>[]; edges: Edge[]; height: number } {
  const stepMap = new Map(definition.steps.map((s) => [s.id, s]));

  // Adjacency from explicit transitions + verdicts
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

  // BFS layering — first visit wins (ignores back-edges)
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

  // Unreachable steps go after the last layer
  const maxBfsLayer = Math.max(...layer.values(), -1);
  let nextLayer = maxBfsLayer + 1;
  for (const step of definition.steps) {
    if (!layer.has(step.id)) layer.set(step.id, nextLayer++);
  }

  // Group into rows
  const rows = new Map<number, string[]>();
  for (const [stepId, row] of layer) {
    rows.set(row, [...(rows.get(row) ?? []), stepId]);
  }

  // Position nodes — consistent vertical spacing
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

  // --- Edges ---
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

    // Shorten verbose labels
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
      labelBgStyle: {
        fill: 'white',
        fillOpacity: 0.85,
      },
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
}

export function WorkflowDiagram({ definition, className, style, onNodeClick, selectedStepId }: WorkflowDiagramProps) {
  const { nodes: initialNodes, edges: initialEdges, height } = useMemo(
    () => buildLayout(definition),
    [definition],
  );

  const styledNodes = useMemo(
    () => initialNodes.map((n) => ({ ...n, selected: n.id === selectedStepId })),
    [initialNodes, selectedStepId],
  );

  const [nodes] = useNodesState(styledNodes);
  const [edges] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<StepNodeData>) => onNodeClick?.(node.id),
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
