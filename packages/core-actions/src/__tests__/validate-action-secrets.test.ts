import { describe, expect, it } from 'vitest';
import { validateActionSecrets } from '../validate-action-secrets.js';

const step = (id: string, config: unknown) => ({
  id,
  name: id,
  executor: 'action' as const,
  action: { kind: 'http' as const, config },
});

describe('validateActionSecrets', () => {
  it('detects missing secrets in url', () => {
    const steps = [step('fetch', { method: 'GET', url: 'https://api.example.com?key=${secrets.API_KEY}' })];
    const result = validateActionSecrets(steps, {});
    expect(result).toHaveLength(1);
    expect(result[0].secretName).toBe('API_KEY');
    expect(result[0].steps[0].stepId).toBe('fetch');
  });

  it('passes when secret exists', () => {
    const steps = [step('fetch', { method: 'GET', url: 'https://api.example.com?key=${secrets.API_KEY}' })];
    const result = validateActionSecrets(steps, { API_KEY: 'abc123' });
    expect(result).toHaveLength(0);
  });

  it('detects missing secrets in nested body', () => {
    const steps = [step('post', {
      method: 'POST',
      url: 'https://api.example.com',
      body: { token: '${secrets.TOKEN}', user: '${secrets.USER}' },
    })];
    const result = validateActionSecrets(steps, { TOKEN: 'tok' });
    expect(result).toHaveLength(1);
    expect(result[0].secretName).toBe('USER');
  });

  it('detects secrets in arrays', () => {
    const steps = [step('email', {
      to: ['${secrets.ADMIN_EMAIL}'],
      subject: 'test',
      body: 'hi',
    })];
    const result = validateActionSecrets(steps, {});
    expect(result).toHaveLength(1);
    expect(result[0].secretName).toBe('ADMIN_EMAIL');
  });

  it('skips non-action steps', () => {
    const steps = [{ id: 'review', name: 'review', executor: 'human' }];
    const result = validateActionSecrets(steps, {});
    expect(result).toHaveLength(0);
  });

  it('deduplicates across steps', () => {
    const steps = [
      step('s1', { url: 'https://x?k=${secrets.KEY}' }),
      step('s2', { url: 'https://y?k=${secrets.KEY}' }),
    ];
    const result = validateActionSecrets(steps, {});
    expect(result).toHaveLength(1);
    expect(result[0].steps).toHaveLength(2);
  });

  it('treats empty string secret as missing', () => {
    const steps = [step('fetch', { url: '${secrets.KEY}' })];
    const result = validateActionSecrets(steps, { KEY: '' });
    expect(result).toHaveLength(1);
  });

  it('ignores non-secret interpolation', () => {
    const steps = [step('fetch', { url: 'https://x/${steps.prev.id}' })];
    const result = validateActionSecrets(steps, {});
    expect(result).toHaveLength(0);
  });
});
