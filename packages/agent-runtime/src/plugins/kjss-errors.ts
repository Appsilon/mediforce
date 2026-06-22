export type KjssErrorCode = 'IMAGE_PULL' | 'SCHEDULING' | 'AUTH' | 'API' | 'UNKNOWN';

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
