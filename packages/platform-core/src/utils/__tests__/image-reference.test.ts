import { describe, expect, it } from 'vitest';
import {
  DOCKER_REPOSITORY_PATTERN,
  PULL_IMAGE_PATTERN,
  PULL_REFERENCE_PATTERN,
  daemonRepositoryName,
  isRegistryHost,
} from '../image-reference';

describe('daemonRepositoryName', () => {
  it.each([
    ['docker.io/library/python', 'python'],
    ['index.docker.io/library/python', 'python'],
    ['library/python', 'python'],
    ['docker.io/rocker/r-ver', 'rocker/r-ver'],
    ['rocker/r-ver', 'rocker/r-ver'],
    ['python', 'python'],
    ['ghcr.io/acme/agent', 'ghcr.io/acme/agent'],
    ['localhost:5000/library/agent', 'localhost:5000/library/agent'],
  ])('lists %s as %s', (reference, listed) => {
    expect(daemonRepositoryName(reference)).toBe(listed);
  });
});

describe('isRegistryHost', () => {
  it.each([
    ['ghcr.io', true],
    ['localhost', true],
    ['registry:5000', true],
    ['acme', false],
    ['rocker', false],
  ])('%s → %s', (segment, expected) => {
    expect(isRegistryHost(segment)).toBe(expected);
  });
});

describe('reference patterns', () => {
  it('takes a repository path with no host or tag for an upload name', () => {
    expect(DOCKER_REPOSITORY_PATTERN.test('acme/agent')).toBe(true);
    expect(DOCKER_REPOSITORY_PATTERN.test('ghcr.io:443/acme/agent')).toBe(false);
    expect(DOCKER_REPOSITORY_PATTERN.test('acme/agent:v1')).toBe(false);
  });

  it('takes a registry host with a port for a pull, and no tag', () => {
    expect(PULL_REFERENCE_PATTERN.test('localhost:5000/acme/agent')).toBe(true);
    expect(PULL_REFERENCE_PATTERN.test('rocker/r-ver')).toBe(true);
    expect(PULL_REFERENCE_PATTERN.test('alpine:3.22')).toBe(false);
    expect(PULL_REFERENCE_PATTERN.test('alpine@sha256:abc')).toBe(false);
  });

  it('takes exactly reference:tag for the image a worker pulls, never a flag', () => {
    expect(PULL_IMAGE_PATTERN.test('ghcr.io/acme/agent:v1.0.0')).toBe(true);
    expect(PULL_IMAGE_PATTERN.test('--all-tags')).toBe(false);
    expect(PULL_IMAGE_PATTERN.test('alpine')).toBe(false);
  });
});
