import type { z } from 'zod';
import { HandlerError } from '../errors';

export interface PlatformToolCall<TName extends string> {
  readonly toolName: string;
  readonly rawArguments: unknown;
  readonly tools: Readonly<Record<TName, z.ZodType>>;
  /** Runs one validated call as the caller. */
  readonly execute: (toolName: TName, args: unknown) => Promise<unknown>;
}

/**
 * Runs one platform tool for an assistant, as the person who asked.
 *
 * Everything `execute` does goes through the caller's own `CallerScope` —
 * there is no service account and no elevated path. A refusal therefore comes
 * back as a *result*, not an exception: the turn continues and the model tells
 * the person that this needs an admin, which is the honest answer, rather than
 * the conversation dying or the assistant finding a way around the gate.
 */
export async function runPlatformTool<TName extends string>(call: PlatformToolCall<TName>): Promise<unknown> {
  const { toolName, rawArguments, tools, execute } = call;
  if (!(toolName in tools)) {
    const valid = Object.keys(tools).join(', ');
    return { error: `Unknown tool '${toolName}'. Platform tools: ${valid}.` };
  }
  const name = toolName as TName;
  const parsed = tools[name].safeParse(rawArguments);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { error: `Invalid arguments for '${toolName}': ${issues}` };
  }

  try {
    return await execute(name, parsed.data);
  } catch (err) {
    if (err instanceof HandlerError && err.code === 'forbidden') {
      return { error: err.message, needsAdmin: true };
    }
    return { error: err instanceof Error ? err.message : 'The platform refused that.' };
  }
}
