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

/** Parse the paths emitted by `command -v` in the image capability probe.
 * A non-zero probe exit is intentionally not an input: `command -v` returns
 * non-zero whenever a requested binary is absent, while its stdout still
 * describes every binary that was found. */
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
