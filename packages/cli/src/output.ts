/**
 * Output helpers — split human-readable vs JSON modes.
 *
 * Each command takes a `--json` flag. When set, the command emits a single
 * JSON object to stdout and nothing else. When unset, it emits human-friendly
 * lines to stderr (status/progress) and stdout (data only when relevant).
 *
 * Errors always go through `printError` — JSON mode emits the structured
 * shape, human mode prints a plain message.
 */

export interface OutputSink {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export const consoleOutput: OutputSink = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

export interface ErrorPayload {
  error: string;
  status?: number;
  body?: unknown;
}

export function printJson(sink: OutputSink, payload: unknown): void {
  sink.stdout(JSON.stringify(payload, null, 2));
}

/**
 * Stream contract — load-bearing, do not change without updating tests:
 *
 *   --json mode:  error payload is written to STDOUT (single channel for
 *                 machine consumers; pipe `... | jq` works for both
 *                 success and error responses without flag-juggling).
 *   human mode:   error message is written to STDERR (success output stays
 *                 on stdout uncluttered, so `cmd > out.txt` only captures
 *                 success and `cmd 2> err.log` only captures errors).
 *
 * The regression tests in `__tests__/output.test.ts` and the per-command
 * tests in `__tests__/run-get.test.ts` and
 * `__tests__/workflow-register.test.ts` lock this behaviour in. The
 * top-level `mediforce --help` text also documents this contract under
 * the "Output streams" section so consumers don't have to read code.
 *
 * Rationale:
 *   - JSON mode: a single output channel is what `jq`, log shippers, and
 *     CI parsers expect. Splitting JSON across stdout/stderr breaks them.
 *   - Human mode: separating diagnostics from data lets shell users
 *     compose commands (`cmd | next-tool`) without errors corrupting
 *     the pipe.
 */
export function printError(
  sink: OutputSink,
  payload: ErrorPayload,
  jsonMode: boolean,
): void {
  if (jsonMode) {
    sink.stdout(JSON.stringify(payload, null, 2));
    return;
  }
  const suffix =
    payload.status !== undefined ? ` (HTTP ${String(payload.status)})` : '';
  sink.stderr(`Error${suffix}: ${payload.error}`);
}
