import { describe, it, expect } from 'vitest';
import { resolveStepAssignee } from '../step-assignee';
import { InMemoryUserDirectoryService } from '../../testing/in-memory-user-directory-service';

function directoryWith(...users: { uid: string; email: string }[]): InMemoryUserDirectoryService {
  const directory = new InMemoryUserDirectoryService();
  for (const user of users) directory.addUser(user);
  return directory;
}

describe('resolveStepAssignee', () => {
  it('resolves an email to the uid the task queues match on', async () => {
    const directory = directoryWith({ uid: 'uid-dm', email: 'data-manager@company.com' });

    expect(await resolveStepAssignee('data-manager@company.com', directory))
      .toEqual({ userId: 'uid-dm', email: 'data-manager@company.com', unresolved: null });
  });

  it('resolves a uid, since a uid is what the directory is asked for too', async () => {
    const directory = directoryWith({ uid: 'filip', email: 'filip@appsilon.com' });

    expect((await resolveStepAssignee('filip', directory)).userId).toBe('filip');
  });

  it('reports a job title as unresolved rather than making it the assignee', async () => {
    const directory = directoryWith({ uid: 'uid-dm', email: 'data-manager@company.com' });

    expect(await resolveStepAssignee('data-manager', directory))
      .toEqual({ userId: null, email: null, unresolved: 'data-manager' });
  });

  it('reports an address nobody holds as unresolved', async () => {
    expect((await resolveStepAssignee('ghost@company.com', directoryWith())).unresolved)
      .toBe('ghost@company.com');
  });

  it('resolves nothing when there is no directory to ask', async () => {
    expect(await resolveStepAssignee('filip', undefined))
      .toEqual({ userId: null, email: null, unresolved: 'filip' });
  });
});
