import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { McpClientManager } from '../mcp-client-manager.js';

/**
 * Integration test: real tealflow-mcp via stdio.
 *
 * Requires `tealflow-mcp` on PATH (installed via pipx).
 * Skips gracefully when the binary is not available.
 *
 * Run explicitly: npx vitest run packages/mcp-client/src/__tests__/mcp-client-manager.integration.test.ts
 */

let hasTealflowMcp = false;
try {
  execSync('which tealflow-mcp', { stdio: 'ignore' });
  hasTealflowMcp = true;
} catch {
  hasTealflowMcp = false;
}

let manager: McpClientManager | null = null;

afterEach(async () => {
  if (manager) {
    await manager.disconnect();
    manager = null;
  }
});

describe.skipIf(!hasTealflowMcp)('McpClientManager integration (tealflow-mcp)', () => {
  it('should connect, discover tools, call tealflow_list_modules, and disconnect', async () => {
    manager = new McpClientManager([
      { name: 'tealflow', command: 'tealflow-mcp', args: [] },
    ]);

    // Connect and discover tools
    const tools = await manager.connect();
    expect(tools.length).toBeGreaterThan(0);

    // Verify tealflow_list_modules is among discovered tools
    const listModulesTool = tools.find(
      (t) => t.function.name === 'tealflow__tealflow_list_modules',
    );
    expect(listModulesTool).toBeDefined();
    expect(listModulesTool!.type).toBe('function');

    // Call the tool and verify real result
    const result = await manager.callTool('tealflow__tealflow_list_modules', {});
    expect(result.isError).toBe(false);
    expect(result.content.length).toBeGreaterThan(0);
    // The result should contain teal module info
    expect(result.content.toLowerCase()).toContain('teal');

    // Disconnect cleanly
    await manager.disconnect();
    manager = null;
  }, 30_000);
});
