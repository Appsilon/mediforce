export { listTasks, type ListTasksDeps } from './tasks/list-tasks.js';
export { getTask, type GetTaskDeps } from './tasks/get-task.js';

// Typed errors a handler may throw — re-exported here so the route adapter
// (the one place that imports `@mediforce/platform-api/handlers`) has a
// single import surface for both behaviour and error mapping.
export { HandlerError, NotFoundError } from '../errors.js';
