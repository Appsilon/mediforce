import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkflowSecretsEditor } from '../workflow-secrets-editor';

const valuesMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    workflowSecrets: {
      values: (input: unknown) => valuesMock(input),
      save: (input: unknown) => saveMock(input),
    },
    secrets: {
      list: (input: unknown) => listMock(input),
    },
  },
}));

function renderEditor(requiredKeys: string[]) {
  render(
    <WorkflowSecretsEditor
      namespace="acme"
      workflowName="tealflow"
      requiredKeys={requiredKeys}
    />,
  );
}

function keyInputs(): HTMLInputElement[] {
  return screen.getAllByPlaceholderText('SECRET_NAME') as HTMLInputElement[];
}

describe('WorkflowSecretsEditor', () => {
  beforeEach(() => {
    valuesMock.mockReset().mockResolvedValue({ secrets: {} });
    saveMock.mockReset().mockResolvedValue(undefined);
    listMock.mockReset().mockResolvedValue({ keys: [] });
  });

  it('prepopulates a row for every key the workflow needs but has not set', async () => {
    renderEditor(['VIKING_LOGIN', 'VIKING_PASSWORD']);

    await waitFor(() => {
      expect(keyInputs().map((input) => input.value)).toEqual(['VIKING_LOGIN', 'VIKING_PASSWORD']);
    });
    expect(screen.getAllByText('Needed by this workflow')).toHaveLength(2);
  });

  it('does not duplicate a key that already has a value', async () => {
    valuesMock.mockResolvedValue({ secrets: { VIKING_LOGIN: 'user@example.com' } });
    renderEditor(['VIKING_LOGIN', 'VIKING_PASSWORD']);

    await waitFor(() => {
      expect(keyInputs().map((input) => input.value)).toEqual(['VIKING_LOGIN', 'VIKING_PASSWORD']);
    });
    expect(screen.getAllByText('Needed by this workflow')).toHaveLength(1);
  });

  it('does not prepopulate a key already set at workspace level', async () => {
    listMock.mockResolvedValue({ keys: ['VIKING_PASSWORD'] });
    renderEditor(['VIKING_LOGIN', 'VIKING_PASSWORD']);

    await waitFor(() => {
      expect(keyInputs().map((input) => input.value)).toEqual(['VIKING_LOGIN']);
    });
  });

  it('keeps Save hidden until a prepopulated row is filled in', async () => {
    renderEditor(['VIKING_LOGIN']);

    await waitFor(() => expect(keyInputs()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();

    fireEvent.change(screen.getAllByPlaceholderText('secret value')[0], {
      target: { value: 'user@example.com' },
    });
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
  });

  it('omits still-empty prepopulated rows from the saved secrets', async () => {
    renderEditor(['VIKING_LOGIN', 'VIKING_PASSWORD']);

    await waitFor(() => expect(keyInputs()).toHaveLength(2));
    fireEvent.change(screen.getAllByPlaceholderText('secret value')[0], {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][0].secrets).toEqual({ VIKING_LOGIN: 'user@example.com' });
  });
});
