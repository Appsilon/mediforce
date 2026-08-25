import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { BlockPicker } from '../block-picker';
import { EXECUTOR_SECTIONS, STEP_TYPE_OPTIONS } from '@/lib/block-presets';
import { BLOCK_PRESETS } from '@mediforce/platform-core';
import type { NewStepPayload } from '@/lib/control-mode';

// Capability state is injected rather than fetched, so the render stays
// synchronous. `null` means "unknown", which keeps every block enabled.
const capabilityState = vi.hoisted(() => ({
  value: null as Record<string, { available: boolean; detail?: string; reason?: string }> | null,
}));
vi.mock('@/hooks/use-capabilities', () => ({
  useCapabilities: () => ({ capabilities: capabilityState.value, loading: false }),
}));

afterEach(() => { capabilityState.value = null; });

function renderPicker(onAdd: (payload: NewStepPayload) => void = () => {}): void {
  render(<BlockPicker onAdd={onAdd} onClose={() => {}} />);
}

function renderFullTier(onAdd: (payload: NewStepPayload) => void = () => {}): void {
  renderPicker(onAdd);
  fireEvent.click(screen.getByTestId('picker-tier-full'));
}

/**
 * Sections fold one at a time, so the card holding an option has to be open
 * before that option exists. Idempotent — clicking an already-open card would
 * toggle it shut.
 */
function openSection(key: string): void {
  const card = screen.getByTestId(`section-${key}`);
  if (card.getAttribute('data-open') === 'true') return;
  fireEvent.click(card.querySelector('button') as HTMLElement);
}

function optionButton(id: string): HTMLElement {
  return screen.getByTestId(`executor-option-${id}`);
}

function stepTypeButton(value: string): HTMLElement {
  return screen.getByTestId(`step-type-option-${value}`);
}

/** Opens the executor card holding `optionId`, then returns that option. */
function executorOption(optionId: string): HTMLElement {
  const section = EXECUTOR_SECTIONS.find((candidate) =>
    candidate.options.some((option) => option.id === optionId));
  if (section === undefined) throw new Error(`no executor section holds ${optionId}`);
  openSection(section.id);
  return optionButton(optionId);
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

  it('keeps the step type in the header card, visible whatever is folded', () => {
    renderFullTier();

    openSection('agent');

    expect(screen.getByTestId('step-type-option-creation')).toBeInTheDocument();
    expect(screen.getByTestId('step-type-option-decision')).toBeInTheDocument();
    expect(screen.queryByTestId('section-step-type')).not.toBeInTheDocument();
  });
});

