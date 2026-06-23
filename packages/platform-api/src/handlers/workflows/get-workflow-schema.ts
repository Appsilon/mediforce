import { z } from 'zod';
import { WorkflowDefinitionBaseSchema } from '@mediforce/platform-core';
import type {
  GetWorkflowSchemaInput,
  GetWorkflowSchemaOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';

const WorkflowAuthorableSchema = WorkflowDefinitionBaseSchema.omit({
  namespace: true,
  version: true,
  createdAt: true,
});

export async function getWorkflowSchema(
  _input: GetWorkflowSchemaInput,
  _scope: CallerScope,
): Promise<GetWorkflowSchemaOutput> {
  const schema = z.toJSONSchema(WorkflowAuthorableSchema, { io: 'input' }) as Record<string, unknown>;
  return { schema };
}
