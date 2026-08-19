import { BLOCK_PRESETS } from '@mediforce/platform-core';

/**
 * The Add Block panel's pre-made blocks, rendered for the system prompt.
 *
 * Only the id, the label and when to reach for it — `add_step`'s `presetId`
 * resolves the actual payload server-side, so the shapes do not belong in the
 * prompt where they would be a second copy to drift.
 */
export function describeBlockPresets(): string {
  return BLOCK_PRESETS.map((preset) => {
    const gaps = preset.needsInput === undefined || preset.needsInput.length === 0
      ? ''
      : ` Needs from the user: ${preset.needsInput.join(', ')}.`;
    return `- \`${preset.id}\` — **${preset.label}**: ${preset.purpose}${gaps}`;
  }).join('\n');
}
