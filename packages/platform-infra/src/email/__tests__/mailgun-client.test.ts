import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailgunSender } from '../mailgun-client';

describe('createMailgunSender', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables click and open tracking for every message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '<message-id@example.com>' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const send = createMailgunSender({
      apiKey: 'key-123',
      domain: 'mg.example.com',
      defaultFrom: 'noreply@example.com',
      defaultSenderName: 'Example Team',
    });

    await send({
      to: ['alice@example.com'],
      subject: 'Sign in',
      text: 'Use this link to sign in.',
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const formData = new URLSearchParams(request?.body);
    expect(formData.get('o:tracking-clicks')).toBe('no');
    expect(formData.get('o:tracking-opens')).toBe('no');
  });
});
