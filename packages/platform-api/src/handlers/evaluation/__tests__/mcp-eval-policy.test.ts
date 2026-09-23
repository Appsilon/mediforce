import { describe, it, expect } from 'vitest';
import { getMcpEvalPolicy, setMcpEvalPolicy } from '../mcp-eval-policy';
import { evaluationFixture, STEP } from './fixture';

describe('MCP eval policy', () => {
  it('denies every server of the step\'s agent until declared safe', async () => {
    const fixture = await evaluationFixture();
    expect((await getMcpEvalPolicy(STEP, fixture.scope())).servers).toEqual([
      { name: 'edc', mode: 'deny', defaulted: true },
      { name: 'email', mode: 'deny', defaulted: true },
    ]);

    await setMcpEvalPolicy({ ...STEP, servers: { edc: { mode: 'live', denyTools: ['write_record'] } } }, fixture.scope());
    expect((await getMcpEvalPolicy(STEP, fixture.scope())).servers).toEqual([
      { name: 'edc', mode: 'live', denyTools: ['write_record'], defaulted: false },
      { name: 'email', mode: 'deny', defaulted: true },
    ]);
  });

  it('refuses a server the agent does not bind, and denied tools with no allowlist', async () => {
    const fixture = await evaluationFixture();
    await expect(setMcpEvalPolicy({ ...STEP, servers: { slack: { mode: 'live' } } }, fixture.scope()))
      .rejects.toThrow(/not an MCP server of this step's agent/);
    await expect(setMcpEvalPolicy({ ...STEP, servers: { email: { mode: 'live', denyTools: ['send'] } } }, fixture.scope()))
      .rejects.toThrow(/lists no allowedTools/);
  });
});
