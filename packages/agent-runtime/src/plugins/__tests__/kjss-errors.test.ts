import { describe, it, expect } from 'vitest';
import {
  KjssError,
  KjssImagePullError,
  KjssSchedulingError,
  KjssAuthError,
  KjssApiError,
  KjssOutputDirTooLargeError,
} from '../kjss-errors';

describe('KjssError hierarchy', () => {
  it('all subclasses inherit from KjssError', () => {
    expect(new KjssImagePullError('reason', 'msg')).toBeInstanceOf(KjssError);
    expect(new KjssSchedulingError('msg', [])).toBeInstanceOf(KjssError);
    expect(new KjssAuthError('msg')).toBeInstanceOf(KjssError);
    expect(new KjssApiError('msg', 500)).toBeInstanceOf(KjssError);
    expect(new KjssOutputDirTooLargeError(900_001, 900_000)).toBeInstanceOf(KjssError);
  });

  it('each subclass has a unique code', () => {
    expect(new KjssImagePullError('r', 'm').code).toBe('IMAGE_PULL');
    expect(new KjssSchedulingError('m', []).code).toBe('SCHEDULING');
    expect(new KjssAuthError('m').code).toBe('AUTH');
    expect(new KjssApiError('m', 500).code).toBe('API');
    expect(new KjssOutputDirTooLargeError(1, 0).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('ImagePullError carries reason + message', () => {
    const e = new KjssImagePullError('ImagePullBackOff', 'image not found');
    expect(e.reason).toBe('ImagePullBackOff');
    expect(e.message).toContain('image not found');
  });

  it('OutputDirTooLargeError surfaces observed + limit byte counts in the message', () => {
    const e = new KjssOutputDirTooLargeError(1_200_000, 900_000);
    expect(e.observedBytes).toBe(1_200_000);
    expect(e.limitBytes).toBe(900_000);
    expect(e.message).toContain('1200000');
    expect(e.message).toContain('900000');
  });
});