describe('BlockPicker executor guidance (#1186)', () => {
  it('explains every executor option, not just its name', () => {
    renderFullTier();

    for (const section of EXECUTOR_SECTIONS) {
      for (const option of section.options) {
        expect(executorOption(option.id)).toHaveTextContent(option.purpose);
      }
    }
  });

  it('states what each executor is for in the wording the golden rules use', () => {
    renderFullTier();

    expect(executorOption('human')).toHaveTextContent(/accountability, approval/i);
    expect(executorOption('script')).toHaveTextContent(/deterministic/i);
    expect(executorOption('action')).toHaveTextContent(/email/i);
    expect(executorOption('cowork')).toHaveTextContent(/real time/i);
    expect(executorOption('human-review')).toHaveTextContent(/approves/i);
    expect(executorOption('autonomous-agent')).toHaveTextContent(/no approval/i);
  });

  it('splits Full into two cards, folded shut until asked for', () => {
    renderFullTier();

    expect(screen.getByTestId('section-no-agent')).toHaveTextContent('No agent');
    expect(screen.getByTestId('section-agent')).toHaveTextContent('Agent');
    expect(screen.queryByTestId('executor-option-cowork')).not.toBeInTheDocument();

    openSection('agent');
    expect(screen.getByTestId('executor-option-cowork')).toBeInTheDocument();

    openSection('no-agent');
    expect(screen.queryByTestId('executor-option-cowork')).not.toBeInTheDocument();
    expect(screen.getByTestId('executor-option-script')).toBeInTheDocument();
  });

  it('gathers every mode that runs an agent into the Agent card', () => {
    renderFullTier();

    openSection('agent');
    for (const id of ['assist', 'cowork', 'human-review', 'autonomous-agent']) {
      expect(optionButton(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('executor-option-human')).not.toBeInTheDocument();

    openSection('no-agent');
    for (const id of ['human', 'script', 'action']) {
      expect(optionButton(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('executor-option-autonomous-agent')).not.toBeInTheDocument();
  });

  it('adds the executor the clicked option describes', () => {
    const onAdd = vi.fn();
    renderFullTier(onAdd);

    fireEvent.click(executorOption('script'));

    expect(onAdd).toHaveBeenCalledWith({ executor: 'script', type: 'creation' });
  });

  it('carries the selected step type into the added step', () => {
    const onAdd = vi.fn();
    renderFullTier(onAdd);

    fireEvent.click(stepTypeButton('decision'));
    fireEvent.click(executorOption('human-review'));

    expect(onAdd).toHaveBeenCalledWith({
      executor: 'agent',
      autonomyLevel: 'L3',
      type: 'decision',
    });
  });

  it('does not add a step for a control mode that is not implemented yet', () => {
    const onAdd = vi.fn();
    renderFullTier(onAdd);

    const assist = executorOption('assist');
    expect(assist).toHaveAttribute('aria-disabled', 'true');
    expect(assist).toHaveTextContent(/coming soon/i);

    fireEvent.click(assist);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('greys Assist alone, leaving the modes it now shares a card with selectable', () => {
    const onAdd = vi.fn();
    renderFullTier(onAdd);

    openSection('agent');
    for (const id of ['cowork', 'human-review', 'autonomous-agent']) {
      expect(optionButton(id)).not.toHaveAttribute('aria-disabled');
    }

    fireEvent.click(optionButton('cowork'));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ executor: 'cowork' }));
  });
});

describe('BlockPicker pre-made blocks (Simple tier)', () => {
  it('opens on Simple with only the first category expanded', () => {
    renderPicker();

    expect(screen.getByTestId('preset-option-collect-input')).toBeInTheDocument();
    expect(screen.queryByTestId('preset-option-send-email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('executor-option-script')).not.toBeInTheDocument();
  });

  it('opening a category closes the one that was open', () => {
    renderPicker();

    openSection('communicate');

    expect(screen.getByTestId('preset-option-send-email')).toBeInTheDocument();
    expect(screen.queryByTestId('preset-option-collect-input')).not.toBeInTheDocument();
  });

  it('describes every pre-made block, not just its name', () => {
    renderPicker();

    for (const preset of BLOCK_PRESETS) {
      openSection(preset.category);
      expect(screen.getByTestId(`preset-option-${preset.id}`)).toHaveTextContent(preset.purpose);
    }
  });

  it('draws each block the way the canvas draws it, executor and step type included', () => {
    renderPicker();

    openSection('communicate');
    const sendEmail = screen.getByTestId('preset-option-send-email');
    expect(sendEmail).toHaveTextContent('Action');
    expect(sendEmail).toHaveTextContent('Creation');

    openSection('control');
    expect(screen.getByTestId('preset-option-route-by-condition')).toHaveTextContent('Decision');
  });

  it('states no description with an em dash, which reads badly in a tooltip', () => {
    for (const preset of BLOCK_PRESETS) {
      expect(preset.purpose).not.toContain('—');
    }
  });

  it('offers no review-typed block, since the designer no longer creates them', () => {
    for (const preset of BLOCK_PRESETS) {
      expect(preset.payload.type).not.toBe('review');
    }
  });

  it('adds the block fully configured, carrying its own step type', () => {
    const onAdd = vi.fn();
    renderPicker(onAdd);

    openSection('control');
    fireEvent.click(screen.getByTestId('preset-option-route-by-condition'));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'decision' }));
  });

  it('seeds an action block with its kind, so it is never inserted config-less', () => {
    const onAdd = vi.fn();
    renderPicker(onAdd);

    openSection('communicate');
    fireEvent.click(screen.getByTestId('preset-option-send-email'));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: 'action',
        action: expect.objectContaining({ kind: 'email' }),
      }),
    );
  });

  it('greys an unavailable block but still reveals why on hover', () => {
    capabilityState.value = {
      email: { available: false, reason: 'No email delivery is configured on this instance.' },
    };
    const onAdd = vi.fn();
    renderPicker(onAdd);

    openSection('communicate');
    const sendEmail = screen.getByTestId('preset-option-send-email');
    expect(sendEmail).toHaveAttribute('aria-disabled', 'true');

    // A `disabled` button would fire no pointer events and take no focus, so the
    // tooltip trigger could never fire. `aria-disabled` is the guard: this
    // assertion fails if the option regresses to a real `disabled`.
    expect(sendEmail).toHaveTextContent('No email delivery is configured on this instance.');

    fireEvent.click(sendEmail);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('badges an available block with how the instance provides it', () => {
    capabilityState.value = { email: { available: true, detail: 'smtp' } };
    renderPicker();

    openSection('communicate');
    expect(screen.getByTestId('preset-option-send-email')).toHaveTextContent('smtp');
  });

  it('closes the panel from the header card', () => {
    const onClose = vi.fn();
    render(<BlockPicker onAdd={() => {}} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
