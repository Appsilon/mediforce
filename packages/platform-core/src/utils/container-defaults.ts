import { daemonRepositoryName, untaggedReference } from './image-reference';
import type { ImageCatalogSource } from '../schemas/image-catalog-entry';

/**
 * Image an agent step falls back to when it names neither an image nor a build
 * source. Applied on registration; the editor labels its blank option with it
 * so the picker and the persisted definition tell the same story.
 */
export const DEFAULT_AGENT_IMAGE = 'mediforce-golden-image';

/**
 * Runtime → the image the engine runs an inline `script.runtime` step in when
 * the step names none. `ScriptContainerPlugin` reads it for the run; the Image
 * Catalog reads it to seed a new workspace (#1376), so a changed image moves
 * both at once instead of leaving a catalog row pointing at the old one.
 */
export const DEFAULT_SCRIPT_RUNTIME_IMAGES = {
  javascript: 'mediforce-node:latest',
  python: 'python:3.12-slim',
  r: 'rocker/r-ver:4',
  bash: 'alpine:3.19',
} as const;

/** One image every workspace's catalog is seeded with, as a catalog row. */
export interface DefaultImageCatalogEntry {
  /** Human handle for the row. */
  name: string;
  /**
   * The sentence the catalog requires (ADR-0022 decision 2). Written by a
   * human — once, here — and about platform behaviour rather than a
   * workspace's purpose, which is why a seed may carry one and a derived
   * entry may not.
   */
  intent: string;
  /** Repository with no tag: what a `referenced` entry is keyed on. */
  reference: string;
}

/** The repository the daemon lists an engine default under. */
function seedReference(image: string): string {
  return daemonRepositoryName(untaggedReference(image));
}

/**
 * The images a step falls back to when it names none, as the rows a new
 * workspace's catalog starts with (#1376).
 *
 * Derived from the engine's own constants, never a second list: a workspace
 * that catalogued nothing used to get an empty catalog and a picker showing
 * every image on the shared daemon, and the first row anyone added flipped it
 * to catalogue-only — dropping the picker to that one image.
 */
export const DEFAULT_IMAGE_CATALOG_ENTRIES: readonly DefaultImageCatalogEntry[] = [
  {
    name: 'Golden image',
    intent: 'The image the engine runs an agent step in when the step names neither an image nor a build source.',
    reference: seedReference(DEFAULT_AGENT_IMAGE),
  },
  {
    name: 'JavaScript runtime',
    intent: 'The image the engine runs a JavaScript script step in when the step names none.',
    reference: seedReference(DEFAULT_SCRIPT_RUNTIME_IMAGES.javascript),
  },
  {
    name: 'Python runtime',
    intent: 'The image the engine runs a Python script step in when the step names none.',
    reference: seedReference(DEFAULT_SCRIPT_RUNTIME_IMAGES.python),
  },
  {
    name: 'R runtime',
    intent: 'The image the engine runs an R script step in when the step names none.',
    reference: seedReference(DEFAULT_SCRIPT_RUNTIME_IMAGES.r),
  },
  {
    name: 'Bash runtime',
    intent: 'The image the engine runs a Bash script step in when the step names none.',
    reference: seedReference(DEFAULT_SCRIPT_RUNTIME_IMAGES.bash),
  },
];

/**
 * Whether a source names an image the engine itself falls back to.
 *
 * Derived from the reference rather than a stored marker, so it stays true for
 * a row a member has renamed or re-described, and for one catalogued by hand
 * before seeding existed. Deleting such a row is ordinary; deleting the
 * **image** behind it is not, because the daemon is deployment-wide and a step
 * that names no image pins nothing for the live-pin check to find (#1376).
 */
export function isDefaultEngineImageSource(source: ImageCatalogSource): boolean {
  if (source.kind !== 'referenced') return false;
  const reference = seedReference(source.reference);
  return DEFAULT_IMAGE_CATALOG_ENTRIES.some((entry) => entry.reference === reference);
}
