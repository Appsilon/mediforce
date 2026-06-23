import { createHash } from 'node:crypto';
import type { V1Job, V1EnvVar } from '@kubernetes/client-node';
import type { DockerSpawnRequest } from './docker-spawn-strategy';

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

export function buildV1JobSpec(req: DockerSpawnRequest, config: KubeSpawnConfig): V1Job {
  const { image, command, args, env } = parseDockerArgs(req.dockerArgs);
  const jobName = safeJobName(req.containerName);
  const resources = config.defaultResources ?? DEFAULT_RESOURCES;

  const envVars: V1EnvVar[] = env.map(({ name, value }) => ({ name, value }));

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
          volumes: [
            { name: 'tmp', emptyDir: {} },
          ],
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
              volumeMounts: [
                { name: 'tmp', mountPath: '/tmp' },
              ],
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
