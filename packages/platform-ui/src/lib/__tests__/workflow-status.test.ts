import { describe, it, expect } from 'vitest';
import { getWorkflowStatus } from '../workflow-status';

describe('getWorkflowStatus', () => {
  describe('completed', () => {
    it('maps completed to completed', () => {
      const result = getWorkflowStatus({ status: 'completed' });
      expect(result.displayStatus).toBe('completed');
      expect(result.reason).toBeNull();
      expect(result.isRetryable).toBe(false);
    });
  });

  describe('in_progress', () => {
    it('maps running to in_progress', () => {
      const result = getWorkflowStatus({ status: 'running' });
      expect(result.displayStatus).toBe('in_progress');
      expect(result.isRetryable).toBe(false);
    });

    it('maps created to in_progress', () => {
      const result = getWorkflowStatus({ status: 'created' });
      expect(result.displayStatus).toBe('in_progress');
    });
  });

  describe('waiting_for_human', () => {
    it('waiting_for_human reason', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'waiting_for_human' });
      expect(result.displayStatus).toBe('waiting_for_human');
      expect(result.reason).toBe('Waiting for human task');
      expect(result.rawReason).toBe('waiting_for_human');
      expect(result.isRetryable).toBe(false);
    });

    it('awaiting_agent_approval reason', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'awaiting_agent_approval' });
      expect(result.displayStatus).toBe('waiting_for_human');
      expect(result.reason).toBe('Waiting for agent approval review');
      expect(result.isRetryable).toBe(false);
    });

    it('cowork_in_progress reason', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'cowork_in_progress' });
      expect(result.displayStatus).toBe('waiting_for_human');
      expect(result.reason).toBe('Cowork session in progress');
      expect(result.isRetryable).toBe(false);
    });

    it('agent_escalated reason — waiting_for_human and retryable', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'agent_escalated' });
      expect(result.displayStatus).toBe('waiting_for_human');
      expect(result.reason).toBe('Agent escalated to human review');
      expect(result.isRetryable).toBe(true);
    });

    it('agent_paused reason — waiting_for_human and retryable', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'agent_paused' });
      expect(result.displayStatus).toBe('waiting_for_human');
      expect(result.reason).toBe('Agent requested human review');
      expect(result.isRetryable).toBe(true);
    });
  });

  describe('error', () => {
    it('step_failure reason uses instance error message', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'step_failure', error: 'Docker exit code 1' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Docker exit code 1');
      expect(result.isRetryable).toBe(true);
    });

    it('step_failure without error falls back to generic message', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'step_failure' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Step execution failed');
      expect(result.isRetryable).toBe(true);
    });

    it('routing_error is retryable', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'routing_error' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Workflow routing error');
      expect(result.isRetryable).toBe(true);
    });

    it('max_iterations_exceeded is not retryable', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'max_iterations_exceeded' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Maximum review iterations exceeded');
      expect(result.isRetryable).toBe(false);
    });

    it('missing_env is not retryable', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'missing_env' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Missing environment configuration');
      expect(result.rawReason).toBe('missing_env');
      expect(result.isRetryable).toBe(false);
    });

    it('status=failed with Cancelled by user is not retryable', () => {
      const result = getWorkflowStatus({ status: 'failed', error: 'Cancelled by user' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Cancelled by user');
      expect(result.isRetryable).toBe(false);
    });

    it('status=failed with other error is retryable', () => {
      const result = getWorkflowStatus({ status: 'failed', error: 'Agent timeout after 30s' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Agent timeout after 30s');
      expect(result.isRetryable).toBe(true);
    });

    it('status=failed without error uses fallback message and is retryable', () => {
      const result = getWorkflowStatus({ status: 'failed' });
      expect(result.displayStatus).toBe('error');
      expect(result.reason).toBe('Process failed');
      expect(result.isRetryable).toBe(true);
    });

    it('unknown pause reason falls back to error', () => {
      const result = getWorkflowStatus({ status: 'paused', pauseReason: 'something_new' });
      expect(result.displayStatus).toBe('error');
      expect(result.rawReason).toBe('something_new');
      expect(result.isRetryable).toBe(false);
    });
  });
});
