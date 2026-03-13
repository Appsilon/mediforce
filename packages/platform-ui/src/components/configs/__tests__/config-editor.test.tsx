import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProcessDefinition, ProcessConfig } from '@mediforce/platform-core';

// ---- Mocks ----

const mockUsePlugins = vi.fn();
vi.mock('@/hooks/use-plugins', () => ({
  usePlugins: (...args: unknown[]) => mockUsePlugins(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockSaveConfig = vi.fn();
vi.mock('@/app/actions/configs', () => ({
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

import { ConfigEditor } from '../config-editor';

const mockDefinition: ProcessDefinition = {
  name: 'supply-chain-review',
  version: '1.0.0',
  description: 'Supply chain review process',
  steps: [
    { id: 'intake', name: 'Data Intake', type: 'creation' },
    { id: 'review', name: 'Final Review', type: 'review' },
  ],
  transitions: [{ from: 'intake', to: 'review' }],
  triggers: [{ type: 'manual', name: 'start' }],
};

const mockPlugins = [
  {
    name: 'supply-chain-review/intake-agent',
    metadata: {
      name: 'Intake Agent',
      description: 'Processes intake',
      inputDescription: 'Record',
      outputDescription: 'Data',
      roles: ['executor' as const],
    },
  },
];

const mockConfig: ProcessConfig = {
  processName: 'supply-chain-review',
  configName: 'default',
  configVersion: '1.0',
  stepConfigs: [
    { stepId: 'intake', executorType: 'human', autonomyLevel: 'L4', reviewerType: 'none' },
    {
      stepId: 'review',
      executorType: 'agent',
      plugin: 'supply-chain-review/intake-agent',
      autonomyLevel: 'L3',
      reviewerType: 'human',
    },
  ],
};

describe('ConfigEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePlugins.mockReturnValue({
      plugins: mockPlugins,
      loading: false,
      error: null,
      filterByRole: (role: string) =>
        mockPlugins.filter((p) => p.metadata?.roles?.includes(role as 'executor' | 'reviewer')),
    });
  });

  it('[RENDER] renders side-by-side layout with definition steps on left and accordion cards on right', () => {
    render(
      <ConfigEditor
        processName="supply-chain-review"
        definition={mockDefinition}
      />,
    );

    // Definition steps and accordion cards both render step info
    expect(screen.getAllByText('intake').length).toBeGreaterThanOrEqual(2); // left panel + accordion
    expect(screen.getAllByText('review').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Data Intake').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Final Review').length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] pre-fills human defaults when no initialConfig', () => {
    render(
      <ConfigEditor
        processName="supply-chain-review"
        definition={mockDefinition}
      />,
    );

    // Should have executor type selects defaulting to 'human'
    // The accordion cards should show human as the default executor type
    const humanLabels = screen.getAllByText(/human/i);
    expect(humanLabels.length).toBeGreaterThanOrEqual(2); // one per step
  });

  it('[RENDER] renders all fields disabled when readOnly=true', () => {
    render(
      <ConfigEditor
        processName="supply-chain-review"
        definition={mockDefinition}
        initialConfig={mockConfig}
        readOnly
      />,
    );

    // Check that form controls are disabled
    const selects = screen.getAllByRole('combobox');
    for (const select of selects) {
      expect(select).toBeDisabled();
    }
  });

  it('[RENDER] shows "Edit (new version)" button when readOnly=true', () => {
    render(
      <ConfigEditor
        processName="supply-chain-review"
        definition={mockDefinition}
        initialConfig={mockConfig}
        readOnly
      />,
    );

    expect(
      screen.getByRole('link', { name: /edit.*new version/i }),
    ).toBeInTheDocument();
  });

  it('[DATA] deep-clones initialConfig and clears configVersion for clone workflow', () => {
    render(
      <ConfigEditor
        processName="supply-chain-review"
        definition={mockDefinition}
        initialConfig={mockConfig}
      />,
    );

    // configVersion input should be empty (cleared for clone)
    const versionInput = screen.getByLabelText(/version/i);
    expect(versionInput).toHaveValue('');
  });

  it('[CLICK] save button disabled when configName or configVersion is empty', () => {
    render(
      <ConfigEditor
        processName="supply-chain-review"
        definition={mockDefinition}
      />,
    );

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('[ERROR] displays validation errors from server action response in banner', async () => {
    const user = userEvent.setup();
    mockSaveConfig.mockResolvedValueOnce({
      success: false,
      error: 'Validation failed',
      errors: ['Missing plugin for step intake'],
      warnings: [],
    });

    render(
      <ConfigEditor
        processName="supply-chain-review"
        definition={mockDefinition}
      />,
    );

    // Fill in required fields so save is enabled
    const nameInput = screen.getByLabelText(/config name/i);
    const versionInput = screen.getByLabelText(/version/i);
    await user.type(nameInput, 'test-config');
    await user.type(versionInput, '1.0');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(
        screen.getByText('Missing plugin for step intake'),
      ).toBeInTheDocument();
    });
  });
});
