'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import { useMonitoringData } from '@/hooks/use-monitoring';
import { useAgentRuns, useProcessNameMap } from '@/hooks/use-agent-runs';
import { UsersTab } from '@/components/monitoring/users-tab';
import { AgentsTab } from '@/components/monitoring/agents-tab';
import { WorkflowsTab } from '@/components/monitoring/workflows-tab';
import { TasksTab } from '@/components/monitoring/tasks-tab';
import { IntegrationsTab } from '@/components/monitoring/integrations-tab';

const TABS = [
  { value: 'agents', label: 'Agents' },
  { value: 'users', label: 'Users' },
  { value: 'workflows', label: 'Workflows' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'integrations', label: 'Integrations' },
] as const;

export default function MonitoringPage() {
  const { handle } = useParams<{ handle: string }>();
  const [activeTab, setActiveTab] = useState<string>('agents');
  const monitoringData = useMonitoringData(handle);
  const { data: agentRuns, loading: agentRunsLoading } = useAgentRuns(handle);
  const processNameMap = useProcessNameMap(handle);

  return (
    <div className="p-6 space-y-6">
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="flex gap-1 border-b">
          {TABS.map(({ value, label }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="mt-6">
          <Tabs.Content value="users">
            <UsersTab />
          </Tabs.Content>
          <Tabs.Content value="agents">
            <AgentsTab
              runs={agentRuns}
              loading={agentRunsLoading}
              processNameMap={processNameMap}
            />
          </Tabs.Content>
          <Tabs.Content value="workflows">
            <WorkflowsTab data={monitoringData} />
          </Tabs.Content>
          <Tabs.Content value="tasks">
            <TasksTab data={monitoringData} />
          </Tabs.Content>
          <Tabs.Content value="integrations">
            <IntegrationsTab />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}
