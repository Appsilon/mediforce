import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_IMAGE,
  DEFAULT_IMAGE_CATALOG_ENTRIES,
  DEFAULT_SCRIPT_RUNTIME_IMAGES,
  isDefaultEngineImageSource,
} from '../container-defaults';

describe('the engine defaults a new workspace is seeded with', () => {
  it('covers the agent default and every script runtime, and nothing else', () => {
    // Derived, never hand-written: a changed runtime image must move the seed
    // with it rather than leaving the catalog offering the old one (#1376).
    expect(DEFAULT_IMAGE_CATALOG_ENTRIES).toHaveLength(
      1 + Object.keys(DEFAULT_SCRIPT_RUNTIME_IMAGES).length,
    );
  });

  it('keys every seed on a repository with no tag and no Docker Hub prefix', () => {
    for (const entry of DEFAULT_IMAGE_CATALOG_ENTRIES) {
      expect(entry.reference, entry.reference).not.toContain(':');
      expect(entry.reference, entry.reference).not.toContain('library/');
      expect(entry.intent.length, entry.reference).toBeGreaterThan(0);
    }
    expect(DEFAULT_IMAGE_CATALOG_ENTRIES.map((entry) => entry.reference)).toEqual([
      DEFAULT_AGENT_IMAGE,
      'mediforce-node',
      'python',
      'rocker/r-ver',
      'alpine',
    ]);
  });

  it('recognises a default however its reference is spelled', () => {
    expect(isDefaultEngineImageSource({ kind: 'referenced', reference: 'python' })).toBe(true);
    expect(isDefaultEngineImageSource({ kind: 'referenced', reference: 'docker.io/library/python' })).toBe(true);
    expect(isDefaultEngineImageSource({ kind: 'referenced', reference: 'rocker/r-ver' })).toBe(true);
  });

  it('recognises nothing else — a workspace image of its own stays deletable', () => {
    expect(isDefaultEngineImageSource({ kind: 'referenced', reference: 'ghcr.io/acme/python' })).toBe(false);
    expect(isDefaultEngineImageSource({ kind: 'referenced', reference: 'acme/alpine-tools' })).toBe(false);
    expect(
      isDefaultEngineImageSource({ kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'Dockerfile' }),
    ).toBe(false);
  });
});
