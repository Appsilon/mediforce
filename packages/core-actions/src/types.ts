import type { ActionConfig, HttpActionConfig } from '@mediforce/platform-core';

/** Sources available to interpolation in action configs.
 *  - `triggerPayload` is the raw webhook body / cron tick / manual payload.
 *  - `steps` is the variables map keyed by previous stepId — read with dot
 *    notation (e.g. `${steps.fetch.body.id}`).
 *  - `variables` is the merged workflow scratch space (alias of `steps` today;
 *    reserved for explicit set/let in future).
 */
export interface InterpolationSources {
  triggerPayload: Record<string, unknown>;
  steps: Record<string, unknown>;
  variables: Record<string, unknown>;
}

/** Per-step context passed to every action handler. The runtime fills this
 *  out from the WorkflowStep + ProcessInstance before dispatch. */
export interface ActionContext {
  /** Step identifier, useful for log lines + error messages. */
  stepId: string;
  /** Process instance id — handlers may stash extra audit data via this. */
  processInstanceId: string;
  /** Sources for interpolation. The handler is free to walk these manually
   *  for advanced cases (path access into nested objects). */
  sources: InterpolationSources;
}

/** Output shape of any action handler. The handler returns a plain JSON
 *  object; the runtime persists it as the step's output and as the next
 *  step's input. */
export type ActionOutput = Record<string, unknown>;

/** Signature for an action handler. The handler reads its discriminated
 *  config from `action`, performs the side-effect (HTTP, wait, etc.) and
 *  returns the structured output. Throw on failure. */
export type ActionHandler<TConfig> = (
  config: TConfig,
  ctx: ActionContext,
) => Promise<ActionOutput>;

/** Narrowed handler types — used by the registry to dispatch by `kind`.
 *  Add new kinds here as more handlers are introduced. */
export type HttpActionHandler = ActionHandler<HttpActionConfig>;

export type AnyActionHandler = ActionHandler<unknown>;

/** Re-export the shared discriminated union so callers can type their
 *  config without reaching into platform-core directly. */
export type { ActionConfig };
