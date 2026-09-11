import { describe, expect, it } from 'vitest';
import { describeBuildFailure } from '../build-error';

/** The real shape of the failure that prompted this: a Dockerfile in
 *  `container/` copying `scripts/` from the directory above. */
const CONTEXT_MISMATCH = `Building "mediforce-built:d999eb1b6293" failed: Command failed: docker build -t mediforce-built:d999eb1b6293 -f /tmp/build/apps/golden-standard-workflow/container/Dockerfile /tmp/build/apps/golden-standard-workflow/container
#7 [5/6] COPY mcp/ /opt/golden-standard/mcp/
#7 ERROR: failed to calculate checksum of ref abc::def: "/mcp": not found
ERROR: failed to build: failed to solve: failed to compute cache key: failed to calculate checksum of ref abc::def: "/mcp": not found`;

describe('describeBuildFailure', () => {
  it('names the build context when a COPY source is outside it', () => {
    const failure = describeBuildFailure(CONTEXT_MISMATCH);

    // The path plainly exists in the repository, so without this the failure
    // reads as a platform bug rather than a context rule.
    expect(failure.explained).toBe(true);
    expect(failure.summary).toContain('build context');
    expect(failure.summary).toContain('beside it');
  });

  it('points at the build context setting when the entry names none', () => {
    const failure = describeBuildFailure(CONTEXT_MISMATCH);

    // The fix exists now, so the hint names it rather than only the rule.
    expect(failure.summary).toMatch(/set a build context/i);
  });

  it('names the context it used when the entry already sets one', () => {
    const failure = describeBuildFailure(CONTEXT_MISMATCH, 'apps/golden-standard-workflow');

    expect(failure.explained).toBe(true);
    expect(failure.summary).toContain('"apps/golden-standard-workflow"');
    // Not the no-context rule: with a context, COPY paths are not read from
    // beside the Dockerfile, so that sentence would send the reader the wrong way.
    expect(failure.summary).not.toContain('beside it');
  });

  it('keeps the whole output, which is the only evidence of what happened', () => {
    expect(describeBuildFailure(CONTEXT_MISMATCH).detail).toContain('#7 [5/6] COPY mcp/');
  });

  it('summarises an unrecognised failure with its last failing line, not its last line', () => {
    const failure = describeBuildFailure(
      'Step 1/3 fine\nERROR: could not resolve host github.com\nBuild session ended',
    );

    expect(failure.explained).toBe(false);
    expect(failure.summary).toBe('ERROR: could not resolve host github.com');
  });

  it('falls back to the message when nothing in it looks like a failure line', () => {
    expect(describeBuildFailure('something went wrong').summary).toBe('something went wrong');
  });
});
