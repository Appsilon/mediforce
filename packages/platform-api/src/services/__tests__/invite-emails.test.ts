import { describe, it, expect, vi } from 'vitest';
import type { SendEmailParams } from '@mediforce/platform-core';
import { sendInviteSetupEmail } from '../invite-emails';

// The account-setup email copy branches on workspace context: the admin invite
// flow names the inviter + workspace, the self-service resend flow (no context)
// uses generic copy. Both still carry the same 7-day sign-in link.

function captureSend() {
  const calls: SendEmailParams[] = [];
  const sendEmail = vi.fn(async (params: SendEmailParams) => {
    calls.push(params);
    return { messageId: 'test-message-id' };
  });
  return { calls, sendEmail };
}

describe('sendInviteSetupEmail', () => {
  it('[WORKSPACE] names the inviter and workspace when context is present', async () => {
    const { calls, sendEmail } = captureSend();

    await sendInviteSetupEmail(
      {
        toEmail: 'invitee@example.test',
        inviterName: 'Ada Lovelace',
        workspaceName: 'Trial Alpha',
        activationUrl: 'https://app.test/api/auth/callback/email?token=abc',
        appUrl: 'https://app.test',
        senderName: 'Mediforce',
      },
      sendEmail,
    );

    const sent = calls[0];
    expect(sent.html).toContain('Set up your account');
    expect(sent.html).toContain('Ada Lovelace');
    expect(sent.html).toContain('Trial Alpha');
    expect(sent.text).toContain('Ada Lovelace invited you to Trial Alpha');
    expect(sent.html).toContain('https://app.test/api/auth/callback/email?token=abc');
  });

  it('[GENERIC] uses account-only copy when workspace context is absent', async () => {
    const { calls, sendEmail } = captureSend();

    await sendInviteSetupEmail(
      {
        toEmail: 'invitee@example.test',
        activationUrl: 'https://app.test/api/auth/callback/email?token=xyz',
        appUrl: 'https://app.test',
        senderName: 'Mediforce',
      },
      sendEmail,
    );

    const sent = calls[0];
    expect(sent.html).toContain('Finish setting up your account');
    expect(sent.html).toContain('set your password for your Mediforce account');
    expect(sent.html).not.toContain('invited you to');
    expect(sent.text).toContain('Finish setting up your Mediforce account.');
    expect(sent.html).toContain('https://app.test/api/auth/callback/email?token=xyz');
  });
});
