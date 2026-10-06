import Link from 'next/link';
import type { AgentDefinition } from '@mediforce/platform-core';
import { routes } from '@/lib/routes';

/** "Used by N agents: a, b", each agent linked. Counts the agents the viewer
 *  can see; a delete refused over others says so itself. */
export function SkillHolders({ holders, handle }: { holders: AgentDefinition[]; handle: string }) {
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
    </>
  );
}
