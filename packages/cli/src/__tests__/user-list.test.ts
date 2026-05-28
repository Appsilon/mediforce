import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userListCommand } from '../commands/user-list.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_MEMBERS = {
  members: [
    {
      uid: 'uid-1',
      role: 'admin',
      displayName: 'Eva Nowak',
      joinedAt: '2026-01-10T10:00:00.000Z',
      email: 'eva@example.com',
      lastSignInTime: '2026-05-26T18:00:00.000Z',
    },
    {
      uid: 'uid-2',
      role: 'member',
      joinedAt: '2026-03-01T10:00:00.000Z',
      email: null,
      lastSignInTime: null,
    },
  ],
};

describe('user list command', () => {
  it('GETs /api/users/members with namespace query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_MEMBERS));
    const output = captureOutput();
    const code = await userListCommand({
      argv: ['--namespace', 'ns-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/\/api\/users\/members/);
    expect(url).toMatch(/namespace=ns-1/);
    const stdout = output.stdoutLines.join('\n');
    expect(stdout).toMatch(/admin/);
    expect(stdout).toMatch(/eva@example.com/);
    expect(stdout).toMatch(/Eva Nowak/);
    expect(stdout).toMatch(/never/);
  });

  it('exits 2 when --namespace missing', async () => {
    const output = captureOutput();
    const code = await userListCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });

  it('emits JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_MEMBERS));
    const output = captureOutput();
    await userListCommand({
      argv: ['--namespace', 'ns-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { members: unknown[] };
    expect(parsed.members.length).toBe(2);
  });

  it('handles empty members', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ members: [] }));
    const output = captureOutput();
    const code = await userListCommand({
      argv: ['--namespace', 'ns-empty'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No members/);
  });
});
