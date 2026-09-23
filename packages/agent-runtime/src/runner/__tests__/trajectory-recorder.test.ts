import { describe, expect, it } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryAgentTrajectoryRepository,
  type AgentTrajectoryRepository,
  type StoredAgentTrajectoryEntry,
} from '@mediforce/platform-core';
import { TrajectoryRecorder } from '../trajectory-recorder';

const AGENT_RUN_ID = '0b8f7c9e-1f7a-4a53-9d2c-3c1f3a4d5e6f';

async function setup(): Promise<InMemoryAgentTrajectoryRepository> {
  const agentRuns = new InMemoryAgentRunRepository();
  await agentRuns.create({
    id: AGENT_RUN_ID,
    processInstanceId: 'instance-1',
    stepId: 'extract',
    pluginId: 'claude-code-agent',
    autonomyLevel: 'L2',
    status: 'running',
    envelope: null,
    fallbackReason: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  });
  return new InMemoryAgentTrajectoryRepository(agentRuns);
}

const toolCall = {
  ts: '2026-09-23T08:00:00.000Z',
  type: 'assistant',
  subtype: 'tool_call',
  tool: 'Read',
  input: { file_path: '/data/patient-042.csv' },
};

describe('TrajectoryRecorder', () => {
  it('numbers entries from 0 across flushes and keeps full content', async () => {
    const repo = await setup();
    const recorder = new TrajectoryRecorder(repo, AGENT_RUN_ID);

    recorder.record([toolCall]);
    await recorder.flush();
    recorder.record([{ ts: '2026-09-23T08:00:01.000Z', type: 'assistant', subtype: 'text', text: 'Grade 3 neutropenia' }]);
    await recorder.flush();

    const entries = await repo.list(AGENT_RUN_ID);
    expect(entries?.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(entries?.[0]).toMatchObject({ tool: 'Read', input: { file_path: '/data/patient-042.csv' } });
    expect(entries?.[1]?.text).toBe('Grade 3 neutropenia');
  });

  it('flushes on its own after the interval', async () => {
    const repo = await setup();
    const recorder = new TrajectoryRecorder(repo, AGENT_RUN_ID, { flushIntervalMs: 5 });

    recorder.record([toolCall]);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(await repo.list(AGENT_RUN_ID)).toHaveLength(1);
  });

  it('never throws when the store rejects a write', async () => {
    const failing: AgentTrajectoryRepository = {
      append: async (_agentRunId: string, _entries: readonly StoredAgentTrajectoryEntry[]) => {
        throw new Error('connection reset');
      },
      list: async () => null,
      listInNamespaces: async () => null,
    };
    const recorder = new TrajectoryRecorder(failing, AGENT_RUN_ID, { retryDelayMs: 1 });

    recorder.record([toolCall]);
    await expect(recorder.flush()).resolves.toBeUndefined();
  });

  it('retries a failed batch before anything later, writing the backlog as one batch', async () => {
    const repo = await setup();
    const appendedSeqs: number[][] = [];
    let failuresLeft = 1;
    const flaky: AgentTrajectoryRepository = {
      append: async (agentRunId, entries) => {
        appendedSeqs.push(entries.map((entry) => entry.seq));
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error('connection reset');
        }
        await repo.append(agentRunId, entries);
      },
      list: (agentRunId, options) => repo.list(agentRunId, options),
      listInNamespaces: (agentRunId, allowed, options) => repo.listInNamespaces(agentRunId, allowed, options),
    };
    const recorder = new TrajectoryRecorder(flaky, AGENT_RUN_ID, { retryDelayMs: 20 });
    const text = (body: string) => ({ ts: '2026-09-23T08:00:01.000Z', type: 'assistant', subtype: 'text', text: body });

    recorder.record([toolCall]);
    const first = recorder.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appendedSeqs).toEqual([[0]]);
    recorder.record([text("Hy's Law case")]);
    const second = recorder.flush();
    recorder.record([text('Grade 4 hepatotoxicity')]);
    await Promise.all([first, second, recorder.flush()]);

    expect(appendedSeqs).toEqual([[0], [0], [1, 2]]);
    expect((await repo.list(AGENT_RUN_ID))?.map((entry) => entry.seq)).toEqual([0, 1, 2]);
  });
});
