import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { vi } from 'vitest';

/**
 * A stand-in for `docker run` of an agent container, for a mocked
 * `child_process.spawn`: writes `result` as result.json into the host folder
 * mounted at /output (as an agent does, ADR-0030), prints `stdoutLines`, and
 * exits 0.
 */
export function fakeAgentContainer(
  dockerArgs: readonly string[] | undefined,
  stdoutLines: string[],
  result: Record<string, unknown> = { summary: 'done' },
): ChildProcess {
  const outputMount = (dockerArgs ?? []).find((arg) => arg.endsWith(':/output'));
  if (outputMount !== undefined) {
    writeFileSync(join(outputMount.slice(0, -':/output'.length), 'result.json'), JSON.stringify(result));
  }
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    stdout: new Readable({ read() {} }),
    stderr: new Readable({ read() {} }),
    stdin: new Writable({ write(_chunk, _enc, callback) { callback(); } }),
    pid: 4242,
    killed: false,
    kill: vi.fn(),
  });
  setTimeout(() => {
    for (const line of stdoutLines) (child.stdout as Readable).push(`${line}\n`);
    (child.stdout as Readable).push(null);
    (child.stderr as Readable).push(null);
    child.emit('close', 0, null);
  }, 10);
  return child;
}
