import { describe, expect, it } from 'vitest';
import {
  DOCKER_REPOSITORY_PATTERN,
  PULL_IMAGE_PATTERN,
  PULL_REFERENCE_PATTERN,
  daemonRepositoryName,
  isRegistryHost,
  normalizeImageRef,
  splitImageRef,
  untaggedReference,
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

  it('refuses a malformed host, so it is a 400 and never a failed pull', () => {
    for (const reference of ['./image', '../image', 'foo..bar/image', '-ghcr.io/acme/agent', 'ghcr.io-/acme/agent', 'ghcr.io:99999999/acme/agent']) {
      expect(PULL_REFERENCE_PATTERN.test(reference), reference).toBe(false);
      expect(PULL_IMAGE_PATTERN.test(`${reference}:v1`), reference).toBe(false);
    }
  });

  it('takes exactly reference:tag for the image a worker pulls, never a flag', () => {
    expect(PULL_IMAGE_PATTERN.test('ghcr.io/acme/agent:v1.0.0')).toBe(true);
    expect(PULL_IMAGE_PATTERN.test('--all-tags')).toBe(false);
    expect(PULL_IMAGE_PATTERN.test('alpine')).toBe(false);
  });

  it('drops a tag and keeps a registry port', () => {
    expect(untaggedReference('python:3.12-slim')).toBe('python');
    expect(untaggedReference('rocker/r-ver:4')).toBe('rocker/r-ver');
    expect(untaggedReference('mediforce-golden-image')).toBe('mediforce-golden-image');
    // The colon is the port, not a tag — the whole reason this is not a split.
    expect(untaggedReference('localhost:5000/acme/agent')).toBe('localhost:5000/acme/agent');
    expect(untaggedReference('localhost:5000/acme/agent:v1')).toBe('localhost:5000/acme/agent');
  });
});

describe('normalizeImageRef', () => {
  it.each([
    ['alpine', 'alpine:3.22'],
    ['rocker/r-ver', 'rocker/r-ver:4.4'],
    ['ghcr.io/acme/agent', 'ghcr.io/acme/agent:v1'],
    ['localhost:5000/acme/agent', 'localhost:5000/acme/agent:latest'],
  ])('adds the implicit latest tag to %s', (untagged, tagged) => {
    expect(normalizeImageRef(untagged)).toBe(`${untagged}:latest`);
    expect(normalizeImageRef(tagged)).toBe(tagged);
  });

  it('leaves a digest reference alone — it pins an image, not a tag', () => {
    expect(normalizeImageRef('alpine@sha256:abc')).toBe('alpine@sha256:abc');
    expect(normalizeImageRef('localhost:5000/acme/agent@sha256:abc')).toBe(
      'localhost:5000/acme/agent@sha256:abc',
    );
  });
});

describe('splitImageRef', () => {
  it.each([
    ['alpine', 'alpine', 'latest'],
    ['alpine:3.22', 'alpine', '3.22'],
    ['rocker/r-ver:4.4', 'rocker/r-ver', '4.4'],
    ['localhost:5000/acme/agent', 'localhost:5000/acme/agent', 'latest'],
    ['localhost:5000/acme/agent:v1', 'localhost:5000/acme/agent', 'v1'],
  ])('splits %s into %s at %s', (ref, repository, tag) => {
    expect(splitImageRef(ref)).toEqual({ repository, tag });
  });
});
