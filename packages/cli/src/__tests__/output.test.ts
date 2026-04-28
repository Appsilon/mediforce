import { describe, it, expect, vi } from 'vitest';
import { runGetCommand } from '../commands/run-get.js';
import { workflowRegisterCommand } from '../commands/workflow-register.js';
import { printError } from '../output.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

/**
 * Regression tests for the `printError` stream contract documented in
 * `output.ts`:
 *
 *   --json mode → STDOUT
 *   human mode → STDERR
 *
 * Both lanes are exercised here directly via `printError` and end-to-end
 * via a real command path (a 4xx triggers `printError` from the catch).
 */

describe('printError stream contract — direct', () => {
  it('writes the JSON payload to stdout in --json mode', () => {
    const output = captureOutput();
    printError(output, { error: 'boom', status: 404 }, true);
    expect(output.stderrLines).toEqual([]);
    expect(output.stdoutLines).toHaveLength(1);
    const parsed: unknown = JSON.parse(output.stdoutLines[0]!);
    expect(parsed).toMatchObject({ error: 'boom', status: 404 });
  });

  it('writes the plain message to stderr in human mode', () => {
    const output = captureOutput();
    printError(output, { error: 'boom', status: 404 }, false);
    expect(output.stdoutLines).toEqual([]);
    expect(output.stderrLines.join('\n')).toMatch(/Error.*HTTP 404.*boom/);
  });
});

describe('printError stream contract — end-to-end via command path', () => {
  it('--json error from `run get` lands on stdout, not stderr', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Run not found' }, 404),
    );
    const output = captureOutput();
    const code = await runGetCommand({
      argv: ['nope', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    // The error JSON must be on stdout — the contract that machine
    // consumers depend on. stderr stays clean.
    expect(output.stderrLines).toEqual([]);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 404 });
  });

  it('human-mode error from `run get` lands on stderr, not stdout', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Run not found' }, 404),
    );
    const output = captureOutput();
    const code = await runGetCommand({
      argv: ['nope'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    // No JSON on stdout in human mode — clean separation lets shells
    // pipe stdout into next-stage tools without errors corrupting it.
    expect(output.stdoutLines).toEqual([]);
    expect(output.stderrLines.join('\n')).toMatch(/Error.*HTTP 404/);
  });

  it('--json error from `workflow register` lands on stdout, not stderr', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Validation failed' }, 400),
    );
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', '/no/such/file.json', '--namespace', 'ns', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines).toEqual([]);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ error: expect.stringMatching(/Failed to read file/) });
  });
});
