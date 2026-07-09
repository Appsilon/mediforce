import { describe, it, expect } from 'vitest';
import { isImageAvailable } from '../use-docker-images';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';

const IMAGES: DockerImageInfo[] = [
  { repository: 'mediforce/golden-image', tag: 'latest', id: 'abc123', size: '1.2GB', created: '2 days ago' },
  { repository: 'mediforce/golden-image', tag: 'v2.1', id: 'def456', size: '1.1GB', created: '1 week ago' },
  { repository: 'node', tag: '20-slim', id: 'ghi789', size: '200MB', created: '3 weeks ago' },
];

describe('isImageAvailable', () => {
  it('matches repo:tag exactly', () => {
    expect(isImageAvailable(IMAGES, 'mediforce/golden-image:v2.1')).toBe(true);
  });

  it('defaults to latest tag when no tag specified', () => {
    expect(isImageAvailable(IMAGES, 'mediforce/golden-image')).toBe(true);
  });

  it('returns false for missing image', () => {
    expect(isImageAvailable(IMAGES, 'mediforce/nonexistent:latest')).toBe(false);
  });

  it('returns false for wrong tag', () => {
    expect(isImageAvailable(IMAGES, 'mediforce/golden-image:v3.0')).toBe(false);
  });

  it('returns false for empty image list', () => {
    expect(isImageAvailable([], 'anything')).toBe(false);
  });
});
