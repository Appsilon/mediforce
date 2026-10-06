import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  createdAt: '2026-10-06T00:00:00Z',
  updatedAt: '2026-10-06T00:00:00Z',
});

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
});
