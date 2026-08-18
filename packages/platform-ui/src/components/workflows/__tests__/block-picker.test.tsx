import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { BlockPicker } from '../block-picker';
import { CM_ROWS, STEP_TYPE_OPTIONS } from '@/lib/block-presets';
import { BLOCK_PRESETS } from '@mediforce/platform-core';
import type { NewStepPayload } from '@/lib/control-mode';

// Availability is exercised through the capabilities endpoint's own tests; here
// an unknown instance keeps every block enabled and keeps the render synchronous.
vi.mock('@/hooks/use-capabilities', () => ({
  useCapabilities: () => ({ capabilities: null, loading: false }),
}));

/**
 * The step-type and executor picker lives in the Full tier; the picker opens on
 * Simple (pre-made blocks). Every test below is about the Full tier.
 */
function renderFullTier(onAdd: (payload: NewStepPayload) => void = () => {}): void {
  render(<BlockPicker onAdd={onAdd} />);
  fireEvent.click(screen.getByTestId('picker-tier-full'));
}

function optionButton(id: string): HTMLElement {
  return screen.getByTestId(`executor-option-${id}`);
}

function stepTypeButton(value: string): HTMLElement {
  return screen.getByTestId(`step-type-option-${value}`);
}

describe('BlockPicker step type guidance (#1186)', () => {
  it('explains every step type, not just its name', () => {
    renderFullTier();

    for (const option of STEP_TYPE_OPTIONS) {
      expect(stepTypeButton(option.value)).toHaveTextContent(option.purpose);
    }
  });

  it('states what each step type is for in the wording the golden rules use', () => {
    renderFullTier();

    expect(stepTypeButton('creation')).toHaveTextContent(/produces a result/i);
    expect(stepTypeButton('decision')).toHaveTextContent(/which branch/i);
  });
});

describe('BlockPicker executor guidance (#1186)', () => {
  it('explains every executor option, not just its name', () => {
    renderFullTier();

    for (const row of CM_ROWS) {
      for (const button of row.buttons) {
        expect(optionButton(button.id)).toHaveTextContent(button.purpose);
      }
    }
  });

  it('states what each executor is for in the wording the golden rules use', () => {
    renderFullTier();

    expect(optionButton('human')).toHaveTextContent(/accountability, approval/i);
    expect(optionButton('script')).toHaveTextContent(/deterministic/i);
    expect(optionButton('action')).toHaveTextContent(/email/i);
    expect(optionButton('cowork')).toHaveTextContent(/real time/i);
    expect(optionButton('human-review')).toHaveTextContent(/approves/i);
    expect(optionButton('autonomous-agent')).toHaveTextContent(/no approval/i);
  });

  it('adds the executor the clicked option describes', () => {
    const onAdd = vi.fn();
    renderFullTier(onAdd);

    fireEvent.click(optionButton('script'));

    expect(onAdd).toHaveBeenCalledWith({ executor: 'script', type: 'creation' });
  });

  it('carries the selected step type into the added step', () => {
    const onAdd = vi.fn();
    renderFullTier(onAdd);

    fireEvent.click(stepTypeButton('decision'));
    fireEvent.click(optionButton('human-review'));

    expect(onAdd).toHaveBeenCalledWith({
      executor: 'agent',
      autonomyLevel: 'L3',
      type: 'decision',
    });
  });

  it('does not add a step for a control mode that is not implemented yet', () => {
    const onAdd = vi.fn();
    renderFullTier(onAdd);

    const assist = optionButton('assist');
    expect(assist).toBeDisabled();
    expect(assist).toHaveTextContent(/coming soon/i);

    fireEvent.click(assist);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('BlockPicker pre-made blocks (Simple tier)', () => {
  const CATEGORY_LABEL: Record<string, string> = {
    people: 'People',
    communicate: 'Communicate',
    data: 'Data',
    ai: 'AI',
    control: 'Control',
  };

  /** Categories fold one at a time, so a block is in the DOM only once opened. */
  function expandCategory(category: string): void {
    fireEvent.click(screen.getByRole('button', { name: CATEGORY_LABEL[category] }));
  }

  it('opens on Simple with the first category expanded', () => {
    render(<BlockPicker onAdd={() => {}} />);

    expect(screen.getByTestId('preset-option-collect-input')).toBeInTheDocument();
    expect(screen.queryByTestId('executor-option-script')).not.toBeInTheDocument();
  });

  it('folds one category at a time, like the step editor', () => {
    render(<BlockPicker onAdd={() => {}} />);

    expect(screen.getByTestId('preset-option-collect-input')).toBeInTheDocument();

    expandCategory('communicate');

    expect(screen.getByTestId('preset-option-send-email')).toBeInTheDocument();
    expect(screen.queryByTestId('preset-option-collect-input')).not.toBeInTheDocument();
  });

  it('describes every pre-made block, not just its name', () => {
    render(<BlockPicker onAdd={() => {}} />);

    for (const category of Object.keys(CATEGORY_LABEL)) {
      const presets = BLOCK_PRESETS.filter((preset) => preset.category === category);
      if (presets.length === 0) continue;
      if (screen.queryByTestId(`preset-option-${presets[0].id}`) === null) expandCategory(category);
      for (const preset of presets) {
        expect(screen.getByTestId(`preset-option-${preset.id}`)).toHaveTextContent(preset.purpose);
      }
    }
  });

  it('states no description with an em dash, which reads badly in a tooltip', () => {
    for (const preset of BLOCK_PRESETS) {
      expect(preset.purpose).not.toContain('\u2014');
    }
  });

  it('adds the block fully configured, carrying its own step type', () => {
    const onAdd = vi.fn();
    render(<BlockPicker onAdd={onAdd} />);

    expandCategory('control');
    fireEvent.click(screen.getByTestId('preset-option-route-by-condition'));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'decision' }));
  });

  it('seeds an action block with its kind, so it is never inserted config-less', () => {
    const onAdd = vi.fn();
    render(<BlockPicker onAdd={onAdd} />);

    expandCategory('communicate');
    fireEvent.click(screen.getByTestId('preset-option-send-email'));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: 'action',
        action: expect.objectContaining({ kind: 'email' }),
      }),
    );
  });

  it('gives a review block its verdicts, which the schema requires', () => {
    const onAdd = vi.fn();
    render(<BlockPicker onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId('preset-option-ask-for-approval'));

    const payload = onAdd.mock.calls[0][0];
    expect(payload.type).toBe('review');
    expect(Object.keys(payload.verdicts)).toEqual(['approve', 'reject']);
  });
});
