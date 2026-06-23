export type KjssErrorCode = 'IMAGE_PULL' | 'SCHEDULING' | 'AUTH' | 'API' | 'PAYLOAD_TOO_LARGE' | 'UNKNOWN';

export abstract class KjssError extends Error {
  abstract readonly code: KjssErrorCode;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class KjssImagePullError extends KjssError {
  readonly code = 'IMAGE_PULL' as const;
  constructor(readonly reason: string, message: string) {
    super(`Image pull failed (${reason}): ${message}`);
  }
}

export class KjssSchedulingError extends KjssError {
  readonly code = 'SCHEDULING' as const;
  constructor(message: string, readonly events: readonly string[]) {
    super(`Pod scheduling failed: ${message}`);
  }
}

export class KjssAuthError extends KjssError {
  readonly code = 'AUTH' as const;
  constructor(message: string) {
    super(`Kubernetes RBAC denied: ${message}`);
  }
}

export class KjssApiError extends KjssError {
  readonly code = 'API' as const;
  constructor(message: string, readonly statusCode: number) {
    super(`Kubernetes API error (${statusCode}): ${message}`);
  }
}

/** Thrown when the plugin's outputDir contents exceed the budget for a
 *  per-Job ConfigMap payload. Configured below the 1 MiB etcd object cap
 *  so there's headroom for the configMap's metadata. The error names the
 *  observed size so the caller can decide whether to slim the payload or
 *  escalate to a different file-delivery mechanism (e.g. a shared PVC). */
export class KjssOutputDirTooLargeError extends KjssError {
  readonly code = 'PAYLOAD_TOO_LARGE' as const;
  constructor(readonly observedBytes: number, readonly limitBytes: number) {
    super(
      `outputDir payload (${observedBytes} bytes after tar+gzip+base64) exceeds the ConfigMap budget of ${limitBytes} bytes. ` +
      `Reduce the prompt or config size, or migrate this workflow to a shared-PVC file-delivery mechanism.`,
    );
  }
}
