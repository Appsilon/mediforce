import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PluginCombobox } from '../plugin-combobox';

interface PluginMetadata {
  name: string;
  description: string;
  inputDescription: string;
  outputDescription: string;
  roles: ('executor' | 'reviewer')[];
}

interface PluginEntry {
  name: string;
  metadata?: PluginMetadata;
}

const mockPlugins: PluginEntry[] = [
  {
    name: 'supply-chain/intake-agent',
    metadata: {
      name: 'Intake Agent',
      description: 'Processes incoming data',
      inputDescription: 'Input record',
      outputDescription: 'Structured data',
      roles: ['executor'],
    },
  },
  {
    name: 'supply-chain/review-agent',
    metadata: {
      name: 'Review Agent',
      description: 'Reviews agent outputs for accuracy',
      inputDescription: 'Agent output',
      outputDescription: 'Review verdict',
      roles: ['reviewer'],
    },
  },
  {
    name: 'supply-chain/dual-agent',
    metadata: {
      name: 'Dual Agent',
      description: 'Can execute and review tasks',
      inputDescription: 'Task data',
      outputDescription: 'Result',
      roles: ['executor', 'reviewer'],
    },
  },
];

describe('PluginCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] shows "Select plugin..." placeholder when no value', () => {
    render(
      <PluginCombobox
        plugins={mockPlugins}
        value={undefined}
        onChange={vi.fn()}
        role="executor"
      />,
    );
    expect(screen.getByText('Select plugin...')).toBeInTheDocument();
  });

  it('[RENDER] shows selected plugin name when value is set', () => {
    render(
      <PluginCombobox
        plugins={mockPlugins}
        value="supply-chain/intake-agent"
        onChange={vi.fn()}
        role="executor"
      />,
    );
    expect(screen.getByText('Intake Agent')).toBeInTheDocument();
  });

  it('[DATA] filters plugins by search text (name and description, case-insensitive)', async () => {
    const user = userEvent.setup();
    render(
      <PluginCombobox
        plugins={mockPlugins}
        value={undefined}
        onChange={vi.fn()}
        role="executor"
      />,
    );

    // Open the combobox
    await user.click(screen.getByText('Select plugin...'));

    // Type in search
    const searchInput = screen.getByPlaceholderText(/search/i);
    await user.type(searchInput, 'intake');

    // Only Intake Agent should be visible (matches name)
    expect(screen.getByText('Intake Agent')).toBeInTheDocument();
    expect(screen.queryByText('Dual Agent')).not.toBeInTheDocument();
  });

  it('[DATA] only shows plugins matching the role prop (executor or reviewer)', async () => {
    const user = userEvent.setup();
    render(
      <PluginCombobox
        plugins={mockPlugins}
        value={undefined}
        onChange={vi.fn()}
        role="executor"
      />,
    );

    // Open the combobox
    await user.click(screen.getByText('Select plugin...'));

    // Should show executor-role plugins
    expect(screen.getByText('Intake Agent')).toBeInTheDocument();
    expect(screen.getByText('Dual Agent')).toBeInTheDocument();
    // Should NOT show reviewer-only plugin
    expect(screen.queryByText('Review Agent')).not.toBeInTheDocument();
  });

  it('[RENDER] shows "No plugins found" when filter yields empty results', async () => {
    const user = userEvent.setup();
    render(
      <PluginCombobox
        plugins={mockPlugins}
        value={undefined}
        onChange={vi.fn()}
        role="executor"
      />,
    );

    await user.click(screen.getByText('Select plugin...'));

    const searchInput = screen.getByPlaceholderText(/search/i);
    await user.type(searchInput, 'zzzznonexistent');

    expect(screen.getByText(/no plugins found/i)).toBeInTheDocument();
  });

  it('[CLICK] selecting a plugin calls onChange with plugin name', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PluginCombobox
        plugins={mockPlugins}
        value={undefined}
        onChange={onChange}
        role="executor"
      />,
    );

    await user.click(screen.getByText('Select plugin...'));
    await user.click(screen.getByText('Intake Agent'));

    expect(onChange).toHaveBeenCalledWith('supply-chain/intake-agent');
  });

  it('[CLICK] clearing selection calls onChange with undefined', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PluginCombobox
        plugins={mockPlugins}
        value="supply-chain/intake-agent"
        onChange={onChange}
        role="executor"
      />,
    );

    // Click the clear button (X)
    const clearButton = screen.getByRole('button', { name: /clear/i });
    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
