import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { runPlatformTool } from '../platform-tools';
import { ForbiddenError } from '../../errors';

const tools = {
  list_runs: z.object({ limit: z.number().int().positive() }),
};

describe('runPlatformTool', () => {
  it('runs a valid call with the parsed arguments', async () => {
    const execute = vi.fn().mockResolvedValue({ runs: [] });
    const result = await runPlatformTool({ toolName: 'list_runs', rawArguments: { limit: 5 }, tools, execute });
    expect(result).toEqual({ runs: [] });
    expect(execute).toHaveBeenCalledWith('list_runs', { limit: 5 });
  });

  it('answers an unknown tool with the tools that exist, without executing anything', async () => {
    const execute = vi.fn();
    const result = await runPlatformTool({ toolName: 'sign_qualification', rawArguments: {}, tools, execute });
    expect(result).toEqual({ error: "Unknown tool 'sign_qualification'. Platform tools: list_runs." });
    expect(execute).not.toHaveBeenCalled();
  });

  it('answers a tool named after an Object built-in as unknown, not with a crash', async () => {
    const execute = vi.fn();
    const result = await runPlatformTool({ toolName: 'constructor', rawArguments: {}, tools, execute });
    expect(result).toEqual({ error: "Unknown tool 'constructor'. Platform tools: list_runs." });
    expect(execute).not.toHaveBeenCalled();
  });

  it('answers invalid arguments as a result, not an exception', async () => {
    const execute = vi.fn();
    const result = await runPlatformTool({ toolName: 'list_runs', rawArguments: { limit: -1 }, tools, execute });
    expect(result).toMatchObject({ error: expect.stringContaining("Invalid arguments for 'list_runs': limit") });
    expect(execute).not.toHaveBeenCalled();
  });

  it('turns a refusal into a result the model can explain', async () => {
    const execute = vi.fn().mockRejectedValue(new ForbiddenError('Only admins may do that'));
    const result = await runPlatformTool({ toolName: 'list_runs', rawArguments: { limit: 1 }, tools, execute });
    expect(result).toEqual({ error: 'Only admins may do that', needsAdmin: true });
  });

  it('turns any other failure into an error result', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const result = await runPlatformTool({ toolName: 'list_runs', rawArguments: { limit: 1 }, tools, execute });
    expect(result).toEqual({ error: 'database unavailable' });
  });
});
