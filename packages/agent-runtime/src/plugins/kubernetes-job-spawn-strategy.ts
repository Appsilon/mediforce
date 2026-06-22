import { BatchV1Api, CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import type { V1Job } from '@kubernetes/client-node';
import type { DockerSpawnStrategy, DockerSpawnRequest, DockerSpawnResult } from './docker-spawn-strategy';
import { buildV1JobSpec, safeJobName, type KubeSpawnConfig } from './kubernetes-job-spec-builder';
import { PodLogStream } from './pod-log-stream';
import { KjssImagePullError, KjssSchedulingError, KjssAuthError, KjssApiError } from './kjss-errors';

// ─── K8s API error classifier ─────────────────────────────────────────────────

/** Image-pull waiting reasons that mean we should immediately stop polling. */
const IMAGE_PULL_REASONS = new Set(['ImagePullBackOff', 'ErrImagePull', 'InvalidImageName']);

/**
 * Returns the HTTP status code from a @kubernetes/client-node error, or 0 if
 * the error is a network-level failure (no HTTP response at all).
 * Returns null for non-K8s errors.
 */
function k8sStatusCode(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  // HTTP response present — extract statusCode
  if (typeof e['response'] === 'object' && e['response'] !== null) {
    const resp = e['response'] as Record<string, unknown>;
    if (typeof resp['statusCode'] === 'number') return resp['statusCode'];
  }
  // Pure network error: code is an errno string, no HTTP response
  if (typeof e['code'] === 'string' && e['message'] !== undefined) {
    return 0;
  }
  return null;
}

/**
 * Wraps a K8s API call.  On error:
 *  - statusCode 403  → KjssAuthError
 *  - statusCode 0 (network) → KjssApiError(…, 0)
 *  - other K8s HTTP errors → KjssApiError(…, statusCode)
 *  - non-K8s errors → rethrown as-is
 */
async function callK8s<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = k8sStatusCode(err);
    if (code === null) throw err; // Not a K8s error — pass through
    const message = extractK8sMessage(err);
    if (code === 403) {
      throw new KjssAuthError(
        `${message} — check that the ServiceAccount has the required Role/ClusterRole bindings`,
      );
    }
    throw new KjssApiError(message, code);
  }
}

function extractK8sMessage(err: unknown): string {
  if (err === null || typeof err !== 'object') return String(err);
  const e = err as Record<string, unknown>;
  // Prefer the body.message field that K8s puts the API server reason in
  if (typeof e['body'] === 'object' && e['body'] !== null) {
    const body = e['body'] as Record<string, unknown>;
    if (typeof body['message'] === 'string') return body['message'];
  }
  if (typeof e['message'] === 'string') return e['message'];
  return String(err);
}

// ─── Polling helpers ──────────────────────────────────────────────────────────

/**
 * Polls `fn` every `intervalMs` until it returns a non-null value or
 * `timeoutMs` elapses.  Returns the value or throws on timeout.
 */
