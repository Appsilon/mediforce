import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { V1Job, V1EnvVar, V1Volume, V1VolumeMount, V1Container, V1ConfigMap } from '@kubernetes/client-node';
import type { DockerSpawnRequest } from './docker-spawn-strategy';
import { KjssOutputDirTooLargeError } from './kjss-errors';

const DEFAULT_INIT_CONTAINER_IMAGE = 'public.ecr.aws/docker/library/busybox:1.36';

/** Hard cap on the base64'd tar.gz payload we'll ship in a per-Job ConfigMap.
 *  K8s etcd objects max out at 1 MiB; this leaves ~150 KiB headroom for the
 *  ConfigMap's metadata + system labels + future-proofing. Typical OpenCode
 *  payloads are well under 50 KiB so this rarely matters; the cap fires
 *  loudly via {@link KjssOutputDirTooLargeError} when a workflow tries to
 *  ship something genuinely huge (binary inputs, multi-MB configs). */
export const OUTPUT_PAYLOAD_LIMIT_BYTES = 900 * 1024;

/** Standard ConfigMap key under which the tar.gz payload lives. The
 *  K8s API server base64-decodes `binaryData` values on the wire, so the
 *  configMap volume mounts the file as the raw gzipped tar bytes — no
 *  `.b64` suffix and no `base64 -d` step in the init container. If you
 *  change this constant, update the init container's command in
 *  {@link buildV1JobSpec} too (the two must match). */
const OUTPUT_PAYLOAD_KEY = 'payload.tar.gz';

const DROPPED_FLAGS = new Set(['run', '--rm', '-i', '-t', '--tty']);
const DROPPED_FLAGS_WITH_VALUE = new Set([
  '-v', '--volume',
  '--platform',
  '--network',
  '--user',
  // The agent-runtime callers (base-container-agent-plugin.ts,
  // script-container-plugin.ts) emit these four. Without them in this
  // set the flag's value slips into the positional list, with `--name`
  // consuming the image slot — kubelet then rejects the PodSpec with
  // `InvalidImageName: "--name"`.
  '--name',
  '--memory',
  '--cpus',
  '-w',
]);
const MAX_K8S_NAME_LEN = 63;

export interface ParsedDockerArgs {
  image: string;
  command: string[];
  args: string[];
  env: Array<{ name: string; value: string }>;
}

export function parseDockerArgs(input: string[]): ParsedDockerArgs {
  const env: Array<{ name: string; value: string }> = [];
  const positional: string[] = [];
  let i = 0;
  while (i < input.length) {
    const tok = input[i];
    if (DROPPED_FLAGS.has(tok)) { i++; continue; }
    if (DROPPED_FLAGS_WITH_VALUE.has(tok)) { i += 2; continue; }
    if (tok === '-e' || tok === '--env') {
      const next = input[i + 1] ?? '';
      const eq = next.indexOf('=');
      if (eq > 0) {
        env.push({ name: next.slice(0, eq), value: next.slice(eq + 1) });
      }
      i += 2; continue;
    }
    positional.push(tok); i++;
  }
  const [image = '', command = '', ...args] = positional;
  return { image, command: command ? [command] : [], args, env };
}

export function safeJobName(input: string): string {
  const lowered = input.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (lowered.length <= MAX_K8S_NAME_LEN) return lowered;
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 8);
  return `${lowered.slice(0, MAX_K8S_NAME_LEN - 9)}-${hash}`;
}

export interface KubeSpawnConfig {
  namespace: string;
  serviceAccountName?: string;
  imagePullSecrets?: Array<{ name: string }>;
  defaultResources?: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
}

const DEFAULT_RESOURCES = {
  requests: { cpu: '500m', memory: '1Gi' },
  limits: { cpu: '2', memory: '4Gi' },
};

/** Per-spawn options that the strategy resolves before calling the builder.
 *  Kept separate from `KubeSpawnConfig` (process-wide) so the spec-builder
 *  stays a pure function of request + config + options. */
export interface BuildV1JobSpecOptions {
  /** When set, KJSS has created (or will create) a ConfigMap of this name in
   *  the target namespace whose `data['payload.tar.gz.b64']` carries a
   *  base64-encoded gzipped tarball of the plugin's outputDir. The spec then
   *  mounts that configMap + an initContainer that decodes the blob into an
   *  emptyDir mounted at /output on the main container — matching the
   *  bind-mount contract every agent plugin already assumes. */
  outputConfigMapName?: string;
  /** Image used for the prep-output initContainer. Defaults to busybox 1.36
   *  via the AWS public ECR mirror so the pull doesn't hit Docker Hub rate
   *  limits. Override with a digest-pinned private mirror in prod. */
  initContainerImage?: string;
}

