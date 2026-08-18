/**
 * Evaluate a `requiredEnv` declaration (see `PluginCapabilityMetadataSchema`)
 * against an environment map.
 *
 * Each inner array is one alternative group: every key in a group must be
 * present for that group to count, and at least one group must count. No
 * requirement at all reads as satisfied.
 *
 * An empty string counts as unset — an exported-but-blank var is the same
 * mistake as a missing one, and treating it as present produces a runtime
 * failure instead of an honest "not configured".
 */
export function isRequiredEnvSatisfied(
  requiredEnv: readonly (readonly string[])[] | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (requiredEnv === undefined || requiredEnv.length === 0) return true;
  return requiredEnv.some((group) =>
    group.every((key) => {
      const value = env[key];
      return typeof value === 'string' && value.length > 0;
    }),
  );
}
