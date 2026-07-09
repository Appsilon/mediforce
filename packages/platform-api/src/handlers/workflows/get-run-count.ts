import type {
  GetWorkflowRunCountInput,
  GetWorkflowRunCountOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';

export async function getWorkflowRunCount(
  input: GetWorkflowRunCountInput,
  scope: CallerScope,
): Promise<GetWorkflowRunCountOutput> {
  const count = await scope.workflowDefinitions.countInstancesByName(input.namespace, input.name);
  return { count };
}
