import { describe, it, expect } from 'vitest';
import { runCli, TREE } from '../cli';
import { captureOutput } from './test-helpers';

// Sanity sweep: every branch×leaf in `TREE` must respond to `--help` with
// exit 0 and stdout that mentions the leaf name. Catches "imported but not
// wired", "wrong function bound to wrong key", and broken usage rendering.
describe('CLI tree smoke', () => {
  for (const [branch, branchDef] of Object.entries(TREE)) {
    for (const leaf of Object.keys(branchDef.leaves)) {
      it(`${branch} ${leaf} --help renders usage`, async () => {
        const output = captureOutput();
        const code = await runCli({
          argv: [branch, leaf, '--help'],
          env: {},
          output,
        });
        expect(code).toBe(0);
        expect(output.stdoutLines.join('\n')).toContain(`mediforce ${branch} ${leaf}`);
      });
    }
  }
});
