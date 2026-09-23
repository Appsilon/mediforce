export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
}

/**
 * Re-run `probe` until it returns a non-null value, then return that value.
 * Journeys drive work the platform does asynchronously (agent steps, run
 * transitions, task creation), so they poll the API instead of sleeping.
 * A `probe` that throws fails the wait immediately.
 */
export async function pollUntil<T>(
  probe: () => Promise<T | null>,
  { timeoutMs = 20_000, intervalMs = 250, description = 'condition' }: PollOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description} (${timeoutMs}ms)`);
}
