import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/react-query';
import { AgentVersionsTab } from '../agent-versions-tab';

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    agents: {
      listVersions: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/use-workflows-by-agent', () => ({
  useWorkflowsByAgent: vi.fn(),
}));

import { mediforce } from '@/lib/mediforce';
import { useWorkflowsByAgent } from '@/hooks/use-workflows-by-agent';
import { diffConfigs } from '../agent-versions-tab';
import userEvent from '@testing-library/user-event';

const CONFIG = { kind: 'plugin' as const, runtimeId: null, foundationModel: 'claude', systemPrompt: '', mcpServers: {}, skills: [] };

describe('AgentVersionsTab', () => {
  it('flags a step pinned to an older version than the agent\'s current one', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [
        { agentId: 'a1', version: 2, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-02T00:00:00.000Z' },
        { agentId: 'a1', version: 1, hash: 'g'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      current: 2,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({
      workflows: [{ namespace: 'acme', name: 'demo-flow', title: undefined, version: 1, steps: [{ stepId: 'deploy', pinnedVersion: 1 }] }],
      loading: false,
      error: null,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    await waitFor(() => expect(screen.getByText(/behind/)).toBeInTheDocument());
    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('links "Used by" to the exact workflow definition version that uses it, not a run', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [{ agentId: 'a1', version: 1, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' }],
      current: 1,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({
      workflows: [{ namespace: 'acme', name: 'demo-flow', title: undefined, version: 3, steps: [{ stepId: 'deploy', pinnedVersion: 1 }] }],
      loading: false,
      error: null,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    const link = await screen.findByRole('link', { name: 'demo-flow' });
    expect(link).toHaveAttribute('href', '/acme/workflows/demo-flow/definitions/3');
    expect(screen.getByText('Agent Version')).toBeInTheDocument();
  });

  it('shows the workflow name instead of a title that is just a bare version like "v1"', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [{ agentId: 'a1', version: 1, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' }],
      current: 1,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({
      workflows: [{ namespace: 'acme', name: 'dwdd', title: 'v2', version: 2, steps: [{ stepId: 'deploy', pinnedVersion: 1 }] }],
      loading: false,
      error: null,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    expect(await screen.findByRole('link', { name: 'dwdd' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'v2' })).not.toBeInTheDocument();
  });

  it('shows a workflow from another namespace as plain text, not a link', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [{ agentId: 'a1', version: 1, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' }],
      current: 1,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({
      workflows: [{ namespace: 'other-team', name: 'shared-flow', title: undefined, version: 1, steps: [{ stepId: 'deploy', pinnedVersion: 1 }] }],
      loading: false,
      error: null,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    expect(await screen.findByText('shared-flow')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'shared-flow' })).not.toBeInTheDocument();
  });

  it('shows "No workflow references this agent" when nothing uses it', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [{ agentId: 'a1', version: 1, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' }],
      current: 1,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({ workflows: [], loading: false, error: null });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    expect(await screen.findByText('No workflow references this agent.')).toBeInTheDocument();
  });

  it('does not flag a step already on the current version', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [{ agentId: 'a1', version: 1, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' }],
      current: 1,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({
      workflows: [{ namespace: 'acme', name: 'demo-flow', title: undefined, version: 1, steps: [{ stepId: 'deploy', pinnedVersion: 1 }] }],
      loading: false,
      error: null,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    await waitFor(() => expect(screen.getByText('current')).toBeInTheDocument());
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });

  it('does not flag an unpinned step, which falls back to the current version', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [
        { agentId: 'a1', version: 2, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-02T00:00:00.000Z' },
        { agentId: 'a1', version: 1, hash: 'g'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      current: 2,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({
      workflows: [{ namespace: 'acme', name: 'demo-flow', title: undefined, version: 1, steps: [{ stepId: 'deploy', pinnedVersion: null }] }],
      loading: false,
      error: null,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    expect(await screen.findByText('vlatest')).toBeInTheDocument();
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });

  it('shows the diff between two versions when expanded', async () => {
    const user = userEvent.setup();
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [
        { agentId: 'a1', version: 2, hash: 'h'.repeat(64), config: { ...CONFIG, systemPrompt: 'Be careful.' }, createdBy: 'u', createdAt: '2026-01-02T00:00:00.000Z' },
        { agentId: 'a1', version: 1, hash: 'g'.repeat(64), config: { ...CONFIG, systemPrompt: 'Ship it.' }, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      current: 2,
    });
    vi.mocked(useWorkflowsByAgent).mockReturnValue({ workflows: [], loading: false, error: null });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    const diffButton = await screen.findByText('Diff vs v1');
    expect(screen.queryByText('Ship it.')).not.toBeInTheDocument();

    await user.click(diffButton);

    expect(screen.getByText('Ship it.')).toBeInTheDocument();
    expect(screen.getByText('Be careful.')).toBeInTheDocument();
  });
});

describe('diffConfigs', () => {
  it('reports only the fields that changed', () => {
    const rows = diffConfigs(CONFIG, { ...CONFIG, systemPrompt: 'New prompt', foundationModel: 'gpt-5' });
    expect(rows.map((r) => r.label).sort()).toEqual(['Model', 'System prompt']);
  });

  it('reports nothing for identical configs', () => {
    expect(diffConfigs(CONFIG, { ...CONFIG })).toEqual([]);
  });
});
