import { getWorkflowAuthorableJsonSchema } from '@mediforce/platform-core';
import type {
  GetWorkflowSchemaInput,
  GetWorkflowSchemaOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';

export async function getWorkflowSchema(
  _input: GetWorkflowSchemaInput,
  _scope: CallerScope,
): Promise<GetWorkflowSchemaOutput> {
  return { schema: getWorkflowAuthorableJsonSchema() };
}
