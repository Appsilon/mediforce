import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userResendInviteCommand } from '../commands/user-resend-invite.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_RESPONSE = {
  uid: 'uid-1',
  email: 'eva@example.com',
  temporaryPassword: 'NewPw9876!',
  emailSent: true,
};

describe('user resend-invite command', () => {
  it('POSTs /api/users/resend-invite with uid + namespaceHandle', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    const code = await userResendInviteCommand({
      argv: ['--uid', 'uid-1', '--namespace', 'ns-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toMatch(/\/api\/users\/resend-invite$/);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as { uid: string; namespaceHandle: string };
    expect(body).toEqual({ uid: 'uid-1', namespaceHandle: 'ns-1' });
    const stdout = output.stdoutLines.join('\n');
    expect(stdout).toMatch(/Invite resent/);
    expect(stdout).toMatch(/NewPw9876!/);
  });

  it('exits 2 when --uid missing', async () => {
    const output = captureOutput();
    const code = await userResendInviteCommand({
      argv: ['--namespace', 'ns-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });

  it('emits JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    await userResendInviteCommand({
      argv: ['--uid', 'uid-1', '--namespace', 'ns-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { emailSent: boolean };
    expect(parsed.emailSent).toBe(true);
  });
});