async function pollUntil<T>(
  fn: () => Promise<T | null>,
  intervalMs: number,
  timeoutMs: number,
  clock: () => number,
  timeoutMessage: string,
): Promise<T> {
  const deadline = clock() + timeoutMs;
  while (true) {
    const result = await fn();
    if (result !== null) return result;

    const remaining = deadline - clock();
    if (remaining <= 0) {
      throw new Error(timeoutMessage);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}

// ─── KubernetesJobSpawnStrategy ───────────────────────────────────────────────

export class KubernetesJobSpawnStrategy implements DockerSpawnStrategy {
  readonly supportsLiveStreaming = true;

  constructor(
    private readonly kubeConfig: KubeConfig,
    private readonly config: KubeSpawnConfig,
    // injected for testability:
    private readonly batchApi: BatchV1Api = kubeConfig.makeApiClient(BatchV1Api),
    private readonly coreApi: CoreV1Api = kubeConfig.makeApiClient(CoreV1Api),
    private readonly clock: () => number = () => Date.now(),
    private readonly logStreamFactory: (api: CoreV1Api) => PodLogStream = (api) => new PodLogStream(api),
    /** Grace period (ms) before a Pending pod is treated as a scheduling failure. */
    private readonly schedulingGraceMs: number = 30_000,
  ) {}

  async spawn(req: DockerSpawnRequest): Promise<DockerSpawnResult> {
    const { namespace } = this.config;

    // Step 1-2: build V1Job spec
    const job = buildV1JobSpec(req, this.config);
    const jobName = safeJobName(req.containerName);

    // Step 3: create the Job — failure mode #6 (403 RBAC) and #7 (network)
    // If createNamespacedJob throws, the Job was never created — no cleanup needed.
    const createdJob = await callK8s(() =>
      this.batchApi.createNamespacedJob({ namespace, body: job }),
    );

    let succeeded = false;
    try {
      // Step 5: wait for Pod Running — failure modes #1 (image pull) and #2 (scheduling)
      const { podName, finalPod } = await this.waitForPodRunning(namespace, jobName);

      // Step 6: stream logs to completion
      const stdout = await this.streamLogsToCompletion(namespace, podName, req);

      // Step 7-8: observe Job outcome — failure modes #3 (OOM), #4 (deadline), #5 (exit code)
      const outcome = await this.observeJobOutcome(namespace, jobName, finalPod);

      succeeded = true;
      return { ...outcome, stdout };
    } finally {
      if (!succeeded) {
        // On failure: explicitly delete with Foreground propagation so the Pod is also GC'd.
        // On success: rely on ttlSecondsAfterFinished: 300 set in the Job spec.
        await this.cleanupJob(createdJob as V1Job).catch((err: Error) => {
          console.warn(
            `[kjss] cleanup failed for job ${(createdJob as V1Job).metadata?.name}: ${err.message}`,
          );
        });
      }
    }
  }

  private async cleanupJob(job: V1Job): Promise<void> {
    const name = job.metadata?.name!;
    const namespace = this.config.namespace;
    await this.batchApi.deleteNamespacedJob({ name, namespace, propagationPolicy: 'Foreground' });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Polls for the Pod associated with the Job (via job-name label) until its
   * phase is Running or Succeeded.  Returns the pod name and the final pod object.
   *
   * K8s automatically labels Job pods with `job-name: <job-name>`.
   *
   * Throws KjssImagePullError for image-pull failure modes.
   * Throws KjssSchedulingError when the pod stays Pending past schedulingGraceMs.
   */
  private async waitForPodRunning(
    namespace: string,
    jobName: string,
  ): Promise<{ podName: string; finalPod: object }> {
    const schedulingDeadline = this.clock() + this.schedulingGraceMs;

    return pollUntil(
      async () => {
        const response = await callK8s(() =>
          this.coreApi.listNamespacedPod({
            namespace,
            labelSelector: `job-name=${jobName}`,
          }),
        );

        const pods = (response as { items?: object[] }).items ?? [];
        for (const pod of pods) {
          const p = pod as {
            metadata?: { name?: string };
            status?: {
              phase?: string;
              containerStatuses?: Array<{
                state?: {
                  waiting?: { reason?: string; message?: string };
                  terminated?: { reason?: string; exitCode?: number };
                };
              }>;
            };
          };

          const phase = p.status?.phase;

          // ── Failure mode #1: image pull ────────────────────────────────────
          const waitingReason = p.status?.containerStatuses?.[0]?.state?.waiting?.reason;
          if (phase === 'Pending' && waitingReason !== undefined && IMAGE_PULL_REASONS.has(waitingReason)) {
            const waitingMessage =
              p.status?.containerStatuses?.[0]?.state?.waiting?.message ?? '';
            throw new KjssImagePullError(waitingReason, waitingMessage);
          }

          if (phase === 'Running' || phase === 'Succeeded') {
            const name = p.metadata?.name;
            if (name) return { podName: name, finalPod: pod };
          }

          // Failed phase without an image-pull reason — surface as API error
          if (phase === 'Failed') {
            throw new Error(`Pod for job ${jobName} failed before reaching Running phase`);
          }
        }

        // ── Failure mode #2: scheduling failure ────────────────────────────
        // If we have a Pending pod and we've exceeded the scheduling grace window, check events.
        if (pods.length > 0 && this.clock() >= schedulingDeadline) {
          const events = await callK8s(() =>
            (this.coreApi as unknown as { listNamespacedEvent: (opts: object) => Promise<{ items?: Array<{ reason?: string; message?: string }> }> }).listNamespacedEvent({
              namespace,
              fieldSelector: `involvedObject.name=${jobName}`,
            }),
          );
          const eventItems = events.items ?? [];
          const failedScheduling = eventItems.filter((e) => e.reason === 'FailedScheduling');
          const eventReasons = failedScheduling.map((e) => e.message ?? e.reason ?? 'FailedScheduling');
          throw new KjssSchedulingError(
            `Pod for job ${namespace}/${jobName} stayed Pending past ${this.schedulingGraceMs}ms grace window`,
            eventReasons.length > 0 ? eventReasons : ['FailedScheduling'],
          );
        }

        // No pod yet, or still Pending inside grace window — loop
        return null;
      },
      1_000,
      60_000,
      this.clock,
      `Timed out waiting for pod for job ${namespace}/${jobName} to reach Running phase`,
    );
  }

  /**
   * Opens a PodLogStream for the given pod and collects all output lines.
   * Calls req.onStdoutLine for each line for live streaming support.
   * Returns the full stdout string (lines joined with '\n').
   */
  private async streamLogsToCompletion(
    namespace: string,
    podName: string,
    req: DockerSpawnRequest,
  ): Promise<string> {
    const lines: string[] = [];
    const stream = this.logStreamFactory(this.coreApi);

    await stream.start(namespace, podName, (line) => {
      lines.push(line);
      req.onStdoutLine?.(line);
    });

    return lines.join('\n');
  }

  /**
   * Polls the Job until a Complete or Failed condition is observed.
   * Returns exit-code/signal shape for the caller to merge with stdout/stderr.
   *
   * Handles:
   *  #3 OOMKilled  → { exitCode: 137, signal: 'SIGKILL' }
   *  #4 DeadlineExceeded → { exitCode: null, signal: 'SIGTERM' }
   *  #5 non-zero exit  → { exitCode, signal: null }
   *  happy path    → { exitCode: 0, signal: null }
   */
  private async observeJobOutcome(
    namespace: string,
    jobName: string,
    finalPod: object,
  ): Promise<Omit<DockerSpawnResult, 'stdout'>> {
    type Outcome = Omit<DockerSpawnResult, 'stdout'>;

    return pollUntil(
      async () => {
        const job = await callK8s(() =>
          this.batchApi.readNamespacedJob({ name: jobName, namespace }),
        );
        const conditions = (job as V1Job).status?.conditions ?? [];

        for (const condition of conditions) {
          if (condition.type === 'Complete' && condition.status === 'True') {
            return { exitCode: 0, signal: null, stderr: '' } satisfies Outcome;
          }

          if (condition.type === 'Failed' && condition.status === 'True') {
            // ── Failure mode #4: activeDeadlineSeconds exceeded ──────────────
            if (condition.reason === 'DeadlineExceeded') {
              return { exitCode: null, signal: 'SIGTERM', stderr: '' } satisfies Outcome;
            }

            // For OOMKilled and non-zero exits, inspect the pod's terminated status
            const pod = finalPod as {
              status?: {
                containerStatuses?: Array<{
                  state?: {
                    terminated?: { reason?: string; exitCode?: number };
                  };
                }>;
              };
            };
            const terminated = pod.status?.containerStatuses?.[0]?.state?.terminated;

            // ── Failure mode #3: OOMKilled ─────────────────────────────────
            if (terminated?.reason === 'OOMKilled') {
              return { exitCode: 137, signal: 'SIGKILL', stderr: '' } satisfies Outcome;
            }

            // ── Failure mode #5: non-zero exit code ───────────────────────
            const exitCode = terminated?.exitCode ?? 1;
            return { exitCode, signal: null, stderr: '' } satisfies Outcome;
          }
        }

        return null;
      },
      2_000,
      600_000,
      this.clock,
      `Timed out waiting for job ${namespace}/${jobName} to complete`,
    );
  }
}
