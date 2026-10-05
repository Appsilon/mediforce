import { z } from 'zod';
import { IMAGE_CAPABILITY_PROBE_TIMEOUT_MS } from './image-capabilities';

/**
 * A bare executable name — what an MCP catalog entry's `command` holds. The
 * first character is never `-`, so the value cannot be read as a flag, and no
 * path separator, space or shell metacharacter is allowed: the probe runs in a
 * container, and the name is the only caller-supplied part of it.
 */
export const ImageCommandNameSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9._][A-Za-z0-9._+-]*$/, 'Expected a bare command name, e.g. uvx');

export const KnownImageCommandCheckSchema = z.object({
  status: z.literal('known'),
  available: z.boolean(),
  path: z.string().min(1).optional(),
}).strict();

export const UnknownImageCommandCheckSchema = z.object({
  status: z.literal('unknown'),
}).strict();

/** Present, absent, or unknown — unknown is "nobody could answer", not "no"
 *  (ADR-0022 decision 2), so a consumer warns on `known` + `!available` only. */
export const ImageCommandCheckSchema = z.discriminatedUnion('status', [
  KnownImageCommandCheckSchema,
  UnknownImageCommandCheckSchema,
]);

export type ImageCommandCheck = z.infer<typeof ImageCommandCheckSchema>;

export const IMAGE_COMMAND_CHECK_TIMEOUT_MS = IMAGE_CAPABILITY_PROBE_TIMEOUT_MS;

const MISSING_MARKER = '__missing__';

/**
 * `docker run` arguments asking one image whether it resolves one command.
 *
 * The command is a positional parameter of a fixed script, not interpolated
 * into it. `|| echo` turns "not found" into an answer on stdout with exit 0,
 * so an image with no `sh`, or a daemon that failed, leaves stdout empty and
 * reads as unknown rather than as a false absence. Same container caps as the
 * capability probe, and no network.
 */
export function imageCommandProbeArgs(image: string, command: string): string[] {
  return [
    'run',
    '--rm',
    '--network', 'none',
    '--memory', '256m',
    '--cpus', '0.5',
    '--pids-limit', '64',
    '--entrypoint', 'sh',
    image,
    '-c',
    `command -v "$1" || echo ${MISSING_MARKER}`,
    'sh',
    command,
  ];
}

export function parseImageCommandCheck(stdout: string): ImageCommandCheck {
  const answer = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
  if (answer === undefined) return { status: 'unknown' };
  if (answer === MISSING_MARKER) return { status: 'known', available: false };
  return { status: 'known', available: true, path: answer };
}
