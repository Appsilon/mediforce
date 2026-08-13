import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ManifestEntry } from '@mediforce/platform-api/contract';
import { WorkflowExampleGrid } from '../workflow-example-grid';

const WORKFLOWS: ManifestEntry[] = [
  {
    name: 'tutorial-linear-pipeline',
    path: 'docs/workflow-examples/01-linear-pipeline.wd.json',
    description: 'Human fills a form, a script processes it, done.',
    tags: ['tutorial', 'pipeline'],
  },
  {
    name: 'tutorial-review-loop',
    path: 'docs/workflow-examples/02-review-loop.wd.json',
    description: 'Agent generates content, human reviews it.',
    tags: ['tutorial', 'review'],
  },
  {
    name: 'untagged-example',
    path: 'docs/workflow-examples/99-untagged.wd.json',
  },
];

describe('WorkflowExampleGrid', () => {
  it('renders a card per workflow with its description and tags', () => {
    render(
      <WorkflowExampleGrid
        workflows={WORKFLOWS}
        selected={new Set()}
        onToggle={vi.fn()}
        onSelectMany={vi.fn()}
      />,
    );

    expect(screen.getByText('tutorial-linear-pipeline')).toBeInTheDocument();
    expect(screen.getByText('Human fills a form, a script processes it, done.')).toBeInTheDocument();
    expect(screen.getByText('untagged-example')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('narrows the visible cards to the picked tag and restores them with All', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowExampleGrid
        workflows={WORKFLOWS}
        selected={new Set()}
        onToggle={vi.fn()}
        onSelectMany={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'review' }));

    expect(screen.getByRole('button', { name: 'review' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('tutorial-review-loop')).toBeInTheDocument();
    expect(screen.queryByText('tutorial-linear-pipeline')).not.toBeInTheDocument();
    // An entry with no tags is not silently dropped from every filtered view —
    // it simply does not match this one.
    expect(screen.queryByText('untagged-example')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));

    expect(screen.getByText('tutorial-linear-pipeline')).toBeInTheDocument();
    expect(screen.getByText('untagged-example')).toBeInTheDocument();
  });

  it('toggles a workflow by its name when its card is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <WorkflowExampleGrid
        workflows={WORKFLOWS}
        selected={new Set()}
        onToggle={onToggle}
        onSelectMany={vi.fn()}
      />,
    );

    await user.click(screen.getByText('tutorial-review-loop'));

    expect(onToggle).toHaveBeenCalledWith('tutorial-review-loop');
  });

  it('selects only the workflows the active tag leaves visible', async () => {
    const user = userEvent.setup();
    const onSelectMany = vi.fn();
    render(
      <WorkflowExampleGrid
        workflows={WORKFLOWS}
        selected={new Set()}
        onToggle={vi.fn()}
        onSelectMany={onSelectMany}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'tutorial' }));
    await user.click(screen.getByRole('button', { name: 'Select all' }));

    expect(onSelectMany).toHaveBeenCalledWith(
      ['tutorial-linear-pipeline', 'tutorial-review-loop'],
      true,
    );
  });

  it('offers Deselect all once every visible workflow is selected', () => {
    render(
      <WorkflowExampleGrid
        workflows={WORKFLOWS}
        selected={new Set(WORKFLOWS.map((wf) => wf.name))}
        onToggle={vi.fn()}
        onSelectMany={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Deselect all' })).toBeInTheDocument();
  });

  it('warns that a selection hidden by the filter is still imported', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowExampleGrid
        workflows={WORKFLOWS}
        selected={new Set(['tutorial-linear-pipeline'])}
        onToggle={vi.fn()}
        onSelectMany={vi.fn()}
      />,
    );

    expect(screen.queryByText(/hidden by this filter/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'review' }));

    expect(
      screen.getByText('1 selected workflow is hidden by this filter and will still be imported.'),
    ).toBeInTheDocument();
  });

  it('reflects the selected set on the checkboxes', () => {
    render(
      <WorkflowExampleGrid
        workflows={WORKFLOWS}
        selected={new Set(['tutorial-review-loop'])}
        onToggle={vi.fn()}
        onSelectMany={vi.fn()}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.map((box) => box.checked)).toEqual([false, true, false]);
  });
});
