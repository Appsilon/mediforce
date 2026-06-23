/**
 * KubernetesJobSpawnStrategy — happy path integration test
 *
 * All four API surfaces are mocked:
 *  - batchApi.createNamespacedJob
 *  - batchApi.readNamespacedJob
 *  - coreApi.readNamespacedPod  (Pending → Running)
 *  - coreApi.listNamespacedPod  (pod lookup by job-name label)
 *
 * PodLogStream is injected via the logStreamFactory constructor parameter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KubeConfig } from '@kubernetes/client-node';
import type { BatchV1Api, CoreV1Api } from '@kubernetes/client-node';
import type { DockerSpawnRequest } from '../docker-spawn-strategy';
import type { PodLogStream } from '../pod-log-stream';
import { KubernetesJobSpawnStrategy } from '../kubernetes-job-spawn-strategy';
import type { KubeSpawnConfig } from '../kubernetes-job-spec-builder';
import {
  KjssImagePullError,
  KjssSchedulingError,
  KjssAuthError,
  KjssApiError,
} from '../kjss-errors';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockBatchApi(overrides?: Partial<BatchV1Api>): BatchV1Api {
  return {
    createNamespacedJob: vi.fn().mockResolvedValue({
      metadata: { name: 'my-step-container', namespace: 'mediforce' },
      status: {},
    }),
    readNamespacedJob: vi.fn().mockResolvedValue({
      status: {
        conditions: [{ type: 'Complete', status: 'True' }],
        succeeded: 1,
      },
    }),
    deleteNamespacedJob: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as BatchV1Api;
}

function makeMockCoreApi(overrides?: Partial<CoreV1Api>): CoreV1Api {
  return {
    // First call: Pending; second call onwards: Running
    readNamespacedPod: vi
      .fn()
      .mockResolvedValueOnce({ status: { phase: 'Pending' } })
      .mockResolvedValue({ status: { phase: 'Running' } }),
    listNamespacedPod: vi.fn().mockResolvedValue({
      items: [
        {
          metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
          status: { phase: 'Running' },
        },
      ],
    }),
    ...overrides,
  } as unknown as CoreV1Api;
}

/**
 * Creates a mock PodLogStream factory that emits the given lines then resolves.
 */
