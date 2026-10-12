import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/workflows/workflow-editor/code-editor', () => ({
  CodeEditor: ({ value }: { value: string }) => <pre data-testid="editor">{value}</pre>,
}));

const { RepoFileBrowser } = await import('../repo-file-browser');

describe('RepoFileBrowser', () => {
  it('shows the file opened last when an earlier one answers later', async () => {
    let resolveSlow: (value: unknown) => void = () => {};
    const load = vi.fn((path?: string) => {
      if (path === undefined) {
        return Promise.resolve({
          repo: 'org/repo',
          commit: 'abc',
          entries: [{ path: 'a.txt' }, { path: 'b.txt' }],
        });
      }
      if (path === 'a.txt') {
        return new Promise((resolve) => { resolveSlow = resolve; });
      }
      return Promise.resolve({ repo: 'org/repo', commit: 'abc', entries: [], file: { contents: 'B contents' } });
    });

    render(<RepoFileBrowser repo="org/repo" commit="abc" load={load as never} referenced={new Set()} />);

    fireEvent.click(await screen.findByText('a.txt'));
    fireEvent.click(await screen.findByText('b.txt'));
    await waitFor(() => expect(screen.getByTestId('editor').textContent).toBe('B contents'));

    resolveSlow({ repo: 'org/repo', commit: 'abc', entries: [], file: { contents: 'A contents' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('editor').textContent).toBe('B contents');
  });
});
