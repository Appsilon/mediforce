import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userInviteCommand } from '../commands/user-invite.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_RESPONSE = {
  uid: 'uid-new',
  email: 'eva@example.com',
  temporaryPassword: 'AbCd1234!Eva',
  emailSent: true,
  isExisting: false,
};

describe('user invite command', () => {
  it('POSTs /api/users/invite with email + namespaceHandle + role', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    const code = await userInviteCommand({
      argv: [
        '--email', 'eva@example.com',
        '--namespace', 'ns-1',
        '--role', 'admin',
        '--display-name', 'Eva Nowak',
      ],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toMatch(/\/api\/users\/invite$/);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as {
      email: string;
      namespaceHandle: string;
      role: string;
      displayName: string;
    };
    expect(body.email).toBe('eva@example.com');
    expect(body.namespaceHandle).toBe('ns-1');
    expect(body.role).toBe('admin');
    expect(body.displayName).toBe('Eva Nowak');
    const stdout = output.stdoutLines.join('\n');
    expect(stdout).toMatch(/User invited/);
    expect(stdout).toMatch(/AbCd1234!Eva/);
  });

  it('falls back to role=member when --role omitted (applied by client Zod default)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    await userInviteCommand({
      argv: ['--email', 'eva@example.com', '--namespace', 'ns-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0]![1]?.body as string,
    ) as { role: string };
    expect(body.role).toBe('member');
  });

  it('exits 2 on invalid --role enum value', async () => {
    const output = captureOutput();
    const code = await userInviteCommand({
      argv: ['--email', 'eva@example.com', '--namespace', 'ns-1', '--role', 'superuser'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });

  it('exits 2 when required flags missing', async () => {
    const output = captureOutput();
    const code = await userInviteCommand({
      argv: ['--email', 'eva@example.com'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });

  it('emits JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    await userInviteCommand({
      argv: ['--email', 'eva@example.com', '--namespace', 'ns-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { uid: string };
    expect(parsed.uid).toBe('uid-new');
  });
});