export function buildV1JobSpec(
  req: DockerSpawnRequest,
  config: KubeSpawnConfig,
  opts: BuildV1JobSpecOptions = {},
): V1Job {
  const { image, command, args, env } = parseDockerArgs(req.dockerArgs);
  const jobName = safeJobName(req.containerName);
  const resources = config.defaultResources ?? DEFAULT_RESOURCES;

  const envVars: V1EnvVar[] = env.map(({ name, value }) => ({ name, value }));

  const volumes: V1Volume[] = [{ name: 'tmp', emptyDir: {} }];
  const mainVolumeMounts: V1VolumeMount[] = [{ name: 'tmp', mountPath: '/tmp' }];
  let initContainers: V1Container[] | undefined;

  if (opts.outputConfigMapName) {
    volumes.push(
      { name: 'output-cm', configMap: { name: opts.outputConfigMapName } },
      { name: 'output',    emptyDir: {} },
    );
    mainVolumeMounts.push({ name: 'output', mountPath: '/output' });
    initContainers = [{
      name: 'prep-output',
      image: opts.initContainerImage ?? DEFAULT_INIT_CONTAINER_IMAGE,
      command: ['sh', '-c', 'tar -xzC /output --no-same-owner < /cm/payload.tar.gz'],
      securityContext: {
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        capabilities: { drop: ['ALL'] },
        seccompProfile: { type: 'RuntimeDefault' },
      },
      volumeMounts: [
        { name: 'output-cm', mountPath: '/cm',     readOnly: true },
        { name: 'output',    mountPath: '/output' },
      ],
    }];
  }

  const job: V1Job = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: config.namespace,
      labels: {
        'mediforce.io/run-id': req.processInstanceId,
        'mediforce.io/step-id': req.stepId,
        'mediforce.io/managed-by': 'agent-runtime',
      },
    },
    spec: {
      activeDeadlineSeconds: Math.ceil(req.timeoutMs / 1000) + 30,
      backoffLimit: 0,
      ttlSecondsAfterFinished: 300,
      template: {
        metadata: {
          labels: {
            'mediforce.io/run-id': req.processInstanceId,
            'mediforce.io/step-id': req.stepId,
            'mediforce.io/managed-by': 'agent-runtime',
          },
        },
        spec: {
          restartPolicy: 'Never',
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          volumes,
          ...(initContainers ? { initContainers } : {}),
          containers: [
            {
              name: jobName,
              image,
              command: command.length > 0 ? command : undefined,
              args: args.length > 0 ? args : undefined,
              env: envVars.length > 0 ? envVars : undefined,
              stdin: req.stdinPayload !== null ? true : undefined,
              resources,
              securityContext: {
                readOnlyRootFilesystem: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                seccompProfile: { type: 'RuntimeDefault' },
              },
              volumeMounts: mainVolumeMounts,
            },
          ],
          ...(config.serviceAccountName ? { serviceAccountName: config.serviceAccountName } : {}),
          ...(config.imagePullSecrets && config.imagePullSecrets.length > 0
            ? { imagePullSecrets: config.imagePullSecrets }
            : {}),
        },
      },
    },
  };

  return job;
}

// ─── outputDir → ConfigMap encoder ────────────────────────────────────────────
// POSIX ustar with a single file-data block per entry, gzip-compressed,
// base64-encoded into one ConfigMap key. The init container in buildV1JobSpec
// reverses the transform with `base64 -d < /cm/<key> | tar -xzC /output`
// (busybox tar handles the ustar variant natively).

const TAR_BLOCK_SIZE = 512;
const END_OF_ARCHIVE = Buffer.alloc(TAR_BLOCK_SIZE * 2); // two zero blocks
const FILE_TYPE_REGULAR = '0';

/** Build a single ustar header for a regular file. Mirrors the GNU tar
 *  on-disk layout (header(0..511) + content(padded to 512)). */
function tarHeader(name: string, size: number): Buffer {
  if (Buffer.byteLength(name, 'utf-8') > 100) {
    // Long-name extensions (PAX) would add complexity we don't need today —
    // our path conventions stay well under 100 chars (`.local/share/opencode/auth.json` = 32).
    throw new Error(`tar entry name longer than 100 bytes is not supported: ${name}`);
  }
  const hdr = Buffer.alloc(TAR_BLOCK_SIZE);
  hdr.write(name, 0, 100, 'utf-8');
  // mode 0644, uid/gid 0, mtime 0 (deterministic builds)
  hdr.write('0000644\0', 100, 8, 'ascii');
  hdr.write('0000000\0', 108, 8, 'ascii');
  hdr.write('0000000\0', 116, 8, 'ascii');
  hdr.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  hdr.write('00000000000\0', 136, 12, 'ascii');
  // Checksum field gets 8 spaces initially so the sum includes a known
  // value across the header. Real checksum written after summing.
  hdr.write('        ', 148, 8, 'ascii');
  hdr.write(FILE_TYPE_REGULAR, 156, 1, 'ascii');
  hdr.write('ustar\0', 257, 6, 'ascii');
  hdr.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) sum += hdr[i];
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return hdr;
}

function buildTar(files: Map<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  // Deterministic ordering — gzip output stays stable across reruns.
  const sortedNames = [...files.keys()].sort();
  for (const name of sortedNames) {
    const content = files.get(name)!;
    blocks.push(tarHeader(name, content.length));
    blocks.push(content);
    const padding = (TAR_BLOCK_SIZE - (content.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(END_OF_ARCHIVE);
  return Buffer.concat(blocks);
}

/** Build the per-Job ConfigMap that carries the plugin's outputDir contents
 *  into the spawned container. Pure function of the file map; the strategy
 *  is responsible for walking the filesystem before calling this.
 *
 *  Throws {@link KjssOutputDirTooLargeError} when the base64 blob would
 *  exceed {@link OUTPUT_PAYLOAD_LIMIT_BYTES}. */
export function buildOutputConfigMap(name: string, files: Map<string, Buffer>): V1ConfigMap {
  const tarball = buildTar(files);
  const gzipped = gzipSync(tarball, { level: 9 });
  const b64 = gzipped.toString('base64');
  if (b64.length > OUTPUT_PAYLOAD_LIMIT_BYTES) {
    throw new KjssOutputDirTooLargeError(b64.length, OUTPUT_PAYLOAD_LIMIT_BYTES);
  }
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name },
    // `binaryData` is base64-encoded server-side anyway, but storing the
    // already-base64 payload here keeps the init container's decode path
    // dead-simple: `base64 -d < /cm/payload.tar.gz.b64`.
    binaryData: { [OUTPUT_PAYLOAD_KEY]: b64 },
  };
}
