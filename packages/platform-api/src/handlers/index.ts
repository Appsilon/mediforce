export { listTasks, type ListTasksDeps } from './tasks/list-tasks.js';
export { getTask, type GetTaskDeps } from './tasks/get-task.js';
export { claimTask, type ClaimTaskDeps } from './tasks/claim-task.js';
export {
  completeTask,
  type CompleteTaskDeps,
  type TriggerRun,
} from './tasks/complete-task.js';
export { resolveTask, type ResolveTaskDeps } from './tasks/resolve-task.js';
export { getProcess, type GetProcessDeps } from './processes/get-process.js';
export {
  listAuditEvents,
  type ListAuditEventsDeps,
} from './processes/list-audit-events.js';
export {
  getProcessSteps,
  type GetProcessStepsDeps,
} from './processes/get-process-steps.js';
export {
  listWorkflowDefinitions,
  type ListWorkflowDefinitionsDeps,
} from './definitions/list-workflow-definitions.js';
export {
  listAgentDefinitions,
  type ListAgentDefinitionsDeps,
} from './definitions/list-agent-definitions.js';
export {
  getAgentDefinition,
  type GetAgentDefinitionDeps,
} from './definitions/get-agent-definition.js';
export {
  getCoworkSession,
  type GetCoworkSessionDeps,
} from './cowork/get-cowork-session.js';
export {
  getCoworkSessionByInstance,
  type GetCoworkSessionByInstanceDeps,
} from './cowork/get-cowork-session-by-instance.js';
export {
  listProcessConfigs,
  type ListProcessConfigsDeps,
} from './configs/list-process-configs.js';
export {
  listPlugins,
  type ListPluginsDeps,
  type PluginRegistryView,
} from './plugins/list-plugins.js';

// Typed errors a handler may throw — re-exported here so the route adapter
// (the one place that imports `@mediforce/platform-api/handlers`) has a
// single import surface for both behaviour and error mapping.
export {
  HandlerError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../errors.js';
