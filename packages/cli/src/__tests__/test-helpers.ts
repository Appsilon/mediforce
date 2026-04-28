import type { OutputSink } from '../output.js';

export interface CapturedOutput extends OutputSink {
  stdoutLines: string[];
  stderrLines: string[];
}

export function captureOutput(): CapturedOutput {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
