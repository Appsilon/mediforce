import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { runPlatformTool } from '../platform-tools';
import { ForbiddenError } from '../../errors';
import { EVALUATION_ASSISTANT_PLATFORM_TOOLS } from '@mediforce/platform-core';

const tools = {
  list_runs: z.object({ limit: z.number().int().positive() }),
};

describe('runPlatformTool', () => {
  it('decodes a check that was JSON-encoded into a string and runs the tool', async () => {
    const check = { kind: 'code', runtime: 'python', source: 'print(1)' };
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const result = await runPlatformTool({
      toolName: 'preview_evaluator', rawArguments: { check: JSON.stringify(check) }, tools: EVALUATION_ASSISTANT_PLATFORM_TOOLS, execute,
    });
    expect(result).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith('preview_evaluator', expect.objectContaining({ check }));
  });

  it.each(['import json\nprint("check")'])(
    'returns the expected check object and examples for a raw script string check: %s', async (check) => {
      const execute = vi.fn();
      const result = await runPlatformTool({
        toolName: 'preview_evaluator', rawArguments: { check }, tools: EVALUATION_ASSISTANT_PLATFORM_TOOLS, execute,
      });
      expect(result).toMatchObject({
        error: expect.stringContaining("you sent for 'check'"),
        validationError: 'check: Invalid input: expected object, received string',
        expectedArguments: { properties: { check: {
          description: expect.stringContaining('not a string'),
          examples: expect.arrayContaining([expect.objectContaining({ kind: 'code', runtime: 'python', source: expect.any(String) })]),
        } } },
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

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
