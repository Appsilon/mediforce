import { describe, it, expect } from 'vitest';
import { inlineMcpServerNames, mcpEvalRestrictions, narrowMcpRestrictions } from '../mcp-eval-restrictions';

describe('mcpEvalRestrictions (ADR-0023 D6)', () => {
  it('denies every server the policy does not name', () => {
    expect(mcpEvalRestrictions(['edc-read', 'email'], {})).toEqual({
      'edc-read': { disable: true },
      email: { disable: true },
    });
  });

  it('keeps a live server and adds its denied tools to the step restriction', () => {
    const restrictions = mcpEvalRestrictions(
      ['edc'],
      { edc: { mode: 'live', denyTools: ['write_record'] } },
      { edc: { denyTools: ['delete_record'] } },
    );
    expect(restrictions).toEqual({ edc: { denyTools: ['delete_record', 'write_record'] } });
  });

  it('adds nothing for a live server with no denied tools', () => {
    expect(mcpEvalRestrictions(['meddra'], { meddra: { mode: 'live' } })).toEqual({});
  });

  it('keeps step restrictions on servers the agent no longer binds', () => {
    expect(mcpEvalRestrictions([], {}, { legacy: { disable: true } })).toEqual({ legacy: { disable: true } });
  });

  it('disables a server the policy denies even when the step only narrowed it', () => {
    expect(mcpEvalRestrictions(['email'], { email: { mode: 'deny' } }, { email: { denyTools: ['send_bulk'] } }))
      .toEqual({ email: { denyTools: ['send_bulk'], disable: true } });
  });
});

describe('inlineMcpServerNames', () => {
  it('names the servers a step declares inline, and none for a step without', () => {
    expect(inlineMcpServerNames({ agent: { mcpServers: [{ name: 'edc', command: 'edc-mcp', args: [] }] } })).toEqual(['edc']);
    expect(inlineMcpServerNames({})).toEqual([]);
  });
});

describe('narrowMcpRestrictions', () => {
  it('never re-enables a disabled server', () => {
    expect(narrowMcpRestrictions({ edc: { disable: true } }, { edc: { denyTools: ['read_record'] } }))
      .toEqual({ edc: { disable: true, denyTools: ['read_record'] } });
  });
});
