import type { AgentSkillRef } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printError, printJson } from '../output';

/** `namespace/id` names a Skill anywhere; a bare `id` is in the agent's own workspace. */
function parseSkillRefs(list: string, agentNamespace: string | undefined): AgentSkillRef[] | string {
  const refs: AgentSkillRef[] = [];
  for (const entry of list.split(',').map((item) => item.trim()).filter((item) => item !== '')) {
    const parts = entry.split('/');
    if (parts.length === 2 && parts[0] !== '' && parts[1] !== '') {
      refs.push({ namespace: parts[0]!, id: parts[1]! });
    } else if (parts.length === 1 && agentNamespace !== undefined) {
      refs.push({ namespace: agentNamespace, id: entry });
    } else {
      return parts.length === 1
        ? `'${entry}' needs a namespace: this agent has none, so write it as <namespace>/${entry}`
        : `'${entry}' is not a skill reference; use <namespace>/<id> or <id>`;
    }
  }
  return refs;
}

export const agentSetSkillsCommand = defineCommand({
  name: 'mediforce agent set-skills',
  description: "Replace the Skills an agent holds. Pass an empty list to remove them all.",
  args: {
    id: {
      type: 'positional',
      required: true,
      description: 'Agent definition ID',
    },
    skills: {
      type: 'string',
      required: true,
      description: "Comma-separated skills: <namespace>/<id>, or <id> for the agent's own workspace",
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const { agent } = await mediforce.agents.get({ id: args.id });
    const skills = parseSkillRefs(args.skills, agent.namespace);
    if (typeof skills === 'string') {
      printError(output, { error: skills }, jsonMode);
      return 2;
    }
    const result = await mediforce.agents.update({ id: args.id }, { skills });
    if (jsonMode) {
      printJson(output, result);
    } else if (skills.length === 0) {
      output.stdout(`Removed all skills from agent ${args.id}`);
    } else {
      output.stdout(`Agent ${args.id} now holds: ${skills.map((ref) => `${ref.namespace}/${ref.id}`).join(', ')}`);
    }
    return 0;
  },
});
