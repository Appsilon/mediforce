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
 * with none named the context is the directory the Dockerfile itself sits in.
 * A Dockerfile in `container/` that copies `scripts/` from the directory above
 * therefore fails on a path that plainly exists in the repository, which reads
 * as a platform bug until someone knows that rule — and the fix is a setting,
 * so the hint names it.
 */
const CONTEXT_MISMATCH_HINT =
  'A path this Dockerfile copies is not in the build context. With no build context set, the ' +
  'build context is the directory holding the Dockerfile, so everything it COPYs must sit ' +
  'beside it. To reach files elsewhere in the repository, set a build context — "." for the ' +
  'repository root — and give the Dockerfile path from there.';

function namedContextHint(context: string): string {
  return (
    `A path this Dockerfile copies is not in the build context "${context}". COPY paths are ` +
    'read from the build context, not from the directory holding the Dockerfile.'
  );
}

/**
 * A browser cannot read a file's permissions, so a folder uploaded from the
 * Images view arrives with no file marked executable, and a Dockerfile that
 * runs a script directly fails on it. Said here, where it bites, rather than
 * up front to everyone.
 */
const NOT_EXECUTABLE_HINT =
  'A script in the folder could not run because it lost its "executable" mark: browsers cannot ' +
  'upload that mark. Add RUN chmod +x <script> to the Dockerfile before it runs, or upload with ' +
  'mediforce images build --context, which keeps it.';

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

/** `context` is the one the failed build used; absent when it named none.
 *  `browserUpload` is a folder uploaded from the Images view. */
export function describeBuildFailure(
  message: string,
  context?: string,
  options: { browserUpload?: boolean } = {},
): BuildFailure {
  const detail = message.trim();
  if (options.browserUpload === true && /permission denied/i.test(detail)) {
    return { summary: NOT_EXECUTABLE_HINT, detail, explained: true };
  }
  if (looksLikeContextMismatch(detail)) {
    const summary =
      context === undefined || context === '' ? CONTEXT_MISMATCH_HINT : namedContextHint(context);
    return { summary, detail, explained: true };
  }
  return { summary: lastMeaningfulLine(detail), detail, explained: false };
}
