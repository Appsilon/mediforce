export class TriggerNotFoundError extends Error {
  constructor(triggerName: string, definitionName: string) {
    super(
      `Trigger "${triggerName}" not found for workflow "${definitionName}"`,
    );
    this.name = 'TriggerNotFoundError';
  }
}

/**
 * Thrown when a manual run is requested for a workflow without an enabled
 * manual trigger row. This is the server-side guard that mirrors the disabled
 * state of the UI button.
 */
export class ManualTriggerNotDeclaredError extends Error {
  constructor(definitionName: string, version: number) {
    super(
      `Workflow "${definitionName}" v${version} has no enabled manual trigger and cannot be started manually.`,
    );
    this.name = 'ManualTriggerNotDeclaredError';
  }
}
