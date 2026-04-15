import { describe, it, expect } from 'vitest';
import { getProcessStatusDisplay } from '../process-status-display';

describe('getProcessStatusDisplay', () => {
  // --- Non-paused statuses ---

  it('running → Running / running color', () => {
    const result = getProcessStatusDisplay('running');
    expect(result).toEqual({ label: 'Running', colorKey: 'running', resumable: false });
  });

  it('completed → Completed / completed color', () => {
    const result = getProcessStatusDisplay('completed');
    expect(result).toEqual({ label: 'Completed', colorKey: 'completed', resumable: false });
  });

  it('failed → Failed / failed color', () => {
    const result = getProcessStatusDisplay('failed');
    expect(result).toEqual({ label: 'Failed', colorKey: 'failed', resumable: false });
  });

  it('created → Created / created color', () => {
    const result = getProcessStatusDisplay('created');
    expect(result).toEqual({ label: 'Created', colorKey: 'created', resumable: false });
  });

  // --- Paused: waiting reasons (not resumable — have dedicated UIs) ---

  it('paused + waiting_for_human → Waiting for action / amber / not resumable', () => {
    const result = getProcessStatusDisplay('paused', 'waiting_for_human');
    expect(result.label).toBe('Waiting for action');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(false);
  });

  it('paused + awaiting_agent_approval → Waiting for review / amber / not resumable', () => {
    const result = getProcessStatusDisplay('paused', 'awaiting_agent_approval');
    expect(result.label).toBe('Waiting for review');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(false);
  });

  it('paused + cowork_in_progress → Co-work / amber / not resumable', () => {
    const result = getProcessStatusDisplay('paused', 'cowork_in_progress');
    expect(result.label).toBe('Co-work');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(false);
  });

  it('paused + missing_env → Missing config / amber / not resumable', () => {
    const result = getProcessStatusDisplay('paused', 'missing_env');
    expect(result.label).toBe('Missing config');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(false);
  });

  // --- Paused: agent handoff reasons (resumable) ---

  it('paused + agent_escalated → Waiting for action / amber / resumable', () => {
    const result = getProcessStatusDisplay('paused', 'agent_escalated');
    expect(result.label).toBe('Waiting for action');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(true);
  });

  it('paused + agent_paused → Waiting for action / amber / resumable', () => {
    const result = getProcessStatusDisplay('paused', 'agent_paused');
    expect(result.label).toBe('Waiting for action');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(true);
  });

  // --- Paused: error/blocked reasons (resumable) ---

  it('paused + step_failure → Blocked / red / resumable', () => {
    const result = getProcessStatusDisplay('paused', 'step_failure');
    expect(result.label).toBe('Blocked');
    expect(result.colorKey).toBe('blocked');
    expect(result.resumable).toBe(true);
  });

  it('paused + routing_error → Blocked / red / resumable', () => {
    const result = getProcessStatusDisplay('paused', 'routing_error');
    expect(result.label).toBe('Blocked');
    expect(result.colorKey).toBe('blocked');
    expect(result.resumable).toBe(true);
  });

  it('paused + max_iterations_exceeded → Blocked / red / resumable', () => {
    const result = getProcessStatusDisplay('paused', 'max_iterations_exceeded');
    expect(result.label).toBe('Blocked');
    expect(result.colorKey).toBe('blocked');
    expect(result.resumable).toBe(true);
  });

  // --- Edge cases ---

  it('paused without pauseReason → Paused / amber / resumable', () => {
    const result = getProcessStatusDisplay('paused');
    expect(result.label).toBe('Paused');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(true);
  });

  it('paused with null pauseReason → Paused / amber / resumable', () => {
    const result = getProcessStatusDisplay('paused', null);
    expect(result.label).toBe('Paused');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(true);
  });

  it('paused with unknown pauseReason → Paused / amber / resumable', () => {
    const result = getProcessStatusDisplay('paused', 'some_future_reason');
    expect(result.label).toBe('Paused');
    expect(result.colorKey).toBe('waiting');
    expect(result.resumable).toBe(true);
  });

  it('unknown status → uses status as label / created color / not resumable', () => {
    const result = getProcessStatusDisplay('archived');
    expect(result.label).toBe('archived');
    expect(result.colorKey).toBe('created');
    expect(result.resumable).toBe(false);
  });
});
