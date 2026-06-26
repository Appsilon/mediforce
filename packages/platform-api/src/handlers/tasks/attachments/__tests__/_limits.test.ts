import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_ATTACHMENT_MAX_BYTES, attachmentMaxBytes } from '../_limits';

const ENV_KEY = 'MEDIFORCE_ATTACHMENT_MAX_BYTES';

describe('attachmentMaxBytes', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });

  it('returns the default (100 MiB) when the env var is unset', () => {
    delete process.env[ENV_KEY];
    expect(attachmentMaxBytes()).toBe(104_857_600);
    expect(DEFAULT_ATTACHMENT_MAX_BYTES).toBe(104_857_600);
  });

  it('honors a valid override', () => {
    process.env[ENV_KEY] = '2048';
    expect(attachmentMaxBytes()).toBe(2048);
  });

  it('clamps an override above the hard ceiling down to 100 MiB', () => {
    process.env[ENV_KEY] = String(104_857_600 + 1);
    expect(attachmentMaxBytes()).toBe(104_857_600);
  });

  it('throws on a non-positive value', () => {
    process.env[ENV_KEY] = '0';
    expect(() => attachmentMaxBytes()).toThrow();
  });

  it('throws on a non-integer value', () => {
    process.env[ENV_KEY] = '1.5';
    expect(() => attachmentMaxBytes()).toThrow();
  });
});
