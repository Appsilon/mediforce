/**
 * The readable half of a failed build.
 *
 * A build failure arrives as whatever BuildKit printed — a hundred lines of
 * step output ending in the actual cause. Dropping that is wrong (it is the
 * only evidence of what happened) and showing it raw as the error is also
 * wrong, so the dialog leads with one sentence and keeps the rest behind a
 * disclosure.
 */

/**
 * Every path a Dockerfile copies is resolved against the build context, and
 * the platform's context is the directory the Dockerfile itself sits in. A
 * Dockerfile in `container/` that copies `scripts/` from the directory above
 * therefore fails on a path that plainly exists in the repository, which reads
 * as a platform bug until someone knows that rule.
 */
const CONTEXT_MISMATCH_HINT =
  'A path this Dockerfile copies is not in the build context. The build context is the ' +
  'directory holding the Dockerfile, so everything it COPYs must sit beside it — a ' +
  'Dockerfile in a subdirectory cannot reach files in its parent.';

/** BuildKit's wording when a `COPY` source is outside the context. */
function looksLikeContextMismatch(message: string): boolean {
  return (
    message.includes('failed to compute cache key') ||
    (message.includes('failed to calculate checksum') && message.includes('not found'))
  );
}

/** The last line that carries a reason, so the summary is the cause rather
 *  than whichever step happened to print last. */
function lastMeaningfulLine(message: string): string {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const failure = [...lines].reverse().find((line) => line.includes('ERROR') || line.includes('failed'));
  return failure ?? lines[lines.length - 1] ?? message;
}

export interface BuildFailure {
  /** One sentence to lead with — a known cause where we recognise one. */
  summary: string;
  /** The untouched message, shown only when the reader asks for it. */
  detail: string;
  /** Whether `summary` explains the failure rather than merely quoting it. */
  explained: boolean;
}

export function describeBuildFailure(message: string): BuildFailure {
  const detail = message.trim();
  if (looksLikeContextMismatch(detail)) {
    return { summary: CONTEXT_MISMATCH_HINT, detail, explained: true };
  }
  return { summary: lastMeaningfulLine(detail), detail, explained: false };
}
