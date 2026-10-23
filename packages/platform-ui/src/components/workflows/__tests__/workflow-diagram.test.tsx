import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

import { WorkflowDiagram, graphEdgesOf } from '../workflow-diagram';
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

  it('[RENDER] both sides of a decision are on the canvas at once', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        {
          id: 'pick-data',
          name: 'Pick Data',
          type: 'decision',
          executor: 'human',
          verdicts: {
            use_demo: { target: 'build', label: 'Use Demo Data' },
            upload_data: { target: 'upload', label: 'Upload My Own Data' },
          },
        },
        { id: 'upload', name: 'Upload Data', type: 'creation', executor: 'human' },
        { id: 'build', name: 'Build App', type: 'creation', executor: 'agent', autonomyLevel: 'L4' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'pick-data', to: 'upload' },
        { from: 'pick-data', to: 'build' },
        { from: 'upload', to: 'build' },
        { from: 'build', to: 'done' },
      ],
    });

    render(<WorkflowDiagram definition={definition} />);

    expect(screen.getByText('Upload Data')).toBeInTheDocument();
    expect(screen.getByText('Build App')).toBeInTheDocument();
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

  it('[RENDER] databricks-job script steps show the Databricks label instead of Script', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        { id: 'run-job', name: 'Run Job', type: 'creation', executor: 'script', plugin: 'databricks-job', databricks: { jobId: '123' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'run-job', to: 'done' }],
    });

    render(<WorkflowDiagram definition={definition} />);

    expect(screen.getByText('Databricks')).toBeInTheDocument();
    expect(screen.queryByText('Script')).not.toBeInTheDocument();
  });

  it('[RENDER] an agent step whose plugin string happens to be databricks-job keeps its agent label', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'creation', executor: 'agent', autonomyLevel: 'L2', plugin: 'databricks-job' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'done' }],
    });

    render(<WorkflowDiagram definition={definition} />);

    expect(screen.getByText('Assist')).toBeInTheDocument();
    expect(screen.queryByText('Databricks')).not.toBeInTheDocument();
  });
});

describe('graphEdgesOf', () => {
  it('[UNIT] names both verdicts on the arrow they share, even when one name contains the other', () => {
    const definition = buildWorkflowDefinition({
      steps: [
        {
          id: 'review',
          name: 'Review',
          type: 'review',
          executor: 'human',
          verdicts: {
            approve_only: { target: 'done' },
            approve: { target: 'done' },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'review', to: 'done' }],
    });

    const shared = graphEdgesOf(definition).find((e) => e.from === 'review' && e.to === 'done');

    expect(shared?.label).toBe('approve_only / approve');
  });
});

describe('child workflows (via WorkflowDiagram)', () => {
  const orchestrator = buildWorkflowDefinition({
    steps: [
      {
        id: 'phase',
        name: 'Run Phase',
        type: 'creation',
        executor: 'action',
        action: { kind: 'run-workflow', config: { definitionName: 'child', timeout: 'PT1H' } },
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'phase', to: 'done' }],
  });
  const child = buildWorkflowDefinition({
    name: 'child',
    steps: [
      { id: 'collect', name: 'Collect Evidence', type: 'creation', executor: 'human' },
      { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'collect', to: 'end' }],
  });

  it('[RENDER] a collapsed step offers to expand and draws none of the child', () => {
    const onToggle = vi.fn();
    render(
      <WorkflowDiagram
        definition={orchestrator}
        childWorkflows={{ expandable: new Set(['phase']), expanded: new Map(), onToggle }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand child workflow' }));

    expect(onToggle).toHaveBeenCalledWith('phase');
    expect(screen.queryByText('Collect Evidence')).not.toBeInTheDocument();
  });

  it('[RENDER] an expanded step draws the child\'s steps with their statuses, under a linked title', () => {
    render(
      <WorkflowDiagram
        definition={orchestrator}
        childWorkflows={{
          expandable: new Set(['phase']),
          expanded: new Map([['phase', {
            definition: child,
            namespace: 'test',
            title: 'child v2',
            href: '/test/workflows/child/definitions/2',
            badge: '× N at runtime',
            stepStatus: new Map([['collect', 'running' as const]]),
          }]]),
          onToggle: () => undefined,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Collapse child workflow' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'child v2' })).toHaveAttribute('href', '/test/workflows/child/definitions/2');
    expect(screen.getByText('× N at runtime')).toBeInTheDocument();
    expect(screen.getByText('Collect Evidence')).toBeInTheDocument();
    expect(screen.getByTestId('child-step-status')).toHaveAttribute('data-status', 'running');
    // Read-only: a child step carries no expand control or edit buttons of its own.
    expect(screen.getAllByRole('button', { name: /child workflow/ })).toHaveLength(1);
  });

  it('[RENDER] a nested step that starts its own workflow links to it instead of expanding', () => {
    const middle = buildWorkflowDefinition({
      name: 'child',
      steps: [
        {
          id: 'nested-phase',
          name: 'Run Nested Phase',
          type: 'creation',
          executor: 'action',
          action: { kind: 'run-workflow', config: { definitionName: 'grandchild', timeout: 'PT1H' } },
        },
        { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'nested-phase', to: 'end' }],
    });
    render(
      <WorkflowDiagram
        definition={orchestrator}
        childWorkflows={{
          expandable: new Set(['phase']),
          expanded: new Map([['phase', { definition: middle, namespace: 'test', title: 'child v1' }]]),
          onToggle: () => undefined,
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Open child workflow' })).toHaveAttribute('href', '/test/workflows/grandchild');
    expect(screen.getAllByRole('button', { name: /child workflow/ })).toHaveLength(1);
  });
});
