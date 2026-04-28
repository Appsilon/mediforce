export class WebhookPayloadValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Webhook payload validation failed:\n${errors.join('\n')}`);
    this.name = 'WebhookPayloadValidationError';
  }
}

export class TriggerNotFoundError extends Error {
  constructor(triggerName: string, definitionName: string) {
    super(
      `Trigger "${triggerName}" not found in process definition "${definitionName}"`,
    );
    this.name = 'TriggerNotFoundError';
  }
}

/**
 * Thrown when a manual run is requested for a workflow definition that
 * does not declare a `manual` trigger in `triggers[]`. This is the
 * server-side guard that mirrors the disabled state of the UI button.
 */
export class ManualTriggerNotDeclaredError extends Error {
  constructor(definitionName: string, version: number) {
    super(
      `Workflow "${definitionName}" v${version} does not declare a manual trigger and cannot be started manually.`,
    );
    this.name = 'ManualTriggerNotDeclaredError';
  }
}
