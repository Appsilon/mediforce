import {
  WorkflowManifestSchema,
  parseWorkflowTemplate,
  githubRawBase,
  type WorkflowManifest,
} from '@mediforce/platform-core';
import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

export const workflowImportCommand = defineCommand({
  name: 'mediforce workflow import',
  description:
    'Import a workflow from a public GitHub repository. Without --workflow, lists what is available.',
  args: {
    repo: {
      type: 'string',
      required: true,
      description: 'GitHub repository URL (e.g. https://github.com/Appsilon/mediforce-workflows)',
    },
    namespace: {
      type: 'string',
      required: true,
      description: 'Namespace to import the workflow into',
    },
    workflow: {
      type: 'string',
      description: 'Workflow name as listed in the manifest (omit to list available)',
    },
    ref: {
      type: 'string',
      description: 'Branch or tag to import from (default: main)',
    },
  },
  skipClientWhen: (args) => args.workflow === undefined,
  async run({ args, output, mediforce, jsonMode }) {
    const ref = args.ref ?? 'main';
    const rawBase = githubRawBase(args.repo, ref);
    if (rawBase === null) {
      printError(output, { error: `Only GitHub URLs are supported. Got: ${args.repo}` }, jsonMode);
      return 1;
    }

    const manifestUrl = `${rawBase}/index.json`;
    let manifest: WorkflowManifest;
    try {
      const res = await fetch(manifestUrl);
      if (!res.ok) {
        printError(
          output,
          { error: `Failed to fetch manifest from ${manifestUrl}: HTTP ${String(res.status)}` },
          jsonMode,
        );
        return 1;
      }
      const raw: unknown = await res.json();
      const parsed = WorkflowManifestSchema.safeParse(raw);
      if (!parsed.success) {
        printError(output, { error: 'Invalid manifest format', body: parsed.error.issues }, jsonMode);
        return 1;
      }
      manifest = parsed.data;
    } catch (err) {
      printError(output, { error: `Failed to fetch manifest: ${String(err)}` }, jsonMode);
      return 1;
    }

    if (args.workflow === undefined) {
      if (jsonMode) {
        printJson(output, {
          workflows: manifest.workflows.map((w) => ({
            name: w.name,
            description: w.description,
            tags: w.tags,
          })),
        });
      } else {
        output.stdout(`Available workflows in ${args.repo}:`);
        for (const w of manifest.workflows) {
          output.stdout(`  ${w.name}${w.description !== undefined ? ` — ${w.description}` : ''}`);
        }
        output.stdout('\nUse --workflow <name> to import one.');
      }
      return 0;
    }

    const entry = manifest.workflows.find((w) => w.name === args.workflow);
    if (entry === undefined) {
      printError(
        output,
        {
          error: `Workflow "${args.workflow}" not found in manifest. Available: ${manifest.workflows.map((w) => w.name).join(', ')}`,
        },
        jsonMode,
      );
      return 1;
    }

    const fileUrl = `${rawBase}/${entry.path}`;
    let templateRaw: unknown;
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) {
        printError(
          output,
          { error: `Failed to fetch workflow from ${fileUrl}: HTTP ${String(res.status)}` },
          jsonMode,
        );
        return 1;
      }
      templateRaw = await res.json();
    } catch (err) {
      printError(output, { error: `Failed to fetch workflow file: ${String(err)}` }, jsonMode);
      return 1;
    }

    const parsed = parseWorkflowTemplate(templateRaw);
    if (!parsed.success) {
      printError(output, { error: 'Invalid workflow definition', body: parsed.error.issues }, jsonMode);
      return 1;
    }

    const body = {
      ...parsed.data,
      source: { repo: args.repo, path: entry.path },
    };

    const result = await mediforce!.workflows.register(body, { namespace: args.namespace });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Imported ${result.name} v${String(result.version)} into ${args.namespace}`);
    }
    return 0;
  },
});
