import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, configure } from '@testing-library/react';
import { WorkflowSecretsEditor } from '../workflow-secrets-editor';

// The initial mount plus its two reads can outrun the 1s default budget on a
// loaded runner. Stays under vitest's 5s test timeout so a genuinely stuck
// render still reports as a failed assertion, not a timed-out test.
configure({ asyncUtilTimeout: 3000 });

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
    expect(screen.queryByText('Save')).toBeNull();

    fireEvent.change(screen.getAllByPlaceholderText('secret value')[0], {
      target: { value: 'user@example.com' },
    });
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('omits still-empty prepopulated rows from the saved secrets', async () => {
    renderEditor(['VIKING_LOGIN', 'VIKING_PASSWORD']);

    await waitFor(() => expect(keyInputs()).toHaveLength(2));
    fireEvent.change(screen.getAllByPlaceholderText('secret value')[0], {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][0].secrets).toEqual({ VIKING_LOGIN: 'user@example.com' });
  });

  it('marks a stored key with an empty value as still needed', async () => {
    valuesMock.mockResolvedValue({ secrets: { VIKING_PASSWORD: '' } });
    renderEditor(['VIKING_PASSWORD']);

    await waitFor(() => {
      expect(screen.getAllByText('Needed by this workflow')).toHaveLength(1);
    });
    expect(keyInputs().map((input) => input.value)).toEqual(['VIKING_PASSWORD']);
  });

  it('drops a key left empty by a pasted .env instead of storing it blank', async () => {
    renderEditor(['VIKING_PASSWORD']);

    await waitFor(() => expect(keyInputs()).toHaveLength(1));
    fireEvent.click(screen.getByText('Paste .env'));
    fireEvent.change(screen.getByPlaceholderText(/VIKING_LOGIN=/), {
      target: { value: 'VIKING_PASSWORD=' },
    });
    fireEvent.click(screen.getByText(/Import 1 variable/));

    expect(screen.getAllByText('Needed by this workflow')).toHaveLength(1);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][0].secrets).toEqual({});
  });

  it('refuses to edit when the authoritative values read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    valuesMock.mockRejectedValue(new Error('network down'));
    renderEditor(['VIKING_PASSWORD']);

    await waitFor(() => expect(screen.getByText(/Editing is disabled/)).toBeTruthy());
    expect(screen.queryAllByPlaceholderText('SECRET_NAME')).toHaveLength(0);
    expect(screen.queryByText('Save')).toBeNull();
    consoleError.mockRestore();
  });
});
