import Link from 'next/link';
import type { AgentDefinition } from '@mediforce/platform-core';
import { routes } from '@/lib/routes';
import type { SkillWorkflow } from '@/hooks/use-skills';

/** "Used by N agents: a, b · Used in M workflows", each agent linked; the
 *  workflows count includes those reaching the skill through an agent. Counts the agents the viewer
 *  can see; a delete refused over others says so itself. */
export function SkillHolders({ holders, workflows, handle }: {
  holders: AgentDefinition[];
  workflows: SkillWorkflow[];
  handle: string;
}) {
  return (
    <>
      Used by {holders.length} {holders.length === 1 ? 'agent' : 'agents'}
      {holders.length > 0 && ': '}
      {holders.map((agent, index) => (
        <span key={agent.id}>
          {index > 0 && ', '}
          <Link
            href={routes.agentDefinition(agent.namespace ?? handle, agent.id)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {agent.name}
          </Link>
        </span>
      ))}
      <span
        title={workflows.map((workflow) => workflow.title ?? workflow.name).join(', ')}
        data-testid="skill-workflows"
      >
        {' · '}Used in {workflows.length} {workflows.length === 1 ? 'workflow' : 'workflows'}
      </span>
    </>
  );
}
