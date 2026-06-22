import { describe, it, expect } from 'vitest';
import { KjssError, KjssImagePullError, KjssSchedulingError, KjssAuthError, KjssApiError } from '../kjss-errors';

describe('KjssError hierarchy', () => {
  it('all subclasses inherit from KjssError', () => {
    expect(new KjssImagePullError('reason', 'msg')).toBeInstanceOf(KjssError);
    expect(new KjssSchedulingError('msg', [])).toBeInstanceOf(KjssError);
    expect(new KjssAuthError('msg')).toBeInstanceOf(KjssError);
    expect(new KjssApiError('msg', 500)).toBeInstanceOf(KjssError);
  });

  it('each subclass has a unique code', () => {
    expect(new KjssImagePullError('r', 'm').code).toBe('IMAGE_PULL');
    expect(new KjssSchedulingError('m', []).code).toBe('SCHEDULING');
    expect(new KjssAuthError('m').code).toBe('AUTH');
    expect(new KjssApiError('m', 500).code).toBe('API');
  });

  it('ImagePullError carries reason + message', () => {
    const e = new KjssImagePullError('ImagePullBackOff', 'image not found');
    expect(e.reason).toBe('ImagePullBackOff');
    expect(e.message).toContain('image not found');
  });
});
