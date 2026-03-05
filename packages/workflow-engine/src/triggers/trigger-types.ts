export interface TriggerContext {
  definitionName: string;
  definitionVersion: string;
  configName: string;     // ProcessConfig name variant
  configVersion: string;  // ProcessConfig version
  triggerName: string;    // matches Trigger.name from ProcessDefinition
  triggeredBy: string;    // actor ID who fired the trigger
  payload: Record<string, unknown>;
}

export interface TriggerResult {
  instanceId: string;
  status: 'created';
}
