import { describe, it, expect, vi, beforeEach } from 'vitest';
import { namespaceListMembersCommand } from '../commands/namespace-list-members';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

const OWNER = {
  uid: 'eYXLZwrKyMYKDgn3m3FZbd8KUqW2',
  role: 'owner',
  displayName: 'Krystian Zielinski',
  email: 'krystian@example.com',
  lastSignInTime: '2026-08-24T10:00:00.000Z',
  joinedAt: '2026-06-22T08:49:20.194Z',
  grants: [
    { role: 'reviewer', workflowName: null },
    { role: 'analyst', workflowName: 'tealflow' },
  ],
};

const PLAIN_MEMBER = {
  uid: 'abc123',
  role: 'member',
  displayName: null,
  email: null,
  lastSignInTime: null,
  joinedAt: '2026-08-01T00:00:00.000Z',
  grants: [],
};

describe('namespace list-members command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await namespaceListMembersCommand({
      argv: ['--help'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce namespace list-members/);
  });

  it('lists each member with their process roles', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ members: [OWNER, PLAIN_MEMBER] }),
    );
    const output = captureOutput();
    const code = await namespaceListMembersCommand({
      argv: ['krystian-zielinski'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/Members of krystian-zielinski \(2\)/);
    // Process roles are sorted, so the output is stable across grant order,
    // and a grant narrowed to one workflow prints as `role@workflow` — bare,
    // it would be indistinguishable from a workspace-wide `analyst`.
    expect(text).toMatch(/analyst@tealflow, reviewer/);
    expect(text).toMatch(/Krystian Zielinski/);
  });

  it('labels the two role columns distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ members: [OWNER] }));
    const output = captureOutput();
    await namespaceListMembersCommand({
      argv: ['krystian-zielinski'],
      env: BASE_ENV,
      output,
    });
    // `owner|admin|member` and `reviewer|PI|…` are different things that both
    // live on a member — the header has to say which column is which, or the
    // read path re-creates the confusion `set-member-role(s)` already causes.
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/MEMBERSHIP/);
    expect(text).toMatch(/PROCESS ROLES/);
  });

  it('renders a member holding no process roles as (none)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ members: [PLAIN_MEMBER] }),
    );
    const output = captureOutput();
    const code = await namespaceListMembersCommand({
      argv: ['krystian-zielinski'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/\(none\)/);
  });

  it('emits the raw payload when --json set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ members: [OWNER] }));
    const output = captureOutput();
    const code = await namespaceListMembersCommand({
      argv: ['krystian-zielinski', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as {
      members: Array<{ uid: string; grants: Array<{ role: string; workflowName: string | null }> }>;
    };
    expect(parsed.members[0]!.grants).toEqual([
      { role: 'reviewer', workflowName: null },
      { role: 'analyst', workflowName: 'tealflow' },
    ]);
  });

  it('reports an empty roster rather than printing a bare header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ members: [] }));
    const output = captureOutput();
    const code = await namespaceListMembersCommand({
      argv: ['empty-org'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No members in "empty-org"/);
  });

  it('queries the handle it was given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ members: [] }));
    const output = captureOutput();
    await namespaceListMembersCommand({
      argv: ['krystian-zielinski', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/api/users/members');
    expect(url).toContain('namespace=krystian-zielinski');
  });

  it('exits 2 when the handle is missing', async () => {
    const output = captureOutput();
    const code = await namespaceListMembersCommand({
      argv: [],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
  });

  it('exits 1 on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Forbidden' }, 403),
    );
    const output = captureOutput();
    const code = await namespaceListMembersCommand({
      argv: ['krystian-zielinski', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { status: number };
    expect(parsed.status).toBe(403);
  });
});
