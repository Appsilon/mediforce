import { writeFile } from 'node:fs/promises';
import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const workflowSchemaCommand = defineCommand({
  name: 'mediforce workflow schema',
  description:
    'Fetch the live JSON Schema of the authorable WorkflowDefinition surface from the connected platform. Always reflects the schema currently in force server-side.',
  args: {
    output: { type: 'string', description: 'Write the schema to a file instead of stdout' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const { schema } = await mediforce.workflows.schema();

    if (typeof args.output === 'string' && args.output.length > 0) {
      await writeFile(args.output, `${JSON.stringify(schema, null, 2)}\n`, 'utf-8');
      output.stdout(`Written to ${args.output}`);
      return 0;
    }

    if (jsonMode) {
      printJson(output, schema);
    } else {
      output.stdout(JSON.stringify(schema, null, 2));
    }
    return 0;
  },
});
