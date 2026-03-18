'use client';

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { User, Bot, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Custom node
// ---------------------------------------------------------------------------

const stepTypeColors: Record<string, { bg: string; border: string }> = {
  creation: { bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-800' },
  review: { bg: 'bg-yellow-50 dark:bg-yellow-950/40', border: 'border-yellow-200 dark:border-yellow-800' },
  decision: { bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800' },
  terminal: { bg: 'bg-gray-50 dark:bg-gray-900/40', border: 'border-gray-200 dark:border-gray-700' },
};

const executorIcons: Record<string, typeof User> = {
  human: User,
  agent: Bot,
  script: Terminal,
};

const executorColors: Record<string, string> = {
  human: 'text-blue-600 dark:text-blue-400',
  agent: 'text-violet-600 dark:text-violet-400',
  script: 'text-amber-600 dark:text-amber-400',
};

type StepNodeData = {
  label: string;
  stepType: string;
  executor: string;
  autonomyLevel?: string;
  plugin?: string;
};

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const colors = stepTypeColors[data.stepType] ?? stepTypeColors.terminal;
  const Icon = executorIcons[data.executor] ?? User;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={cn(
          'rounded-lg border-2 px-4 py-3 min-w-[160px] shadow-sm',
          colors.bg,
          colors.border,
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4 shrink-0', executorColors[data.executor])} />
          <span className="text-sm font-medium leading-tight">{data.label}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {data.stepType}
          </span>
          {data.autonomyLevel && (
            <span className="text-[10px] font-mono bg-muted rounded px-1 py-0.5 text-muted-foreground">
              {data.autonomyLevel}
            </span>
          )}
          {data.plugin && (
            <span className="text-[10px] font-mono bg-muted rounded px-1 py-0.5 text-muted-foreground truncate max-w-[100px]">
              {data.plugin}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

const nodeTypes = { step: StepNode };

// ---------------------------------------------------------------------------
// Layout: simple top-down with branching
// ---------------------------------------------------------------------------

function layoutNodes(definition: WorkflowDefinition): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const stepMap = new Map(definition.steps.map((s) => [s.id, s]));

  // Build adjacency: which steps come after which
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const t of definition.transitions) {
    children.set(t.from, [...(children.get(t.from) ?? []), t.to]);
    parents.set(t.to, [...(parents.get(t.to) ?? []), t.from]);
  }
  // Also add verdict-based transitions
  for (const step of definition.steps) {
    if (step.verdicts) {
      for (const verdict of Object.values(step.verdicts)) {
        if (verdict.target) {
          const existing = children.get(step.id) ?? [];
          if (!existing.includes(verdict.target)) {
            children.set(step.id, [...existing, verdict.target]);
            parents.set(verdict.target, [...(parents.get(verdict.target) ?? []), step.id]);
          }
        }
      }
    }
  }

  // BFS layering from roots (nodes with no parents)
  const roots = definition.steps.filter((s) => !parents.has(s.id) || parents.get(s.id)!.length === 0);
  const layer = new Map<string, number>();
  const queue = roots.map((r) => r.id);
  for (const root of queue) {
    layer.set(root, 0);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentLayer = layer.get(current) ?? 0;
    for (const child of children.get(current) ?? []) {
      const existingLayer = layer.get(child);
      if (existingLayer === undefined || existingLayer < currentLayer + 1) {
        layer.set(child, currentLayer + 1);
        if (!queue.includes(child)) {
          queue.push(child);
        }
      }
    }
  }

  // For steps not reached by BFS, assign layer based on array order
  for (let i = 0; i < definition.steps.length; i++) {
    if (!layer.has(definition.steps[i].id)) {
      layer.set(definition.steps[i].id, i);
    }
  }

  // Group by layer
  const layers = new Map<number, string[]>();
  for (const [stepId, layerNum] of layer) {
    layers.set(layerNum, [...(layers.get(layerNum) ?? []), stepId]);
  }

  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 80;
  const H_GAP = 40;
  const V_GAP = 60;

  const nodes: Node<StepNodeData>[] = [];
  for (const [layerNum, stepIds] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    const totalWidth = stepIds.length * NODE_WIDTH + (stepIds.length - 1) * H_GAP;
    const startX = -totalWidth / 2;

    for (let i = 0; i < stepIds.length; i++) {
      const step = stepMap.get(stepIds[i]);
      if (!step) continue;
      nodes.push({
        id: step.id,
        type: 'step',
        position: {
          x: startX + i * (NODE_WIDTH + H_GAP),
          y: layerNum * (NODE_HEIGHT + V_GAP),
        },
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

  // Edges from transitions
  const edgeSet = new Set<string>();
  const edges: Edge[] = [];

  function addEdge(from: string, to: string, label?: string) {
    const key = `${from}->${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({
      id: key,
      source: from,
      target: to,
      label,
      type: 'smoothstep',
      style: { stroke: 'var(--color-muted-foreground)', strokeWidth: 1.5 },
      labelStyle: { fontSize: 10, fill: 'var(--color-muted-foreground)' },
    });
  }

  for (const t of definition.transitions) {
    addEdge(t.from, t.to, t.when ? `when: ${t.when}` : undefined);
  }

  for (const step of definition.steps) {
    if (step.verdicts) {
      for (const [verdictName, verdict] of Object.entries(step.verdicts)) {
        if (verdict.target) {
          addEdge(step.id, verdict.target, verdictName);
        }
      }
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface WorkflowDiagramProps {
  definition: WorkflowDefinition;
  className?: string;
}

export function WorkflowDiagram({ definition, className }: WorkflowDiagramProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutNodes(definition),
    [definition],
  );

  const [nodes] = useNodesState(initialNodes);
  const [edges] = useEdgesState(initialEdges);

  return (
    <div className={cn('h-[400px] rounded-lg border bg-card', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
