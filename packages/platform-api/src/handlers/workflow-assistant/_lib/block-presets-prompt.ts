import { BLOCK_PRESETS } from '@mediforce/platform-core';

/**
 * The Add Block panel's pre-made blocks, rendered for the system prompt.
 *
 * Derived from `BLOCK_PRESETS` rather than restated, so a preset that gains a
 * field or changes a default moves the assistant with the picker instead of
 * leaving the two to drift.
 */
export function describeBlockPresets(): string {
  return BLOCK_PRESETS.map((preset) => {
    const shape = JSON.stringify(preset.payload);
    const gaps = preset.needsInput === undefined || preset.needsInput.length === 0
      ? ''
      : ` Needs from the user: ${preset.needsInput.join(', ')}.`;
    return `- **${preset.label}** — ${preset.purpose} Shape: \`${shape}\`.${gaps}`;
  }).join('\n');
}
