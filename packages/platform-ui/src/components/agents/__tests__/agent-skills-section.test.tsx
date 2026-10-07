import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render as renderDom, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SkillSummary } from '@mediforce/platform-core';

const list = vi.fn();
vi.mock('@/lib/mediforce', () => ({ mediforce: { skills: { list: (input: unknown) => list(input) } } }));

import { AgentSkillsSection } from '../agent-skills-section';

const summary = (namespace: string, id: string, visibility: 'public' | 'private'): SkillSummary => ({
  namespace,
  id,
  name: id,
  description: `${id} description`,
  visibility,
  contentHash: 'hash',
  paths: ['SKILL.md'],
  size: 64,
  createdAt: '2026-10-06T00:00:00Z',
  updatedAt: '2026-10-06T00:00:00Z',
});

const render = (ui: ReactElement) =>
  renderDom(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const checkboxNames = () => screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'));

describe('AgentSkillsSection', () => {
  beforeEach(() => {
    list.mockResolvedValue({
      skills: [summary('alpha', 'own-private', 'private'), summary('alpha', 'own-public', 'public'), summary('beta', 'beta-public', 'public')],
    });
  });

  it("offers a private agent its workspace's skills and public ones, listed from the agent's namespace", async () => {
    render(<AgentSkillsSection namespace="alpha" ownsNamespace visibility="private" selected={[]} onChange={() => {}} />);
    await screen.findByText('own-private');
    expect(list).toHaveBeenCalledWith({ namespace: 'alpha', includePublic: true });
    expect(checkboxNames()).toEqual(['Skill alpha/own-private', 'Skill alpha/own-public', 'Skill beta/beta-public']);
  });

  it('offers a public agent only public skills, but keeps a held private one so it can be unticked', async () => {
    render(
      <AgentSkillsSection namespace="alpha" ownsNamespace visibility="public" selected={[{ namespace: 'alpha', id: 'own-private' }]} onChange={() => {}} />,
    );
    await screen.findByText('own-public');
    expect(checkboxNames()).toEqual(['Skill alpha/own-public', 'Skill beta/beta-public', 'Skill alpha/own-private']);
    expect(screen.getByText(/may not hold this skill/)).toBeTruthy();
  });

  it.each(['claude-code-agent', 'opencode-agent'])('does not warn that an agent on %s goes without its skills', async (runtimeId) => {
    render(<AgentSkillsSection namespace="alpha" ownsNamespace visibility="private" selected={[]} onChange={() => {}} runtimeId={runtimeId} />);
    await screen.findByText('own-private');
    expect(screen.queryByText(/will not receive them/)).toBeNull();
  });

  it('warns that an agent on a runtime without skills goes without them', async () => {
    render(<AgentSkillsSection namespace="alpha" ownsNamespace visibility="private" selected={[]} onChange={() => {}} runtimeId="script-container" />);
    await screen.findByText('own-private');
    expect(screen.getByText(/will not receive them/)).toBeTruthy();
  });
});
