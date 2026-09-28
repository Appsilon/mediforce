import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { getMcpEvalPolicy, setMcpEvalPolicy } from '../mcp-eval-policy';
import { evaluationFixture, STEP } from './fixture';

describe('MCP eval policy', () => {
  it('denies every server of the step\'s agent until declared safe', async () => {
    const fixture = await evaluationFixture();
    expect((await getMcpEvalPolicy(STEP, fixture.scope())).servers).toEqual([
      { name: 'edc', mode: 'deny', defaulted: true, recordedCaseIds: [] },
      { name: 'email', mode: 'deny', defaulted: true, recordedCaseIds: [] },
    ]);

    await setMcpEvalPolicy({ ...STEP, servers: { edc: { mode: 'live', denyTools: ['write_record'] } } }, fixture.scope());
    expect((await getMcpEvalPolicy(STEP, fixture.scope())).servers).toEqual([
      { name: 'edc', mode: 'live', denyTools: ['write_record'], defaulted: false, recordedCaseIds: [] },
      { name: 'email', mode: 'deny', defaulted: true, recordedCaseIds: [] },
    ]);
  });

  it('replays a server, and says which cases a live trial recorded it for', async () => {
    const fixture = await evaluationFixture();
    const caseId = randomUUID();
    await fixture.evaluationRepo.appendMcpRecording({
      ...STEP, id: randomUUID(), caseId, server: 'edc', tape: { tools: [], calls: [] },
      evalRunId: randomUUID(), trialId: randomUUID(), recordedAt: '2026-09-23T08:00:00.000Z',
    });

    await setMcpEvalPolicy({ ...STEP, servers: { edc: { mode: 'replay' } } }, fixture.scope());

    expect((await getMcpEvalPolicy(STEP, fixture.scope())).servers).toEqual([
      { name: 'edc', mode: 'replay', defaulted: false, recordedCaseIds: [caseId] },
      { name: 'email', mode: 'deny', defaulted: true, recordedCaseIds: [] },
    ]);
  });

  it('refuses a server the agent does not bind, and denied tools with no allowlist', async () => {
    const fixture = await evaluationFixture();
    await expect(setMcpEvalPolicy({ ...STEP, servers: { slack: { mode: 'live' } } }, fixture.scope()))
      .rejects.toThrow(/not an MCP server of this step's agent/);
    await expect(setMcpEvalPolicy({ ...STEP, servers: { email: { mode: 'live', denyTools: ['send'] } } }, fixture.scope()))
      .rejects.toThrow(/lists no allowedTools/);
    await expect(setMcpEvalPolicy({ ...STEP, servers: { edc: { mode: 'replay', denyTools: ['write_record'] } } }, fixture.scope()))
      .rejects.toThrow(/denyTools applies to a live server/);
  });
});
