import { describe, it, expect } from 'vitest';
import { buildAgentRun, buildAgentOutputEnvelope } from '@mediforce/platform-core/testing';
import { formatAgentRunContainer } from '../agent-container';

describe('formatAgentRunContainer', () => {
  it('[DATA] returns "no data" when the run has no envelope', () => {
    const run = buildAgentRun({ envelope: null });
    expect(formatAgentRunContainer(run)).toBe('no data');
  });

  it('[DATA] returns "no data" when reasoning_chain has no execution-mode entry', () => {
    const run = buildAgentRun({
      envelope: buildAgentOutputEnvelope({ reasoning_chain: ['Invoked skill: x', 'CLI execution completed'] }),
    });
    expect(formatAgentRunContainer(run)).toBe('no data');
  });

  it('[DATA] extracts the docker image name when run inside a container', () => {
    const run = buildAgentRun({
      envelope: buildAgentOutputEnvelope({
        reasoning_chain: ['Invoked skill: x', 'Docker container: mediforce-golden-image:latest', 'CLI execution completed'],
      }),
    });
    expect(formatAgentRunContainer(run)).toBe('mediforce-golden-image:latest');
  });

  it('[DATA] returns a no-container phrase for local execution, distinct from "no data"', () => {
    const run = buildAgentRun({
      envelope: buildAgentOutputEnvelope({
        reasoning_chain: ['Invoked skill: x', 'Local execution (no Docker)', 'CLI execution completed'],
      }),
    });
    expect(formatAgentRunContainer(run)).toBe('No container (ran locally)');
  });
});
