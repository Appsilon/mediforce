import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock @xyflow/react so StepNode renders as plain HTML without canvas deps.
vi.mock('@xyflow/react', () => {
  const Position = { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' };
  const MarkerType = { ArrowClosed: 'arrowclosed' };
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
    Position,
    MarkerType,
  };
});

import { WorkflowDiagram } from '../workflow-diagram';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';

describe('StepNode (via WorkflowDiagram)', () => {
  it('[RENDER] autonomy level shown on agent step nodes', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'done' }],
    });

    render(<WorkflowDiagram definition={definition} />);

    expect(screen.getByText('L2')).toBeInTheDocument();
  });

  it('[RENDER] autonomy level not shown on script step nodes', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        { id: 'run-script', name: 'Run Script', type: 'creation', executor: 'script', autonomyLevel: 'L4' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'run-script', to: 'done' }],
    });

    render(<WorkflowDiagram definition={definition} />);

    expect(screen.queryByText('L4')).not.toBeInTheDocument();
  });
});
