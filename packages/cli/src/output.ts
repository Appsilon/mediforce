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
