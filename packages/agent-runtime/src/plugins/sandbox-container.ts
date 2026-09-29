import { randomUUID } from 'node:crypto';

/** What every short-lived sandbox container (a code check, a GEPA job) runs under. */
export function sandboxedDockerArgs(limits: { readonly memory: string }): string[] {
  return [
    // DAC_OVERRIDE is the one capability kept: `mkdtemp` directories are 0700
    // and owned by whoever runs the platform, not by the container's root.
    '--cap-drop', 'ALL',
    '--cap-add', 'DAC_OVERRIDE',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '256',
    '--memory', limits.memory,
    '--cpus', '1',
  ];
}

/** Unique per run: the same step can be checked twice at once, and the local strategy removes any container already holding the name. */
export function uniqueContainerName(prefix: string, label: string): string {
  return `${prefix}-${label}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 50) + `-${randomUUID().slice(0, 12)}`;
}

/** The host environment a sandbox keeps when it runs as a local process (ALLOW_LOCAL_AGENTS, dev only). */
export function localSandboxEnv(): NodeJS.ProcessEnv {
  return { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
}

/** `: <stderr>`, clipped, for an error message; empty when there is none. */
export function stderrDetail(stderr: unknown): string {
  return typeof stderr === 'string' && stderr.trim().length > 0 ? `: ${stderr.trim().slice(0, 2000)}` : '';
}
