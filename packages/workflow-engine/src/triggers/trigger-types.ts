/**
 * One firing of a Trigger against a versioned WorkflowDefinition — everything
 * the engine needs to open the Run.
 *
 * Named `WorkflowFiring`, not `...TriggerContext`: **Trigger Context** is the
 * transport metadata a firing carries (`context` below), so reusing the word for
 * the whole argument bag would make `context.context` the shape of every call
 * site. See CONTEXT.md / ADR-0012.
 */
export interface WorkflowFiring {
  namespace: string;          // tenant namespace — used for namespace-scoped doc ID lookups
  definitionName: string;
  definitionVersion: number;  // WorkflowDefinition uses numeric versions
  triggerName: string;        // matches the detached TriggerResource name
  triggeredBy: string;        // actor ID who fired the trigger
  /** The **validated** input, conforming to the definition's `triggerInput`.
   *  Every trigger adapter validates before it gets here (ADR-0012). */
  payload?: Record<string, unknown>;
  /** Transport metadata of this firing — webhook `headers`/`query`/`method`/
   *  `path`, cron `firedAt`/`schedule`. Never carries declared input. */
  context?: Record<string, unknown>;
  parentInstanceId?: string;
  parentDefinitionName?: string;
  dryRun?: boolean;
}

export interface TriggerResult {
  instanceId: string;
  status: 'created';
}
