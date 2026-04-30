import { describe, expect, it, vi } from 'vitest';
import { createEmailActionHandler } from '../email.js';
import type { ActionContext } from '../../types.js';

const baseCtx: ActionContext = {
  stepId: 'send-email',
  processInstanceId: 'inst-1',
  sources: {
    triggerPayload: {},
    steps: { lookup: { email: 'user@example.com', name: 'Alice' } },
    variables: { lookup: { email: 'user@example.com', name: 'Alice' } },
    secrets: {},
  },
};

describe('createEmailActionHandler', () => {
  it('interpolates to/subject/body and sends email', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'msg-123' });
    const handler = createEmailActionHandler(sendEmail);

    const result = await handler(
      {
        to: '${steps.lookup.email}',
        subject: 'Hello ${steps.lookup.name}',
        body: 'Dear ${steps.lookup.name}, welcome.',
      },
      baseCtx,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({
      to: ['user@example.com'],
      subject: 'Hello Alice',
      text: 'Dear Alice, welcome.',
    });
    expect(result.messageId).toBe('msg-123');
    expect(result.status).toBe('sent');
    expect(result.to).toEqual(['user@example.com']);
  });

  it('supports array of recipients', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'msg-456' });
    const handler = createEmailActionHandler(sendEmail);

    const result = await handler(
      {
        to: ['alice@example.com', 'bob@example.com'],
        subject: 'Test',
        body: 'Hello all.',
      },
      baseCtx,
    );

    expect(sendEmail.mock.calls[0][0].to).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.to).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('interpolates recipients in array', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'msg' });
    const handler = createEmailActionHandler(sendEmail);

    await handler(
      {
        to: ['${steps.lookup.email}', 'static@example.com'],
        subject: 'Test',
        body: 'Hello.',
      },
      baseCtx,
    );

    expect(sendEmail.mock.calls[0][0].to).toEqual(['user@example.com', 'static@example.com']);
  });

  it('passes optional cc/bcc/replyTo/from/html', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'msg-789' });
    const handler = createEmailActionHandler(sendEmail);

    await handler(
      {
        to: 'user@example.com',
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        from: 'sender@example.com',
        replyTo: 'reply@example.com',
        subject: 'Test',
        body: 'Text body',
        html: '<p>HTML body</p>',
      },
      baseCtx,
    );

    const params = sendEmail.mock.calls[0][0];
    expect(params.cc).toEqual(['cc@example.com']);
    expect(params.bcc).toEqual(['bcc@example.com']);
    expect(params.from).toBe('sender@example.com');
    expect(params.replyTo).toBe('reply@example.com');
    expect(params.html).toBe('<p>HTML body</p>');
  });

  it('omits optional fields when not configured', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'msg' });
    const handler = createEmailActionHandler(sendEmail);

    await handler(
      { to: 'a@x.com', subject: 's', body: 'b' },
      baseCtx,
    );

    const params = sendEmail.mock.calls[0][0];
    expect(params.cc).toBeUndefined();
    expect(params.bcc).toBeUndefined();
    expect(params.from).toBeUndefined();
    expect(params.replyTo).toBeUndefined();
    expect(params.html).toBeUndefined();
  });

  it('enforces per-run rate limit', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'msg' });
    const handler = createEmailActionHandler(sendEmail, { perRun: 2, perMinute: 100 });

    await handler({ to: 'a@x.com', subject: 's', body: 'b' }, baseCtx);
    await handler({ to: 'b@x.com', subject: 's', body: 'b' }, baseCtx);

    await expect(
      handler({ to: 'c@x.com', subject: 's', body: 'b' }, baseCtx),
    ).rejects.toThrow('Email rate limit exceeded: 2 emails per workflow run');
  });

  it('per-run limit is scoped to processInstanceId', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'msg' });
    const handler = createEmailActionHandler(sendEmail, { perRun: 1, perMinute: 100 });

    await handler({ to: 'a@x.com', subject: 's', body: 'b' }, baseCtx);

    await handler(
      { to: 'b@x.com', subject: 's', body: 'b' },
      { ...baseCtx, processInstanceId: 'inst-2' },
    );

    await expect(
      handler({ to: 'c@x.com', subject: 's', body: 'b' }, baseCtx),
    ).rejects.toThrow('rate limit');
  });

  it('propagates sendEmail errors', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('Mailgun 403: forbidden'));
    const handler = createEmailActionHandler(sendEmail);

    await expect(
      handler({ to: 'a@x.com', subject: 's', body: 'b' }, baseCtx),
    ).rejects.toThrow('Mailgun 403: forbidden');
  });
});
