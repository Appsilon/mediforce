import { describe, it, expect } from 'vitest';
import { createTestScope } from '../../../testing/index';
import { InMemoryJoinLinkService } from '../../../testing/index';
import { requireJoinLinkService, toJoinLinkView } from '../_shared';
import type { JoinLink } from '../../../services/join-link';
import { PreconditionFailedError } from '../../../errors';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-07T12:00:00.000Z');

function link(overrides: Partial<JoinLink> = {}): JoinLink {
  return {
    id: 'link-1',
    workspace: 'alpha',
    expiresAt: new Date(NOW.getTime() + HOUR).toISOString(),
    maxUses: null,
    uses: 0,
    createdBy: 'admin-1',
    createdAt: NOW.toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

describe('requireJoinLinkService', () => {
  it('returns the wired store', () => {
    const joinLinkService = new InMemoryJoinLinkService();
    expect(requireJoinLinkService(createTestScope({ joinLinkService }))).toBe(joinLinkService);
  });

  it('throws a precondition failure rather than 500ing on an unwired deployment', () => {
    expect(() => requireJoinLinkService(createTestScope({ joinLinkService: null }))).toThrow(
      PreconditionFailedError,
    );
  });
});

describe('toJoinLinkView', () => {
  it('renames workspace to namespaceHandle and derives an active status', () => {
    expect(toJoinLinkView(link(), NOW)).toEqual({
      id: 'link-1',
      namespaceHandle: 'alpha',
      expiresAt: new Date(NOW.getTime() + HOUR).toISOString(),
      maxUses: null,
      uses: 0,
      createdBy: 'admin-1',
      createdAt: NOW.toISOString(),
      revokedAt: null,
      status: 'active',
    });
  });

  // Revoked outranks expired outranks exhausted: an admin's deliberate act is
  // the most useful thing to tell someone, and the store applies the same
  // ordering when it refuses a redemption.
  it('ranks revoked above expired above exhausted', () => {
    const past = new Date(NOW.getTime() - HOUR).toISOString();
    expect(
      toJoinLinkView(
        link({ revokedAt: NOW.toISOString(), expiresAt: past, maxUses: 1, uses: 1 }),
        NOW,
      ).status,
    ).toBe('revoked');
    expect(toJoinLinkView(link({ expiresAt: past, maxUses: 1, uses: 1 }), NOW).status).toBe('expired');
    expect(toJoinLinkView(link({ maxUses: 1, uses: 1 }), NOW).status).toBe('exhausted');
  });

  it('treats an uncapped link as active however many times it was used', () => {
    expect(toJoinLinkView(link({ maxUses: null, uses: 500 }), NOW).status).toBe('active');
  });
});
