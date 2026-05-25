'use client';

import { formatDistanceToNow } from 'date-fns';
import { UserCircle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const MOCK_USERS = [
  {
    id: '1',
    name: 'Alice Chen',
    email: 'alice@pharma.com',
    lastSignIn: new Date(Date.now() - 12 * 60 * 1000),
    signIns: 47,
    workflowsTriggered: 12,
    actionsPerformed: 89,
    roles: ['workflow-manager', 'reviewer'],
  },
  {
    id: '2',
    name: 'Bob Müller',
    email: 'bob@pharma.com',
    lastSignIn: new Date(Date.now() - 2 * 60 * 60 * 1000),
    signIns: 23,
    workflowsTriggered: 5,
    actionsPerformed: 34,
    roles: ['reviewer'],
  },
  {
    id: '3',
    name: 'Carol Davis',
    email: 'carol@pharma.com',
    lastSignIn: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    signIns: 8,
    workflowsTriggered: 2,
    actionsPerformed: 11,
    roles: ['admin'],
  },
];

const MOCK_PERMISSIONS = [
  {
    name: 'workflow:run',
    description: 'Trigger a workflow run',
    usages: 17,
    roles: ['workflow-manager', 'admin'],
  },
  {
    name: 'workflow:cancel',
    description: 'Cancel a running workflow',
    usages: 3,
    roles: ['workflow-manager', 'admin'],
  },
  {
    name: 'task:review',
    description: 'Review and complete a human task',
    usages: 89,
    roles: ['reviewer', 'admin'],
  },
  {
    name: 'task:claim',
    description: 'Claim a task from the queue',
    usages: 34,
    roles: ['reviewer', 'admin'],
  },
  {
    name: 'agent:view',
    description: 'View agent runs and details',
    usages: 22,
    roles: ['workflow-manager', 'reviewer', 'admin'],
  },
  {
    name: 'settings:manage',
    description: 'Manage workspace settings',
    usages: 5,
    roles: ['admin'],
  },
];

const MOCK_SIGN_INS = [
  { user: 'Alice Chen', time: new Date(Date.now() - 12 * 60 * 1000), success: true },
  { user: 'Bob Müller', time: new Date(Date.now() - 2 * 60 * 60 * 1000), success: true },
  { user: 'Alice Chen', time: new Date(Date.now() - 5 * 60 * 60 * 1000), success: true },
  { user: 'Carol Davis', time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), success: true },
  { user: 'Unknown', time: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), success: false },
  { user: 'Bob Müller', time: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), success: true },
];

const ROLE_COLOR: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'workflow-manager': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  reviewer: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

export function UsersTab() {
  return (
    <div className="space-y-8">
      {/* User summary */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Users
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">User</th>
                <th className="px-4 py-2 text-left font-medium">Last sign-in</th>
                <th className="px-4 py-2 text-right font-medium">Sign-ins</th>
                <th className="px-4 py-2 text-right font-medium">Workflows triggered</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
                <th className="px-4 py-2 text-left font-medium">Roles</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {MOCK_USERS.map((user) => (
                <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                        <UserCircle className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDistanceToNow(user.lastSignIn, { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{user.signIns}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{user.workflowsTriggered}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{user.actionsPerformed}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <span
                          key={role}
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            ROLE_COLOR[role] ?? 'bg-muted text-muted-foreground',
                          )}
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sign-in history */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent sign-ins
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">User</th>
                <th className="px-4 py-2 text-left font-medium">When</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {MOCK_SIGN_INS.map((entry, i) => (
                <tr key={i} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{entry.user}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {formatDistanceToNow(entry.time, { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        entry.success
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                      )}
                    >
                      {entry.success ? 'success' : 'failed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Permissions */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Permissions &amp; usage
          </h2>
        </div>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Permission</th>
                <th className="px-4 py-2 text-left font-medium">Description</th>
                <th className="px-4 py-2 text-left font-medium">Granted to</th>
                <th className="px-4 py-2 text-right font-medium">Uses (all time)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {MOCK_PERMISSIONS.map((perm) => (
                <tr key={perm.name} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">{perm.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{perm.description}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {perm.roles.map((role) => (
                        <span
                          key={role}
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            ROLE_COLOR[role] ?? 'bg-muted text-muted-foreground',
                          )}
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {perm.usages}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
