import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const setMyModelSettings = vi.fn();
const updateNamespace = vi.fn();

vi.mock('@/hooks/use-namespace-mutations', () => ({
  useSetMyModelSettings: () => ({ mutate: setMyModelSettings, isPending: false }),
  useUpdateNamespace: () => ({ mutate: updateNamespace, isPending: false }),
}));

vi.mock('@/hooks/use-model-registry', () => ({
  useModelRegistry: () => ({
    data: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', retiredAt: null, supportsTools: true },
      { id: 'openai/gpt-5.2', name: 'GPT-5.2', retiredAt: null, supportsTools: true },
      { id: 'openai/gpt-4', name: 'GPT-4', retiredAt: '2026-01-01T00:00:00.000Z', supportsTools: true },
    ],
  }),
}));

import { ModelSettingsSection } from '../model-settings-section';

const workspace = { outputBudget: 'high' as const, defaultModel: 'anthropic/claude-sonnet-5.5' };

function renderSection(options: { canEditWorkspace: boolean; member?: { outputBudget?: 'low'; defaultModel?: string } }) {
  render(
    <ModelSettingsSection
      handle="acme"
      workspace={workspace}
      canEditWorkspace={options.canEditWorkspace}
      member={options.member === undefined ? undefined : { uid: 'u1', outputBudget: options.member.outputBudget, defaultModel: options.member.defaultModel }}
      onError={vi.fn()}
    />,
  );
}

describe('ModelSettingsSection', () => {
  beforeEach(() => {
    setMyModelSettings.mockReset();
    updateNamespace.mockReset();
  });

  it('shows a plain member only their own settings, following the workspace', () => {
    renderSection({ canEditWorkspace: false, member: {} });
    expect(screen.queryByText('Owners and admins')).toBeNull();
    const modelSelect = document.getElementById('member-default-model') as HTMLSelectElement;
    expect(within(modelSelect).getByRole('option', { name: 'Follow workspace (Claude Sonnet 5.5)' })).toBeInTheDocument();
  });

  it('lists only live models of the picked vendor', () => {
    renderSection({ canEditWorkspace: true });
    fireEvent.change(screen.getByLabelText('Model vendor'), { target: { value: 'openai' } });
    const modelSelect = document.getElementById('workspace-default-model') as HTMLSelectElement;
    expect(within(modelSelect).getByRole('option', { name: 'GPT-5.2' })).toBeInTheDocument();
    expect(within(modelSelect).queryByRole('option', { name: 'GPT-4' })).toBeNull();
    expect(within(modelSelect).queryByRole('option', { name: 'Claude Sonnet 5.5' })).toBeNull();
  });

  it('saves the workspace default model, and clears it with the platform default', () => {
    renderSection({ canEditWorkspace: true });
    const modelSelect = document.getElementById('workspace-default-model') as HTMLSelectElement;
    fireEvent.change(modelSelect, { target: { value: '' } });
    expect(updateNamespace).toHaveBeenCalledWith({ handle: 'acme', defaultModel: null }, expect.anything());
  });

  it('saves a member override, and clears it when they pick the workspace model', () => {
    renderSection({ canEditWorkspace: false, member: { defaultModel: 'openai/gpt-5.2' } });
    const modelSelect = document.getElementById('member-default-model') as HTMLSelectElement;
    fireEvent.change(screen.getByLabelText('Model vendor'), { target: { value: 'anthropic' } });
    fireEvent.change(modelSelect, { target: { value: 'anthropic/claude-sonnet-5.5' } });
    expect(setMyModelSettings).toHaveBeenCalledWith({ handle: 'acme', defaultModel: null }, expect.anything());
  });

  it('saves a member budget above the workspace budget', () => {
    renderSection({ canEditWorkspace: false, member: {} });
    const slider = screen.getByRole('slider', { name: 'Output budget' });
    fireEvent.change(slider, { target: { value: '3' } });
    fireEvent.pointerUp(slider);
    expect(setMyModelSettings).toHaveBeenCalledWith({ handle: 'acme', outputBudget: 'max' }, expect.anything());
  });
});
