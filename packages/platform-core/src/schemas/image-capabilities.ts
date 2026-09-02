import { z } from 'zod';

export const ImageRuntimeSchema = z.enum([
  'claude',
  'opencode',
  'bash',
  'python3',
  'Rscript',
  'node',
]);

export const KnownImageCapabilitiesSchema = z.object({
  status: z.literal('known'),
  agentCapable: z.boolean(),
  runtimes: z.array(ImageRuntimeSchema),
}).strict();

export const UnknownImageCapabilitiesSchema = z.object({
  status: z.literal('unknown'),
}).strict();

export const ImageCapabilitiesSchema = z.discriminatedUnion('status', [
  KnownImageCapabilitiesSchema,
  UnknownImageCapabilitiesSchema,
]);

export const ImageCapabilityCacheSchema = z.record(z.string().min(1), ImageCapabilitiesSchema);

export type ImageRuntime = z.infer<typeof ImageRuntimeSchema>;
export type ImageCapabilities = z.infer<typeof ImageCapabilitiesSchema>;
export type ImageCapabilityCache = z.infer<typeof ImageCapabilityCacheSchema>;

const PROBED_RUNTIMES = ImageRuntimeSchema.options;

export function unknownImageCapabilities(): ImageCapabilities {
  return { status: 'unknown' };
}

/** Wall-clock ceiling for one probe container, applied by every caller. */
export const IMAGE_CAPABILITY_PROBE_TIMEOUT_MS = 10_000;

/**
 * One `command -v` per runtime, not `command -v claude opencode bash ...`:
 * POSIX `command -v` takes a single operand, and the `dash` that is `/bin/sh`
 * on every Debian-derived image inspects only the first one — an image without
 * `claude` would report nothing at all, and one with it would never report its
 * `bash`. `|| true` keeps a missing binary from ending the loop, so the probe
 * exits 0 and an image carrying none of them is a known empty set rather than
 * an unknown.
 */
const IMAGE_CAPABILITY_PROBE_SCRIPT =
  `for runtime in ${PROBED_RUNTIMES.join(' ')}; do command -v "$runtime" || true; done`;

/**
 * `docker run` arguments for one capability probe. The image supplies the `sh`
 * that runs, so the container is capped the way agent and script containers are
 * — smaller, because this one only resolves six paths — and gets no network.
 */
export function imageCapabilityProbeArgs(image: string): string[] {
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
    IMAGE_CAPABILITY_PROBE_SCRIPT,
  ];
}

/** Parse the paths emitted by the image capability probe. A non-zero probe
 * exit is intentionally not an input: the probe still prints every binary it
 * resolved before whatever failed, and stdout is the whole answer. */
export function parseImageCapabilities(stdout: string): ImageCapabilities {
  const found = new Set(
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split('/').at(-1))
      .filter((runtime): runtime is ImageRuntime =>
        runtime !== undefined && PROBED_RUNTIMES.includes(runtime as ImageRuntime),
      ),
  );
  const runtimes = PROBED_RUNTIMES.filter((runtime) => found.has(runtime));

  return {
    status: 'known',
    agentCapable: (found.has('claude') || found.has('opencode')) && found.has('bash'),
    runtimes,
  };
}
