import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ModelRegistryEntry } from '@mediforce/platform-core';

import { ModelRegistryTable } from '../model-registry-table';

const models: ModelRegistryEntry[] = [
  {
    id: 'popular-model',
    canonicalSlug: null,
    name: 'Popular model',
    provider: 'Test provider',
    contextLength: 128_000,
    maxCompletionTokens: null,
    pricing: { input: 0.000001, output: 0.000002 },
    modality: 'text->text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision: false,
    source: 'manual',
    requestCount: 100,
    lastSyncedAt: '2026-08-06T00:00:00.000Z',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    retiredAt: null,
  },
  {
    id: 'other-model',
    canonicalSlug: null,
    name: 'Other model',
    provider: 'Test provider',
    contextLength: 128_000,
    maxCompletionTokens: null,
    pricing: { input: 0.000001, output: 0.000002 },
    modality: 'text->text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: false,
    supportsVision: false,
    source: 'manual',
    requestCount: 0,
    lastSyncedAt: '2026-08-06T00:00:00.000Z',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    retiredAt: null,
  },
];

describe('ModelRegistryTable', () => {
  it('leaves Top picks off by default and toggles it accessibly', async () => {
    const user = userEvent.setup();
    render(<ModelRegistryTable models={models} />);

    const topPicksButton = screen.getByRole('button', { name: /top picks/i });
    expect(topPicksButton).toHaveAttribute('aria-pressed', 'false');
    expect(topPicksButton).toHaveTextContent('Off');
    expect(screen.getByText('Popular model')).toBeInTheDocument();
    expect(screen.getByText('Other model')).toBeInTheDocument();

    await user.click(topPicksButton);

    expect(topPicksButton).toHaveAttribute('aria-pressed', 'true');
    expect(topPicksButton).toHaveTextContent('On');
    expect(screen.queryByText('Other model')).not.toBeInTheDocument();
  });
});
