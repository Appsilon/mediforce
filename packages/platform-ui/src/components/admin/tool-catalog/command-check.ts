import { DEFAULT_AGENT_IMAGE, type ImageCommandCheck } from '@mediforce/platform-core';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';

/** Launchers an MCP stdio server is typically started with. Suggestions for the
 *  field, not a claim about any image: availability always comes from a probe,
 *  and anything else may be typed. */
export const COMMAND_SUGGESTIONS = ['npx', 'uvx', 'node', 'python3', 'uv', 'docker'] as const;

export interface CommandCheckImage {
  /** `repository:tag` the daemon lists — what the check is asked about. */
  value: string;
  label: string;
}

/** The images a command can be checked against: the default agent image the
 *  step falls back to, then every version of a catalogued entry the daemon
 *  still holds. */
export function commandCheckImages(entries: readonly ImageCatalogEntryView[]): CommandCheckImage[] {
  const images: CommandCheckImage[] = [
    { value: DEFAULT_AGENT_IMAGE, label: `Default agent image (${DEFAULT_AGENT_IMAGE})` },
  ];
  const seen = new Set<string>([DEFAULT_AGENT_IMAGE, `${DEFAULT_AGENT_IMAGE}:latest`]);
  for (const entry of entries) {
    if (entry.availability === 'absent') continue;
    for (const version of entry.versions) {
      if (seen.has(version.imageTag)) continue;
      seen.add(version.imageTag);
      images.push({ value: version.imageTag, label: `${entry.name} (${version.imageTag})` });
    }
  }
  return images;
}

export interface CommandCheckMessage {
  tone: 'ok' | 'warning' | 'muted';
  text: string;
}

/** Unknown is never a warning: nobody could answer, which is not the answer no
 *  (ADR-0022 decision 2). */
export function describeCommandCheck(check: ImageCommandCheck, command: string): CommandCheckMessage {
  if (check.status === 'unknown') {
    return { tone: 'muted', text: `Could not determine whether \`${command}\` is available in this image.` };
  }
  if (check.available) {
    const where = check.path === undefined ? '' : ` (${check.path})`;
    return { tone: 'ok', text: `\`${command}\` is available in this image${where}.` };
  }
  return {
    tone: 'warning',
    text: `\`${command}\` is not available in this image. Steps using an agent bound to this server need an image that provides it.`,
  };
}
