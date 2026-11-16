import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { buildAgentRun } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';
import { AgentVersionsTab } from '../agent-versions-tab';

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    agents: {
      listVersions: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/use-agent-runs', () => ({
  useAgentRunsForAgent: vi.fn(),
}));

import { mediforce } from '@/lib/mediforce';
import { useAgentRunsForAgent } from '@/hooks/use-agent-runs';
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
    vi.mocked(useAgentRunsForAgent).mockReturnValue({
      data: [buildAgentRun({ stepId: 'deploy', agentId: 'a1', agentVersion: 1 })],
      loading: false,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    await waitFor(() => expect(screen.getByText(/behind/)).toBeInTheDocument());
    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('does not flag a step already on the current version', async () => {
    vi.mocked(mediforce.agents.listVersions).mockResolvedValue({
      versions: [{ agentId: 'a1', version: 1, hash: 'h'.repeat(64), config: CONFIG, createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' }],
      current: 1,
    });
    vi.mocked(useAgentRunsForAgent).mockReturnValue({
      data: [buildAgentRun({ stepId: 'deploy', agentId: 'a1', agentVersion: 1 })],
      loading: false,
    });

    const { wrapper } = createQueryWrapper();
    render(<AgentVersionsTab handle="acme" agentId="a1" />, { wrapper });

    await waitFor(() => expect(screen.getByText('current')).toBeInTheDocument());
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
    vi.mocked(useAgentRunsForAgent).mockReturnValue({ data: [], loading: false });

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
