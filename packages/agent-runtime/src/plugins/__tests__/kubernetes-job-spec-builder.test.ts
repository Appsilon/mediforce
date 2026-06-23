import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { randomFillSync } from 'node:crypto';
import { parseDockerArgs, safeJobName, buildV1JobSpec, buildOutputConfigMap, OUTPUT_PAYLOAD_LIMIT_BYTES } from '../kubernetes-job-spec-builder';
import type { KubeSpawnConfig } from '../kubernetes-job-spec-builder';
import type { DockerSpawnRequest } from '../docker-spawn-strategy';
import { KjssOutputDirTooLargeError } from '../kjss-errors';

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

  // Regression: the actual dockerArgs shape emitted by
  // base-container-agent-plugin.ts:1489 and script-container-plugin.ts:293.
  // Before the fix, --name leaked the containerName into the image slot,
  // so KJSS rendered a PodSpec container with image = "--name" — kubelet
  // then rejected it with `InvalidImageName: "--name"`.
  it('drops --name <containerName> + --memory + --cpus + -w like the real caller emits', () => {
    const parsed = parseDockerArgs([
      'run', '--rm', '-i',
      '--name', 'mediforce-proc-abc-step-xyz',
      '--memory', '8g',
      '--cpus', '2',
      '-v', '/host/output:/output',
      '-e', 'FOO=bar',
      '-v', '/host/workspace:/workspace',
      '-w', '/workspace',
      'mediforce-agent:protocol-to-tfl',
      'node', 'agent.js',
    ]);
    expect(parsed.image).toBe('mediforce-agent:protocol-to-tfl');
    expect(parsed.command).toEqual(['node']);
    expect(parsed.args).toEqual(['agent.js']);
    expect(parsed.env).toEqual([{ name: 'FOO', value: 'bar' }]);
  });

  it.each([
    ['--name',   'some-container-name'],
    ['--memory', '8g'],
    ['--cpus',   '2'],
    ['-w',       '/workspace'],
  ])('drops docker flag %s with its value', (flag, value) => {
    const parsed = parseDockerArgs(['run', flag, value, 'theimage:tag']);
    expect(parsed.image).toBe('theimage:tag');
    expect(parsed.command).toEqual([]);
    expect(parsed.args).toEqual([]);
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

// ─── output delivery (configMap + initContainer) ──────────────────────────────
// The plugin's outputDir (prompt.txt, opencode.json, nested .local/share/...)
// is shipped to the spawned container as a tar.gz.base64 blob inside a per-Job
// configMap; an initContainer base64-decodes + untars it into an emptyDir
// mounted at /output on the main container. This mirrors the docker-mode
// `-v <hostOutputDir>:/output` semantics that every agent plugin's command
// already assumes.

describe('buildV1JobSpec — output delivery', () => {
  it('omits output volumes + initContainer when outputConfigMapName is not set', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig);
    const podSpec = job.spec?.template.spec;
    // No output-cm or output volumes
    expect(podSpec?.volumes?.map((v) => v.name)).toEqual(['tmp']);
    // No init containers
    expect(podSpec?.initContainers).toBeUndefined();
    // Main container has only /tmp mount
    expect(podSpec?.containers[0].volumeMounts?.map((m) => m.mountPath)).toEqual(['/tmp']);
  });

  it('adds output-cm configMap volume + output emptyDir + prep-output initContainer when outputConfigMapName is set', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig, {
      outputConfigMapName: 'my-job-output',
    });
    const podSpec = job.spec?.template.spec;

    expect(podSpec?.volumes).toEqual(expect.arrayContaining([
      { name: 'tmp', emptyDir: {} },
      { name: 'output-cm', configMap: { name: 'my-job-output' } },
      { name: 'output', emptyDir: {} },
    ]));

    expect(podSpec?.initContainers).toHaveLength(1);
    const init = podSpec!.initContainers![0];
    expect(init.name).toBe('prep-output');
    expect(init.image).toBe('public.ecr.aws/docker/library/busybox:1.36'); // default
    expect(init.command).toEqual([
      'sh', '-c',
      'base64 -d < /cm/payload.tar.gz.b64 | tar -xzC /output --no-same-owner',
    ]);
    expect(init.volumeMounts).toEqual([
      { name: 'output-cm', mountPath: '/cm', readOnly: true },
      { name: 'output',    mountPath: '/output' },
    ]);

    // Main container gets the /output mount too
    expect(podSpec?.containers[0].volumeMounts).toEqual(expect.arrayContaining([
      { name: 'output', mountPath: '/output' },
    ]));
  });

  it('respects a custom initContainerImage when supplied', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig, {
      outputConfigMapName: 'my-job-output',
      initContainerImage: 'my-registry.example.com/internal-mirror/busybox@sha256:deadbeef',
    });
    expect(job.spec?.template.spec?.initContainers?.[0].image).toBe(
      'my-registry.example.com/internal-mirror/busybox@sha256:deadbeef',
    );
  });

  it('init container inherits the same security stance as the main container (non-root, locked-down)', () => {
    const job = buildV1JobSpec(minimalReq, minimalConfig, {
      outputConfigMapName: 'my-job-output',
    });
    const initSc = job.spec?.template.spec?.initContainers?.[0].securityContext;
    // Same baseline as main container — readOnly root, no priv escalation,
    // dropped caps. (UID/GID/runAsNonRoot inherited from podSecurityContext.)
    expect(initSc?.readOnlyRootFilesystem).toBe(true);
    expect(initSc?.allowPrivilegeEscalation).toBe(false);
    expect(initSc?.capabilities?.drop).toEqual(['ALL']);
  });
});

