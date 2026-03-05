import type { AgentRun } from '../schemas/agent-run.js';

export interface AgentRunRepository {
  create(run: AgentRun): Promise<AgentRun>;
  getById(runId: string): Promise<AgentRun | null>;
  getByInstanceId(instanceId: string): Promise<AgentRun[]>;
  getAll(limitN?: number): Promise<AgentRun[]>;
}
