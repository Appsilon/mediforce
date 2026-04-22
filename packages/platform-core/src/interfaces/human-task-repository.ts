import type { HumanTask } from '../schemas/human-task.js';

export interface HumanTaskRepository {
  create(task: HumanTask): Promise<HumanTask>;
  getById(taskId: string): Promise<HumanTask | null>;
  getByRole(role: string): Promise<HumanTask[]>;             // every task with this assignedRole (all statuses — caller must filter via `ACTIONABLE_STATUSES` or explicit list if it wants the "actionable" subset)
  getByInstanceId(instanceId: string): Promise<HumanTask[]>;
  claim(taskId: string, userId: string): Promise<HumanTask>; // sets assignedUserId + status: 'claimed'
  complete(taskId: string, completionData: Record<string, unknown>): Promise<HumanTask>;
  cancel(taskId: string): Promise<HumanTask>;
  setDeletedByInstanceIds(instanceIds: string[], deleted: boolean): Promise<void>;
}
