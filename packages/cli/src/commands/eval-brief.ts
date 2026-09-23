import { readFileSync } from 'node:fs';
import { defineCommand } from '../define-command';
import { printJson } from '../output';
import { STEP_ARGS, stepFrom } from './eval-step-args';

export const evalBriefGetCommand = defineCommand({
  name: 'mediforce eval brief-get',
  description: 'Print a step\'s Evaluation Brief — its context of use.',
  args: { ...STEP_ARGS },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getBrief(stepFrom(args));
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(result.brief === null ? 'No Evaluation Brief yet.' : `v${result.brief.version} (${result.brief.origin})\n\n${result.brief.text}`);
    return 0;
  },
});

export const evalBriefSetCommand = defineCommand({
  name: 'mediforce eval brief-set',
  description: 'Write a new version of a step\'s Evaluation Brief.',
  args: {
    ...STEP_ARGS,
    text: { type: 'string', description: 'The Brief text' },
    file: { type: 'string', description: 'Read the Brief text from a file' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const text = args.file !== undefined ? readFileSync(args.file, 'utf-8') : args.text;
    if (text === undefined) {
      output.stderr('Pass --text or --file');
      return 2;
    }
    const result = await mediforce.evaluation.setBrief({ ...stepFrom(args), text });
    if (jsonMode) printJson(output, result);
    else output.stdout(`Evaluation Brief v${result.brief.version} written`);
    return 0;
  },
});
