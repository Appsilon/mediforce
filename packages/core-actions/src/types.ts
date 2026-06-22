import type {
  ActionConfig,
  HttpActionConfig,
  ReshapeActionConfig,
  EmailActionConfig,
  SpawnActionConfig,
  WaitActionConfig,
  InterpolationSources,
} from '@mediforce/platform-core';

export type { InterpolationSources } from '@mediforce/platform-core';

/** Per-step context passed to every action handler. The runtime fills this
 *  out from the WorkflowStep + ProcessInstance before dispatch. */
export interface ActionContext {
  /** Step identifier, useful for log lines + error messages. */
  stepId: string;
  /** Process instance id — handlers may stash extra audit data via this. */
  processInstanceId: string;
  /** Namespace of the parent workflow instance. Used by spawn action. */
  namespace?: string;
  /** Definition name of the parent workflow instance. Used by spawn action. */
  definitionName?: string;
  /** When true, spawned children inherit dry-run mode from the parent. */
  dryRun?: boolean;
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
export type ActionHandler<TConfig> = (config: TConfig, ctx: ActionContext) => Promise<ActionOutput>;

/** Narrowed handler types — used by the registry to dispatch by `kind`.
 *  Add new kinds here as more handlers are introduced. */
export type HttpActionHandler = ActionHandler<HttpActionConfig>;
export type ReshapeActionHandler = ActionHandler<ReshapeActionConfig>;
export type EmailActionHandler = ActionHandler<EmailActionConfig>;
export type SpawnActionHandler = ActionHandler<SpawnActionConfig>;
export type WaitActionHandler = ActionHandler<WaitActionConfig>;

export type AnyActionHandler = ActionHandler<unknown>;

/** Re-export the shared discriminated union so callers can type their
 *  config without reaching into platform-core directly. */
export type { ActionConfig };
