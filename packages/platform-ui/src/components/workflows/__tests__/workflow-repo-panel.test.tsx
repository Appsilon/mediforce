import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoFiles = vi.fn();
const draftRepoFiles = vi.fn();
vi.mock('@/lib/mediforce', () => ({
  mediforceSilent: { workflows: { repoFiles, draftRepoFiles } },
}));

const { WorkflowRepoPanel } = await import('../workflow-repo-panel');

const step = (id: string, script?: object) =>
  ({ id, name: id, type: 'creation', executor: 'script', ...(script ? { script } : {}) }) as never;

describe('WorkflowRepoPanel', () => {
  beforeEach(() => {
    repoFiles.mockReset();
    draftRepoFiles.mockReset();
  });

  it('does not clone a draft until the reader asks it to', async () => {
    draftRepoFiles.mockResolvedValue({ repo: 'org/repo', commit: 'abc', entries: [] });
    render(
      <WorkflowRepoPanel
        steps={[step('build', { repo: 'org/repo', commit: 'abc' })]}
        namespace="tenant-a"
      />,
    );

    expect(screen.getByText(/load on their own once the workflow is saved/)).toBeTruthy();
    expect(draftRepoFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('repo-fetch-now'));
    await waitFor(() => expect(draftRepoFiles).toHaveBeenCalledWith({
      namespace: 'tenant-a',
      repo: 'org/repo',
      commit: 'abc',
    }));
    expect(repoFiles).not.toHaveBeenCalled();
  });

  it('offers no fetch for a repository whose clone needs a secret it cannot have', () => {
    render(
      <WorkflowRepoPanel
        steps={[step('build', { repo: 'org/repo', commit: 'abc', repoAuth: 'GITHUB_TOKEN' })]}
        namespace="tenant-a"
      />,
    );

    expect(screen.getByText(/GITHUB_TOKEN/)).toBeTruthy();
    expect(screen.getByText(/Save it, and these files can be read here/)).toBeTruthy();
    expect(screen.queryByTestId('repo-fetch-now')).toBeNull();
    expect(draftRepoFiles).not.toHaveBeenCalled();
  });

  it('reads a saved workflow through its definition, without being asked', async () => {
    repoFiles.mockResolvedValue({ repo: 'org/repo', commit: 'abc', entries: [] });
    const steps = [step('build', { repo: 'org/repo', commit: 'abc' })];
    render(
      <WorkflowRepoPanel steps={steps} savedSteps={steps} workflowName="flow" namespace="tenant-a" />,
    );

    await waitFor(() => expect(repoFiles).toHaveBeenCalled());
    expect(screen.queryByTestId('repo-fetch-now')).toBeNull();
  });

  it('does not read the saved step when the canvas now points somewhere else', async () => {
    // The saved read resolves the repo server-side from the stored step, so
    // reading it here would show one commit and fetch another.
    render(
      <WorkflowRepoPanel
        steps={[step('build', { repo: 'org/repo', commit: 'NEW' })]}
        savedSteps={[step('build', { repo: 'org/repo', commit: 'OLD' })]}
        workflowName="flow"
        namespace="tenant-a"
      />,
    );

    expect(screen.getByTestId('repo-fetch-now')).toBeTruthy();
    expect(repoFiles).not.toHaveBeenCalled();
  });

  it('says so when no step builds from a repository', () => {
    render(<WorkflowRepoPanel steps={[step('carried')]} workflowName="flow" />);

    expect(screen.getByText(/No step here builds from a repository/)).toBeTruthy();
    expect(repoFiles).not.toHaveBeenCalled();
    expect(draftRepoFiles).not.toHaveBeenCalled();
  });
});
