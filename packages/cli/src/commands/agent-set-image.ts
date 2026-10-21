import { DEFAULT_AGENT_IMAGE } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const agentSetImageCommand = defineCommand({
  name: 'mediforce agent set-image',
  description: `Set the image an agent runs in. Pass an empty image to fall back to ${DEFAULT_AGENT_IMAGE}.`,
  args: {
    id: {
      type: 'positional',
      required: true,
      description: 'Agent definition ID',
    },
    image: {
      type: 'string',
      required: true,
      description: `Image tag, e.g. r-tools:2; empty for ${DEFAULT_AGENT_IMAGE}`,
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const image = args.image.trim();
    const result = await mediforce.agents.update({ id: args.id }, { image: image === '' ? null : image });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Agent ${args.id} now runs in ${image === '' ? DEFAULT_AGENT_IMAGE : image}`);
    }
    return 0;
  },
});