function makeMockLogStreamFactory(lines: string[]): {
  factory: (api: CoreV1Api) => PodLogStream;
  startSpy: ReturnType<typeof vi.fn>;
} {
  const startSpy = vi.fn().mockImplementation(
    async (_namespace: string, _podName: string, onLine: (line: string) => void) => {
      for (const line of lines) {
        onLine(line);
      }
    },
  );

  const mockStream = { start: startSpy, close: vi.fn() } as unknown as PodLogStream;
  const factory = (_api: CoreV1Api) => mockStream;

  return { factory, startSpy };
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const kubeConfig = new KubeConfig();

const config: KubeSpawnConfig = {
  namespace: 'mediforce',
};

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KubernetesJobSpawnStrategy', () => {
  describe('spawn() — happy path', () => {
    it('resolves with stdout joined from log lines, empty stderr, exitCode 0, no signal', async () => {
      const mockBatchApi = makeMockBatchApi();
      const mockCoreApi = makeMockCoreApi();
      const { factory } = makeMockLogStreamFactory(['line1', 'line2', 'line3']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0, // stable clock
        factory,
      );

      const result = await strategy.spawn(minimalReq);

      expect(result).toEqual({
        stdout: 'line1\nline2\nline3',
        stderr: '',
        exitCode: 0,
        signal: null,
      });
    });

    it('calls onStdoutLine once per log line during live streaming', async () => {
      const mockBatchApi = makeMockBatchApi();
      const mockCoreApi = makeMockCoreApi();
      const { factory } = makeMockLogStreamFactory(['line1', 'line2', 'line3']);

      const onStdoutLine = vi.fn();
      const req: DockerSpawnRequest = { ...minimalReq, onStdoutLine };

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      await strategy.spawn(req);

      expect(onStdoutLine).toHaveBeenCalledTimes(3);
      expect(onStdoutLine).toHaveBeenNthCalledWith(1, 'line1');
      expect(onStdoutLine).toHaveBeenNthCalledWith(2, 'line2');
      expect(onStdoutLine).toHaveBeenNthCalledWith(3, 'line3');
    });

    it('creates the Job in the configured namespace', async () => {
      const mockBatchApi = makeMockBatchApi();
      const mockCoreApi = makeMockCoreApi();
      const { factory } = makeMockLogStreamFactory([]);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      await strategy.spawn(minimalReq);

      expect(mockBatchApi.createNamespacedJob).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'mediforce' }),
      );
    });

    it('supportsLiveStreaming is true', () => {
      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        makeMockBatchApi(),
        makeMockCoreApi(),
        () => 0,
        makeMockLogStreamFactory([]).factory,
      );
      expect(strategy.supportsLiveStreaming).toBe(true);
    });

    it('handles empty log output (zero lines)', async () => {
      const mockBatchApi = makeMockBatchApi();
      const mockCoreApi = makeMockCoreApi();
      const { factory } = makeMockLogStreamFactory([]);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      const result = await strategy.spawn(minimalReq);

      expect(result).toEqual({
        stdout: '',
        stderr: '',
        exitCode: 0,
        signal: null,
      });
    });
  });

  // ─── Error paths ──────────────────────────────────────────────────────────────

  describe('spawn() — error paths', () => {
    // Failure mode #1: Image pull failure
    it('throws KjssImagePullError when pod is Pending with ImagePullBackOff', async () => {
      const mockCoreApi = makeMockCoreApi({
        listNamespacedPod: vi.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
              status: {
                phase: 'Pending',
                containerStatuses: [
                  {
                    state: {
                      waiting: {
                        reason: 'ImagePullBackOff',
                        message: 'Back-off pulling image "bad-image:latest"',
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      const mockBatchApi = makeMockBatchApi();
      const { factory } = makeMockLogStreamFactory([]);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      await expect(strategy.spawn(minimalReq)).rejects.toThrow(KjssImagePullError);
      await expect(strategy.spawn(minimalReq)).rejects.toMatchObject({
        reason: 'ImagePullBackOff',
        message: expect.stringContaining('Back-off pulling image'),
      });
    });

    // Failure mode #2: Scheduling failure (no node fits, past 30s grace)
    it('throws KjssSchedulingError when pod is Pending past the scheduling grace window', async () => {
      // Pod stays Pending forever with no image-pull container status
      const mockCoreApi = makeMockCoreApi({
        listNamespacedPod: vi.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
              status: {
                phase: 'Pending',
                containerStatuses: [],
              },
            },
          ],
        }),
        listNamespacedEvent: vi.fn().mockResolvedValue({
          items: [
            {
              reason: 'FailedScheduling',
              message: '0/3 nodes available: insufficient memory',
            },
          ],
        }),
      });
      const mockBatchApi = makeMockBatchApi();
      const { factory } = makeMockLogStreamFactory([]);

      // Use schedulingGraceMs = 0 so the grace window is already exceeded on
      // the very first poll iteration (clock() + 0 <= clock()).
      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
        0, // schedulingGraceMs = 0 → immediately treat pending as scheduling failure
      );

      await expect(strategy.spawn(minimalReq)).rejects.toThrow(KjssSchedulingError);
    });

    // Failure mode #3: OOMKilled
    it('returns exitCode 137 and signal SIGKILL when pod is OOMKilled', async () => {
      const mockCoreApi = makeMockCoreApi({
        listNamespacedPod: vi.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
              status: {
                phase: 'Succeeded',
                containerStatuses: [
                  {
                    state: {
                      terminated: {
                        reason: 'OOMKilled',
                        exitCode: 137,
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      const mockBatchApi = makeMockBatchApi({
        readNamespacedJob: vi.fn().mockResolvedValue({
          status: {
            conditions: [{ type: 'Failed', status: 'True' }],
            failed: 1,
          },
        }),
      });
      const { factory } = makeMockLogStreamFactory(['some output before OOM']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      const result = await strategy.spawn(minimalReq);

      expect(result).toEqual({
        stdout: 'some output before OOM',
        stderr: '',
        exitCode: 137,
        signal: 'SIGKILL',
      });
    });

    // Failure mode #4: activeDeadlineSeconds hit
    it('returns exitCode null and signal SIGTERM when job hits activeDeadlineSeconds', async () => {
      const mockCoreApi = makeMockCoreApi({
        listNamespacedPod: vi.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
              status: {
                phase: 'Succeeded',
                containerStatuses: [
                  {
                    state: {
                      terminated: {
                        reason: 'DeadlineExceeded',
                        exitCode: 143,
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      const mockBatchApi = makeMockBatchApi({
        readNamespacedJob: vi.fn().mockResolvedValue({
          status: {
            conditions: [{ type: 'Failed', status: 'True', reason: 'DeadlineExceeded' }],
            failed: 1,
          },
        }),
      });
      const { factory } = makeMockLogStreamFactory([]);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      const result = await strategy.spawn(minimalReq);

      expect(result).toEqual({
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: 'SIGTERM',
      });
    });

    // Failure mode #5: Container exit non-zero
    it('returns the non-zero exitCode with no signal when container exits non-zero', async () => {
      const mockCoreApi = makeMockCoreApi({
        listNamespacedPod: vi.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
              status: {
                phase: 'Succeeded',
                containerStatuses: [
                  {
                    state: {
                      terminated: {
                        exitCode: 2,
                        reason: 'Error',
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      const mockBatchApi = makeMockBatchApi({
        readNamespacedJob: vi.fn().mockResolvedValue({
          status: {
            conditions: [{ type: 'Failed', status: 'True' }],
            failed: 1,
          },
        }),
      });
      const { factory } = makeMockLogStreamFactory(['error output line']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      const result = await strategy.spawn(minimalReq);

      expect(result).toEqual({
        stdout: 'error output line',
        stderr: '',
        exitCode: 2,
        signal: null,
      });
    });

    // Failure mode #6: RBAC denial (403 from createNamespacedJob)
    it('throws KjssAuthError when createNamespacedJob returns 403', async () => {
      const k8sError = Object.assign(new Error('Forbidden'), {
        response: { statusCode: 403 },
        body: { message: 'pods is forbidden: User "sa" cannot create resource' },
      });
      const mockBatchApi = makeMockBatchApi({
        createNamespacedJob: vi.fn().mockRejectedValue(k8sError),
      });
      const mockCoreApi = makeMockCoreApi();
      const { factory } = makeMockLogStreamFactory([]);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      await expect(strategy.spawn(minimalReq)).rejects.toThrow(KjssAuthError);
    });

    // Failure mode #7: K8s API server unreachable (network error)
    it('throws KjssApiError with statusCode 0 when API server is unreachable', async () => {
      const networkError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6443'), {
        code: 'ECONNREFUSED',
      });
      const mockBatchApi = makeMockBatchApi({
        createNamespacedJob: vi.fn().mockRejectedValue(networkError),
      });
      const mockCoreApi = makeMockCoreApi();
      const { factory } = makeMockLogStreamFactory([]);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      await expect(strategy.spawn(minimalReq)).rejects.toThrow(KjssApiError);
      await expect(strategy.spawn(minimalReq)).rejects.toMatchObject({ statusCode: 0 });
    });
  });

  // ─── Cleanup logic ────────────────────────────────────────────────────────────

  describe('spawn() — cleanup on success/failure', () => {
    it('does NOT call deleteNamespacedJob on success (TTL handles GC)', async () => {
      const mockBatchApi = makeMockBatchApi();
      const mockCoreApi = makeMockCoreApi();
      const { factory } = makeMockLogStreamFactory(['output']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
      );

      await strategy.spawn(minimalReq);

      expect(mockBatchApi.deleteNamespacedJob).not.toHaveBeenCalled();
    });

    it('calls deleteNamespacedJob with propagationPolicy Foreground when spawn fails', async () => {
      // Pod stays Pending with scheduling failure
      const mockCoreApi = makeMockCoreApi({
        listNamespacedPod: vi.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
              status: { phase: 'Pending', containerStatuses: [] },
            },
          ],
        }),
        listNamespacedEvent: vi.fn().mockResolvedValue({
          items: [{ reason: 'FailedScheduling', message: '0/3 nodes available' }],
        }),
      });
      const mockBatchApi = makeMockBatchApi({
        deleteNamespacedJob: vi.fn().mockResolvedValue({}),
      });
      const { factory } = makeMockLogStreamFactory([]);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
        0, // schedulingGraceMs = 0 → immediate scheduling failure
      );

      await expect(strategy.spawn(minimalReq)).rejects.toThrow(KjssSchedulingError);

      expect(mockBatchApi.deleteNamespacedJob).toHaveBeenCalledOnce();
      expect(mockBatchApi.deleteNamespacedJob).toHaveBeenCalledWith(
        expect.objectContaining({ propagationPolicy: 'Foreground' }),
      );
    });

    it('preserves the original spawn error when cleanup (deleteNamespacedJob) itself throws', async () => {
      const mockCoreApi = makeMockCoreApi({
        listNamespacedPod: vi.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'my-step-container-abc12', labels: { 'job-name': 'my-step-container' } },
              status: { phase: 'Pending', containerStatuses: [] },
            },
          ],
        }),
        listNamespacedEvent: vi.fn().mockResolvedValue({
          items: [{ reason: 'FailedScheduling', message: '0/3 nodes available' }],
        }),
      });
      const cleanupError = new Error('Job already deleted by TTL');
      const mockBatchApi = makeMockBatchApi({
        deleteNamespacedJob: vi.fn().mockRejectedValue(cleanupError),
      });
      const { factory } = makeMockLogStreamFactory([]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig,
        config,
        mockBatchApi,
        mockCoreApi,
        () => 0,
        factory,
        0,
      );

      // Original spawn error (KjssSchedulingError) must surface, not cleanupError
      await expect(strategy.spawn(minimalReq)).rejects.toThrow(KjssSchedulingError);

      // Cleanup error must be logged via console.warn
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('cleanup failed'),
      );

      warnSpy.mockRestore();
    });
  });

  // ─── Output-delivery wiring (configMap + ownerRef patch) ────────────────────
  // KJSS reads the plugin's outputDir via an injected reader, creates a per-Job
  // ConfigMap with the tar.gz.b64 payload, then after Job creation patches the
  // ConfigMap's ownerReferences for cascade GC. See AI/local-13 + the
  // initContainer in buildV1JobSpec for the consumer side.

  describe('spawn() — output-delivery (configMap + ownerRef)', () => {
    function makeReader(files: Array<[string, Buffer]>) {
      return vi.fn().mockResolvedValue(new Map<string, Buffer>(files));
    }

    function makeMockCoreApiWithCm(overrides: Partial<CoreV1Api> = {}): CoreV1Api {
      const base = makeMockCoreApi();
      return {
        ...base,
        createNamespacedConfigMap: vi.fn().mockResolvedValue({}),
        patchNamespacedConfigMap: vi.fn().mockResolvedValue({}),
        ...overrides,
      } as unknown as CoreV1Api;
    }

    it('creates the ConfigMap BEFORE the Job when outputDir has files', async () => {
      const reader = makeReader([['prompt.txt', Buffer.from('hello')]]);
      const mockBatchApi = makeMockBatchApi({
        createNamespacedJob: vi.fn().mockResolvedValue({
          metadata: { name: 'my-step-container', namespace: 'mediforce', uid: 'job-uid-001' },
          status: {},
        }),
      });
      const mockCoreApi = makeMockCoreApiWithCm();
      const { factory } = makeMockLogStreamFactory(['ok']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig, config, mockBatchApi, mockCoreApi, () => 0, factory, 30_000, reader,
      );
      await strategy.spawn(minimalReq);

      const cmCreate = mockCoreApi.createNamespacedConfigMap as ReturnType<typeof vi.fn>;
      const jobCreate = mockBatchApi.createNamespacedJob as ReturnType<typeof vi.fn>;
      expect(cmCreate).toHaveBeenCalledOnce();
      expect(jobCreate).toHaveBeenCalledOnce();
      // Order: configMap must come first
      expect(cmCreate.mock.invocationCallOrder[0]).toBeLessThan(jobCreate.mock.invocationCallOrder[0]);

      // The configMap body carries the binaryData payload key
      const cmCall = cmCreate.mock.calls[0][0];
      expect(cmCall.namespace).toBe('mediforce');
      expect(cmCall.body.binaryData?.['payload.tar.gz']).toBeDefined();
      expect(cmCall.body.metadata?.name).toMatch(/-output$/);
    });

    it('patches the ConfigMap ownerReferences with the Job UID after Job creation', async () => {
      const reader = makeReader([['prompt.txt', Buffer.from('hello')]]);
      const mockBatchApi = makeMockBatchApi({
        createNamespacedJob: vi.fn().mockResolvedValue({
          metadata: { name: 'my-step-container', namespace: 'mediforce', uid: 'job-uid-001' },
          status: {},
        }),
      });
      const mockCoreApi = makeMockCoreApiWithCm();
      const { factory } = makeMockLogStreamFactory(['ok']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig, config, mockBatchApi, mockCoreApi, () => 0, factory, 30_000, reader,
      );
      await strategy.spawn(minimalReq);

      const patch = mockCoreApi.patchNamespacedConfigMap as ReturnType<typeof vi.fn>;
      expect(patch).toHaveBeenCalledOnce();
      const patchCall = patch.mock.calls[0][0];
      expect(patchCall.namespace).toBe('mediforce');
      expect(patchCall.name).toMatch(/-output$/);
      // The patch body is a JSON patch op that adds ownerReferences with the Job's UID
      const opBody = Array.isArray(patchCall.body) ? patchCall.body[0] : patchCall.body;
      const ownerRefs = opBody.value ?? opBody.metadata?.ownerReferences;
      expect(ownerRefs[0]).toMatchObject({
        apiVersion: 'batch/v1',
        kind: 'Job',
        name: 'my-step-container',
        uid: 'job-uid-001',
        controller: true,
        blockOwnerDeletion: true,
      });
    });

    it('skips ConfigMap creation entirely when outputDir is empty', async () => {
      const reader = makeReader([]); // empty map
      const mockBatchApi = makeMockBatchApi();
      const mockCoreApi = makeMockCoreApiWithCm();
      const { factory } = makeMockLogStreamFactory(['ok']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig, config, mockBatchApi, mockCoreApi, () => 0, factory, 30_000, reader,
      );
      await strategy.spawn(minimalReq);

      expect(mockCoreApi.createNamespacedConfigMap).not.toHaveBeenCalled();
      expect(mockCoreApi.patchNamespacedConfigMap).not.toHaveBeenCalled();
      // Job still gets created
      expect(mockBatchApi.createNamespacedJob).toHaveBeenCalledOnce();
    });

    it('does NOT create the Job if ConfigMap creation fails', async () => {
      const reader = makeReader([['prompt.txt', Buffer.from('hello')]]);
      const mockBatchApi = makeMockBatchApi();
      const mockCoreApi = makeMockCoreApiWithCm({
        createNamespacedConfigMap: vi.fn().mockRejectedValue(
          Object.assign(new Error('cm create failed'), { code: 500 }),
        ),
      });
      const { factory } = makeMockLogStreamFactory(['ok']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig, config, mockBatchApi, mockCoreApi, () => 0, factory, 30_000, reader,
      );

      await expect(strategy.spawn(minimalReq)).rejects.toThrow();
      expect(mockBatchApi.createNamespacedJob).not.toHaveBeenCalled();
    });

    it('passes outputConfigMapName to buildV1JobSpec so the Job spec mounts /output', async () => {
      const reader = makeReader([['prompt.txt', Buffer.from('hello')]]);
      const mockBatchApi = makeMockBatchApi({
        createNamespacedJob: vi.fn().mockResolvedValue({
          metadata: { name: 'my-step-container', namespace: 'mediforce', uid: 'job-uid-001' },
          status: {},
        }),
      });
      const mockCoreApi = makeMockCoreApiWithCm();
      const { factory } = makeMockLogStreamFactory(['ok']);

      const strategy = new KubernetesJobSpawnStrategy(
        kubeConfig, config, mockBatchApi, mockCoreApi, () => 0, factory, 30_000, reader,
      );
      await strategy.spawn(minimalReq);

      const jobBody = (mockBatchApi.createNamespacedJob as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
      const volumes = jobBody.spec.template.spec.volumes;
      expect(volumes.map((v: { name: string }) => v.name)).toEqual(
        expect.arrayContaining(['output-cm', 'output', 'tmp']),
      );
      expect(jobBody.spec.template.spec.initContainers).toHaveLength(1);
    });
  });
});
