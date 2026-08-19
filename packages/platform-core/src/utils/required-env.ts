/**
 * Each inner array is one alternative group: all keys in a group must be present,
 * and at least one group must be satisfied. No requirement reads as satisfied.
 *
 * An empty string counts as unset — an exported-but-blank var is the same mistake
 * as a missing one, and treating it as present buys a runtime failure instead of
 * an honest "not configured".
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
