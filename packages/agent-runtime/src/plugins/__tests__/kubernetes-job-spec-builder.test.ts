import { describe, it, expect } from 'vitest';
import { parseDockerArgs, safeJobName, buildV1JobSpec } from '../kubernetes-job-spec-builder';
import type { KubeSpawnConfig } from '../kubernetes-job-spec-builder';
import type { DockerSpawnRequest } from '../docker-spawn-strategy';

describe('parseDockerArgs', () => {
  it('extracts image as the first positional after flags', () => {
    const result = parseDockerArgs(['run', '--rm', '-i', 'mediforce-agent:tag', 'claude']);
    expect(result.image).toBe('mediforce-agent:tag');
  });

  it('parses -e KEY=value into env entries', () => {
    const result = parseDockerArgs(['run', '-e', 'FOO=bar', '-e', 'BAZ=qux', 'img', 'cmd']);
    expect(result.env).toEqual([
      { name: 'FOO', value: 'bar' },
      { name: 'BAZ', value: 'qux' },
    ]);
  });

  it('handles env values containing =', () => {
    const result = parseDockerArgs(['run', '-e', 'URL=https://x.com/path?a=1', 'img', 'cmd']);
    expect(result.env).toEqual([{ name: 'URL', value: 'https://x.com/path?a=1' }]);
  });

  it('drops -v, --rm, -i, --platform, run from args', () => {
    const result = parseDockerArgs(['run', '--rm', '-i', '-v', '/host:/c', '--platform', 'linux/amd64', 'img', 'claude', '--flag']);
    expect(result.image).toBe('img');
    expect(result.command).toEqual(['claude']);
    expect(result.args).toEqual(['--flag']);
  });

  it('splits command from args at first positional after image', () => {
    const result = parseDockerArgs(['run', 'img', 'bash', '-c', 'echo hi']);
    expect(result.command).toEqual(['bash']);
    expect(result.args).toEqual(['-c', 'echo hi']);
  });
});

describe('safeJobName', () => {
  it('lowercases and replaces invalid chars with -', () => {
    expect(safeJobName('MyJob_Name.123')).toBe('myjob-name-123');
  });

  it('truncates to 63 chars total', () => {
    const long = 'a'.repeat(100);
    expect(safeJobName(long).length).toBeLessThanOrEqual(63);
  });

  it('appends a deterministic 8-char hash suffix when truncating', () => {
    const long = 'workflow-step-with-very-long-name-that-definitely-exceeds-the-rfc1123-limit-for-job-names';
    const result = safeJobName(long);
    expect(result.length).toBeLessThanOrEqual(63);
    expect(result).toMatch(/-[a-f0-9]{8}$/);
    expect(safeJobName(long)).toBe(result); // deterministic
  });

  it('strips leading/trailing - and .', () => {
    expect(safeJobName('---foo---')).toBe('foo');
  });
});

// ─── buildV1JobSpec ────────────────────────────────────────────────────────────

const minimalReq: DockerSpawnRequest = {
  dockerArgs: ['run', '--rm', '-e', 'FOO=bar', 'my-image:latest', 'claude', '--verbose'],
  stdinPayload: null,
  timeoutMs: 60_000,
  containerName: 'my-step-container',
  processInstanceId: 'proc-abc-123',
  stepId: 'step-xyz-456',
  outputDir: '/tmp/output',
  logFile: null,
};

const minimalConfig: KubeSpawnConfig = {
  namespace: 'mediforce',
};

describe('buildV1JobSpec', () => {
  // Assertion 1: image lands in containers[0].image
  it('sets image from dockerArgs in containers[0].image', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig);
    expect(job.spec?.template.spec?.containers[0].image).toBe('my-image:latest');
  });

  // Assertion 2: env entries from -e flags land in containers[0].env
  it('maps -e flags to containers[0].env V1EnvVar entries', () => {
    const req: DockerSpawnRequest = {
      ...minimalReq,
      dockerArgs: ['run', '--rm', '-e', 'KEY=val', '-e', 'X=y', 'some-img'],
    };
    const job = buildV1JobSpec(req, minimalConfig);
    expect(job.spec?.template.spec?.containers[0].env).toEqual([
      { name: 'KEY', value: 'val' },
      { name: 'X', value: 'y' },
    ]);
  });

  // Assertions 3, 4, 5: timeout, backoffLimit, ttlSecondsAfterFinished
  it('sets activeDeadlineSeconds, backoffLimit, and ttlSecondsAfterFinished correctly', () => {
    const req: DockerSpawnRequest = { ...minimalReq, timeoutMs: 90_000 };
    const job = buildV1JobSpec(req, minimalConfig);
    expect(job.spec?.activeDeadlineSeconds).toBe(Math.ceil(90_000 / 1000) + 30); // 120
    expect(job.spec?.backoffLimit).toBe(0);
    expect(job.spec?.ttlSecondsAfterFinished).toBe(300);
  });

  // Assertion 6: pod security context
  it('sets podSecurityContext with runAsNonRoot, runAsUser/Group/fsGroup=1000, seccompProfile=RuntimeDefault', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig);
    const psc = job.spec?.template.spec?.securityContext;
    expect(psc?.runAsNonRoot).toBe(true);
    expect(psc?.runAsUser).toBe(1000);
    expect(psc?.runAsGroup).toBe(1000);
    expect(psc?.fsGroup).toBe(1000);
    expect(psc?.seccompProfile?.type).toBe('RuntimeDefault');
  });

  // Assertion 7: container security context
  it('sets containerSecurityContext with readOnlyRootFilesystem, no privilege escalation, drop ALL caps', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig);
    const csc = job.spec?.template.spec?.containers[0].securityContext;
    expect(csc?.readOnlyRootFilesystem).toBe(true);
    expect(csc?.allowPrivilegeEscalation).toBe(false);
    expect(csc?.capabilities?.drop).toEqual(['ALL']);
    expect(csc?.seccompProfile?.type).toBe('RuntimeDefault');
  });

  // Assertion 8: volumes includes emptyDir at /tmp
  it('mounts an emptyDir volume at /tmp on the container', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig);
    const volumes = job.spec?.template.spec?.volumes;
    const mounts = job.spec?.template.spec?.containers[0].volumeMounts;
    expect(volumes).toEqual(expect.arrayContaining([
      { name: 'tmp', emptyDir: {} },
    ]));
    expect(mounts).toEqual(expect.arrayContaining([
      { name: 'tmp', mountPath: '/tmp' },
    ]));
  });

  // Assertion 9: labels on job metadata
  it('sets mediforce.io labels on job metadata', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig);
    const labels = job.metadata?.labels;
    expect(labels?.['mediforce.io/run-id']).toBe('proc-abc-123');
    expect(labels?.['mediforce.io/step-id']).toBe('step-xyz-456');
    expect(labels?.['mediforce.io/managed-by']).toBe('agent-runtime');
  });

  // Assertion 10: containerName > 63 chars → safeJobName truncates with hash
  it('uses safeJobName for metadata.name when containerName exceeds 63 chars', () => {
    const longName = 'This-Is-A-Very-Long-Container-Name-That-Definitely-Exceeds-The-63-Character-Limit-For-K8s';
    const req: DockerSpawnRequest = { ...minimalReq, containerName: longName };
    const job = buildV1JobSpec(req, minimalConfig);
    expect(job.metadata?.name?.length).toBeLessThanOrEqual(63);
    expect(job.metadata?.name).toMatch(/-[a-f0-9]{8}$/);
  });
});
