'use client';

import React from 'react';
import { DEFAULT_AGENT_IMAGE } from '@mediforce/platform-core';
import type { ImagePickerGroup } from './image-picker-options';

/**
 * What the agent picker puts in the definition for a chosen image.
 *
 * `mediforce-golden-image:latest` collapses to the untagged form because that
 * is what registration persists; without it a step already carrying the
 * untagged default would match no option and be silently rewritten on save.
 */
export function pickerImageValue(image: string): string {
  return image === `${DEFAULT_AGENT_IMAGE}:latest` ? DEFAULT_AGENT_IMAGE : image;
}

/** The script picker saves the reference as-is — the normalisation above is
 *  about the agent default, which script steps do not have. */
export function identityImageValue(image: string): string {
  return image;
}

/** Whether the picker already offers this value, so the step's own image is
 *  only appended as an extra option when nothing else carries it. */
export function offersValue(
  groups: ImagePickerGroup[],
  value: string,
  normalize: (ref: string) => string,
): boolean {
  return groups.some((group) =>
    group.options.some((option) => normalize(option.value) === normalize(value)),
  );
}

/** The catalog's groups as `<optgroup>`s. A group with no label is the daemon
 *  fallback, which has no base to group by, so its options sit flat. */
export function ImageOptions({
  groups,
  normalize,
}: {
  groups: ImagePickerGroup[];
  normalize: (ref: string) => string;
}) {
  return (
    <>
      {groups.map((group) => {
        const options = group.options.map((option) => (
          <option key={option.value} value={normalize(option.value)}>{option.label}</option>
        ));
        return group.label === null
          ? <React.Fragment key={group.key}>{options}</React.Fragment>
          : <optgroup key={group.key} label={group.label}>{options}</optgroup>;
      })}
    </>
  );
}

