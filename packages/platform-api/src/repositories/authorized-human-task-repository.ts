import type {
  HumanTask,
  HumanTaskRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedRepository } from './authorized-repository.js';
import { filterByParentNamespace } from './indirect-namespace.js';

/**
 * Workspace-scoped view of `HumanTaskRepository`. Tasks have no namespace
 * field of their own — workspace membership is reached via the parent
 * `ProcessInstance` (the run the task belongs to). List paths batch-dedupe
 * parent lookups so we issue at most one read per distinct run regardless of
 * task count (same shape as PR #450's `listTasks` handler).
 */
export interface AuthorizedHumanTaskRepository {
  getById(taskId: string): Promise<HumanTask | null>;
  getByRole(role: string): Promise<HumanTask[]>;
  getByInstanceId(instanceId: string): Promise<HumanTask[]>;
  claim(taskId: string, userId: string): Promise<HumanTask>;
  complete(taskId: string, completionData: Record<string, unknown>): Promise<HumanTask>;
  cancel(taskId: string): Promise<HumanTask>;
}

export class AuthorizedHumanTaskRepositoryImpl
  extends AuthorizedRepository<HumanTask>
  implements AuthorizedHumanTaskRepository
{
  constructor(
    caller: CallerIdentity,
    private readonly raw: HumanTaskRepository,
    private readonly parents: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getById = async (taskId: string): Promise<HumanTask | null> => {
    const task = await this.raw.getById(taskId);
    if (task === null) return null;
    if (this.caller.kind === 'apiKey') return task;
    const parent = await this.parents.getById(task.processInstanceId);
    return this.canSeeNamespace(parent?.namespace) ? task : null;
  };

  getByRole = async (role: string): Promise<HumanTask[]> => {
    const tasks = await this.raw.getByRole(role);
    return filterByParentNamespace(tasks, this.caller, this.parents);
  };

  getByInstanceId = async (instanceId: string): Promise<HumanTask[]> => {
    const tasks = await this.raw.getByInstanceId(instanceId);
    if (this.caller.kind === 'apiKey') return tasks;
    if (tasks.length === 0) return [];
    const parent = await this.parents.getById(instanceId);
    return this.canSeeNamespace(parent?.namespace) ? tasks : [];
  };

  claim = async (taskId: string, userId: string): Promise<HumanTask> => {
    await this.assertCanMutate(taskId);
    return this.raw.claim(taskId, userId);
  };

  complete = async (taskId: string, completionData: Record<string, unknown>): Promise<HumanTask> => {
    await this.assertCanMutate(taskId);
    return this.raw.complete(taskId, completionData);
  };

  cancel = async (taskId: string): Promise<HumanTask> => {
    await this.assertCanMutate(taskId);
    return this.raw.cancel(taskId);
  };

  private async assertCanMutate(taskId: string): Promise<void> {
    const task = await this.getById(taskId);
    if (task === null) throw new ForbiddenError();
  }
}
