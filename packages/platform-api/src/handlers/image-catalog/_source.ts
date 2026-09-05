import { createHash } from 'node:crypto';
import { normalizeRepoUrls, type ImageCatalogSource } from '@mediforce/platform-core';

/**
 * Canonicalise a source before it becomes a key.
 *
 * A built source's repo goes through `normalizeRepoUrls` because that is the
 * form the builder writes into `mediforce.build.repo`, so an entry catalogued
 * as `Appsilon/tealflow` and one catalogued as
 * `git@github.com:Appsilon/tealflow.git` are the same entry — and both match
 * the images actually on the daemon.
 */
export function canonicalizeSource(source: ImageCatalogSource): ImageCatalogSource {
  return source.kind === 'built'
    ? {
        kind: 'built',
        repo: normalizeRepoUrls(source.repo).gitUrl,
        dockerfile: source.dockerfile,
      }
    : source;
}

/** The exact bytes the id hashes, mirroring `deriveBuildTag`'s NUL joining. */
function sourceFingerprint(source: ImageCatalogSource): string {
  return source.kind === 'built'
    ? `built\0${source.repo}\0${source.dockerfile}`
    : `referenced\0${source.reference}`;
}

/** Last path segment, lowercased, non-alphanumeric runs collapsed to '-'. */
function slugify(value: string): string {
  const basename = value.split('/').pop() ?? value;
  return basename
    .replace(/\.git$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The entry's id, derived from its canonicalised source (ADR-0021 decision 1).
 *
 * Readable half plus hash half, and both halves earn their place: the slug is
 * what a person reads in `mediforce images list` and in a URL, and the hash is
 * what makes "one entry per source" a property of the primary key rather than
 * a convention a handler could forget. Two Dockerfiles in one repo slug the
 * same and differ in the hash, which is correct — they are two images.
 *
 * Clients never supply an id. An entry's key is its source, so accepting one
 * would let two rows describe the same image.
 */
export function deriveImageCatalogEntryId(source: ImageCatalogSource): string {
  const canonical = canonicalizeSource(source);
  const hash = createHash('sha256')
    .update(sourceFingerprint(canonical))
    .digest('hex')
    .slice(0, 8);
  const slug = slugify(
    canonical.kind === 'built' ? canonical.repo : canonical.reference,
  );
  return slug.length > 0 ? `${slug}-${hash}` : hash;
}
