import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock @xyflow/react so StepNode renders as plain HTML without canvas deps.
vi.mock('@xyflow/react', () => {
  const Position = { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' };
  const MarkerType = { ArrowClosed: 'arrowclosed' };
  const BackgroundVariant = { Dots: 'dots', Lines: 'lines', Cross: 'cross' };
  return {
    ReactFlow: ({ nodes, nodeTypes }: { nodes: Array<{ id: string; type: string; data: Record<string, unknown>; selected?: boolean }>; nodeTypes: Record<string, React.ComponentType<unknown>> }) => (
      <div data-testid="reactflow">
        {nodes.map((node) => {
          const Component = nodeTypes[node.type];
          if (!Component) return null;
          return <Component key={node.id} id={node.id} data={node.data} selected={node.selected ?? false} />;
        })}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    getSmoothStepPath: () => ['', 0, 0],
    Handle: () => null,
    Background: () => null,
    BackgroundVariant,
    useReactFlow: () => ({ fitView: () => undefined, zoomIn: () => undefined, zoomOut: () => undefined }),
    useStore: (selector: (state: { transform: [number, number, number] }) => unknown) => selector({ transform: [0, 0, 1] }),
    applyNodeChanges: <T,>(_changes: unknown, nodes: T): T => nodes,
    Position,
    MarkerType,
  };
});

import { WorkflowDiagram } from '../workflow-diagram';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';

describe('StepNode (via WorkflowDiagram)', () => {
  it('[RENDER] control mode label shown on agent step nodes', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'done' }],
    });

    render(<WorkflowDiagram definition={definition} />);

    expect(screen.getByText('Assist')).toBeInTheDocument();
  });

  it('[RENDER] script step nodes show Script executor label', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        { id: 'run-script', name: 'Run Script', type: 'creation', executor: 'script' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'run-script', to: 'done' }],
    });

    render(<WorkflowDiagram definition={definition} />);

    expect(screen.getAllByText('Script').length).toBeGreaterThanOrEqual(1);
  });
});
