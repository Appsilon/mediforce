import type { AgentPlugin, AgentContext, WorkflowAgentContext, EmitPayload } from '../interfaces/agent-plugin';
import type { AgentEventLog } from './agent-event-log';

export interface PluginRunResult {
  resultPayload: unknown | null;
  timedOut: boolean;
  errorMessage: string | null;
}

class PluginTimeoutError extends Error {
  override name = 'PluginTimeoutError';
  constructor() {
    super('Plugin execution timed out');
  }
}

export class PluginRunner {
  constructor(private readonly eventLog: AgentEventLog) {}

  async execute(
    plugin: AgentPlugin,
    context: AgentContext | WorkflowAgentContext,
    timeoutMs: number,
  ): Promise<PluginRunResult> {
    const { processInstanceId, stepId } = context;

    const emit = async (event: EmitPayload): Promise<void> => {
      await this.eventLog.write(processInstanceId, stepId, event);
    };

    await plugin.initialize(context);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new PluginTimeoutError()), timeoutMs);
    });

    try {
      await Promise.race([plugin.run(emit), timeoutPromise]);

      const events = this.eventLog.getEvents(processInstanceId, stepId);
      const resultEvent = [...events].reverse().find((e) => e.type === 'result');

      return {
        resultPayload: resultEvent?.payload ?? null,
        timedOut: false,
        errorMessage: null,
      };
    } catch (err) {
      if (err instanceof PluginTimeoutError) {
        return { resultPayload: null, timedOut: true, errorMessage: null };
      }
      return {
        resultPayload: null,
        timedOut: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
