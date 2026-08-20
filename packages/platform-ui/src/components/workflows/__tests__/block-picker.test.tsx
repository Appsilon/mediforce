import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { BlockPicker } from '../block-picker';
import { CM_ROWS, STEP_TYPE_OPTIONS } from '@/lib/block-presets';

function optionButton(id: string): HTMLElement {
  return screen.getByTestId(`executor-option-${id}`);
}

function stepTypeButton(value: string): HTMLElement {
  return screen.getByTestId(`step-type-option-${value}`);
}

describe('BlockPicker step type guidance (#1186)', () => {
  it('explains every step type, not just its name', () => {
    render(<BlockPicker onAdd={() => {}} />);

    for (const option of STEP_TYPE_OPTIONS) {
      expect(stepTypeButton(option.value)).toHaveTextContent(option.purpose);
    }
  });

  it('states what each step type is for in the wording the golden rules use', () => {
    render(<BlockPicker onAdd={() => {}} />);

    expect(stepTypeButton('creation')).toHaveTextContent(/produces a result/i);
    expect(stepTypeButton('decision')).toHaveTextContent(/which branch/i);
  });
});

describe('BlockPicker executor guidance (#1186)', () => {
  it('explains every executor option, not just its name', () => {
    render(<BlockPicker onAdd={() => {}} />);

    for (const row of CM_ROWS) {
      for (const button of row.buttons) {
        expect(optionButton(button.id)).toHaveTextContent(button.purpose);
      }
    }
  });

  it('states what each executor is for in the wording the golden rules use', () => {
    render(<BlockPicker onAdd={() => {}} />);

    expect(optionButton('human')).toHaveTextContent(/accountability, approval/i);
    expect(optionButton('script')).toHaveTextContent(/deterministic/i);
    expect(optionButton('action')).toHaveTextContent(/email/i);
    expect(optionButton('cowork')).toHaveTextContent(/real time/i);
    expect(optionButton('human-review')).toHaveTextContent(/approves/i);
    expect(optionButton('autonomous-agent')).toHaveTextContent(/no approval/i);
  });

  it('adds the executor the clicked option describes', () => {
    const onAdd = vi.fn();
    render(<BlockPicker onAdd={onAdd} />);

    fireEvent.click(optionButton('script'));

    expect(onAdd).toHaveBeenCalledWith({ executor: 'script', type: 'creation' });
  });

  it('carries the selected step type into the added step', () => {
    const onAdd = vi.fn();
    render(<BlockPicker onAdd={onAdd} />);

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
    render(<BlockPicker onAdd={onAdd} />);

    const assist = optionButton('assist');
    expect(assist).toBeDisabled();
    expect(assist).toHaveTextContent(/coming soon/i);

    fireEvent.click(assist);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