// ─── buildOutputConfigMap — turns a {path → Buffer} into a V1ConfigMap ─────────
// Held as a pure function so tests don't touch the filesystem. The
// KubernetesJobSpawnStrategy is responsible for walking outputDir and
// assembling the Map; this helper just renders the configMap payload.

describe('buildOutputConfigMap', () => {
  const cmName = 'mediforce-step-abc-output';

  it('returns a V1ConfigMap with the configured name and the standard payload key', () => {
    const files = new Map<string, Buffer>([['prompt.txt', Buffer.from('hello\n', 'utf-8')]]);
    const cm = buildOutputConfigMap(cmName, files);
    expect(cm.metadata?.name).toBe(cmName);
    expect(cm.data).toBeUndefined();
    expect(cm.binaryData?.['payload.tar.gz.b64']).toBeDefined();
  });

  it('the payload decodes back to a tarball containing the original files (text)', () => {
    const files = new Map<string, Buffer>([
      ['prompt.txt', Buffer.from('Hello, agent!', 'utf-8')],
      ['opencode.json', Buffer.from('{"k":1}', 'utf-8')],
    ]);
    const cm = buildOutputConfigMap(cmName, files);
    const b64 = cm.binaryData!['payload.tar.gz.b64'];
    const gzipped = Buffer.from(b64, 'base64');
    const tarball = gunzipSync(gzipped);

    // Parse the tar minimally: read 512-byte headers, look for our filenames.
    // Each header starts at a 512-byte boundary; name is bytes 0..99.
    const names = new Set<string>();
    for (let offset = 0; offset < tarball.length; offset += 512) {
      const nameBytes = tarball.subarray(offset, offset + 100);
      const name = nameBytes.toString('utf-8').replace(/\0.*$/, '');
      if (!name) break;     // end-of-archive marker
      names.add(name);
      // Skip past the file content blocks
      const sizeStr = tarball.subarray(offset + 124, offset + 124 + 12).toString('utf-8').replace(/[\0 ]/g, '');
      const size = parseInt(sizeStr, 8) || 0;
      const padded = Math.ceil(size / 512) * 512;
      offset += padded;
    }
    expect(names).toEqual(new Set(['prompt.txt', 'opencode.json']));
  });

  it('the payload preserves nested paths (e.g. .local/share/opencode/auth.json)', () => {
    const files = new Map<string, Buffer>([
      ['prompt.txt', Buffer.from('x', 'utf-8')],
      ['.local/share/opencode/auth.json', Buffer.from('{"k":1}', 'utf-8')],
    ]);
    const cm = buildOutputConfigMap(cmName, files);
    const tarball = gunzipSync(Buffer.from(cm.binaryData!['payload.tar.gz.b64'], 'base64'));
    expect(tarball.toString('utf-8')).toContain('.local/share/opencode/auth.json');
  });

  it('handles binary content (arbitrary bytes including NULs)', () => {
    const binary = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x00, 0x12]);
    const files = new Map<string, Buffer>([['blob.bin', binary]]);
    const cm = buildOutputConfigMap(cmName, files);
    const tarball = gunzipSync(Buffer.from(cm.binaryData!['payload.tar.gz.b64'], 'base64'));
    // Find the file content after the 512-byte header
    const fileStart = 512;
    expect(tarball.subarray(fileStart, fileStart + 6).equals(binary)).toBe(true);
  });

  it('returns an empty-payload configMap when the file map is empty', () => {
    const cm = buildOutputConfigMap(cmName, new Map());
    expect(cm.metadata?.name).toBe(cmName);
    expect(cm.binaryData?.['payload.tar.gz.b64']).toBeDefined();
    // Round-trip should still decode to a valid (empty) tarball
    const tarball = gunzipSync(Buffer.from(cm.binaryData!['payload.tar.gz.b64'], 'base64'));
    // End-of-archive marker = 1024 zero bytes
    expect(tarball.length).toBeGreaterThanOrEqual(1024);
  });

  it('throws KjssOutputDirTooLargeError when the base64 blob exceeds the budget', () => {
    // Real CSPRNG output is essentially incompressible — gzip overhead
    // makes the output slightly LARGER than the input. 1 MiB random →
    // ~1.4 MiB base64 → well over the 900 KiB cap.
    const incompressible = Buffer.alloc(1_024 * 1024);
    randomFillSync(incompressible);
    const files = new Map<string, Buffer>([['big.bin', incompressible]]);
    expect(() => buildOutputConfigMap(cmName, files)).toThrow(KjssOutputDirTooLargeError);
  });

  it('exposes OUTPUT_PAYLOAD_LIMIT_BYTES (sanity-bounded under the 1 MiB ConfigMap cap)', () => {
    expect(OUTPUT_PAYLOAD_LIMIT_BYTES).toBeGreaterThan(0);
    expect(OUTPUT_PAYLOAD_LIMIT_BYTES).toBeLessThan(1024 * 1024);
  });
});
