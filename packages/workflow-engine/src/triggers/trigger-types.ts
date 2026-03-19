/** @deprecated Use WorkflowTriggerContext instead */
export interface TriggerContext {
  definitionName: string;
  definitionVersion: string;
  configName: string;     // ProcessConfig name variant
  configVersion: string;  // ProcessConfig version
  triggerName: string;    // matches Trigger.name from ProcessDefinition
  triggeredBy: string;    // actor ID who fired the trigger
  payload: Record<string, unknown>;
}

/**
 * TriggerContext for the unified WorkflowDefinition model.
 * Does not require configName/configVersion — all config is embedded in the WorkflowDefinition.
 */
export interface WorkflowTriggerContext {
  definitionName: string;
  definitionVersion: number;  // WorkflowDefinition uses numeric versions
  triggerName: string;        // matches Trigger.name from WorkflowDefinition
  triggeredBy: string;        // actor ID who fired the trigger
  payload?: Record<string, unknown>;
  roles?: string[];           // override assignedRoles (falls back to definition.roles)
}

export interface TriggerResult {
  instanceId: string;
  status: 'created';
}
