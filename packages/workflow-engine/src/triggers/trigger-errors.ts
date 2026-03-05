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
