import { describe, it, expect } from 'vitest';
import { runCli } from '../cli.js';
import { captureOutput } from './test-helpers.js';

describe('runCli — top-level dispatch', () => {
  it('prints help when called with no arguments', async () => {
    const output = captureOutput();
    const code = await runCli({ argv: [], env: {}, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Usage: mediforce/);
  });

  it('prints help on --help', async () => {
    const output = captureOutput();
    const code = await runCli({ argv: ['--help'], env: {}, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/workflow register/);
  });

  it('prints help on -h', async () => {
    const output = captureOutput();
    const code = await runCli({ argv: ['-h'], env: {}, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/workflow register/);
  });

  it('returns exit 2 on unknown command', async () => {
    const output = captureOutput();
    const code = await runCli({ argv: ['weird'], env: {}, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Unknown command/);
  });

  it('returns exit 2 on unknown subcommand under workflow', async () => {
    const output = captureOutput();
    const code = await runCli({ argv: ['workflow', 'magic'], env: {}, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Unknown command/);
  });

  it('prints workflow-namespaced HELP when `workflow` is given with no subcommand', async () => {
    const output = captureOutput();
    const code = await runCli({ argv: ['workflow'], env: {}, output });
    expect(code).toBe(2);
    const stderr = output.stderrLines.join('\n');
    expect(stderr).toMatch(/Usage: mediforce workflow/);
    expect(stderr).toMatch(/register/);
    expect(stderr).toMatch(/list/);
    // Should NOT fall through to the generic `Unknown command: workflow undefined`.
    expect(stderr).not.toMatch(/Unknown command/);
  });

  it('prints run-namespaced HELP when `run` is given with no subcommand', async () => {
    const output = captureOutput();
    const code = await runCli({ argv: ['run'], env: {}, output });
    expect(code).toBe(2);
    const stderr = output.stderrLines.join('\n');
    expect(stderr).toMatch(/Usage: mediforce run/);
    expect(stderr).toMatch(/get/);
    expect(stderr).not.toMatch(/Unknown command/);
  });
});
