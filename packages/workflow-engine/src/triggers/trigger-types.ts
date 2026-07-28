/**
 * TriggerContext for a versioned WorkflowDefinition.
 */
export interface WorkflowTriggerContext {
  namespace: string;          // tenant namespace — used for namespace-scoped doc ID lookups
  definitionName: string;
  definitionVersion: number;  // WorkflowDefinition uses numeric versions
  triggerName: string;        // matches the detached TriggerResource name
  triggeredBy: string;        // actor ID who fired the trigger
  payload?: Record<string, unknown>;
  parentInstanceId?: string;
  parentDefinitionName?: string;
  dryRun?: boolean;
}

export interface TriggerResult {
  instanceId: string;
  status: 'created';
}
