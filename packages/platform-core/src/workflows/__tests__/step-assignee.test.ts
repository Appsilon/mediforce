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
    // The live failure: "a data manager reviews the report" became a task
    // claimed by the literal id `data-manager`, which nobody holds — and with
    // no unclaim, no reassign and no owner override, the run was unfinishable.
    const directory = directoryWith({ uid: 'uid-dm', email: 'data-manager@company.com' });

    expect(await resolveStepAssignee('data-manager', directory))
      .toEqual({ userId: null, email: null, unresolved: 'data-manager' });
  });

  it('reports an address nobody holds as unresolved', async () => {
    expect((await resolveStepAssignee('ghost@company.com', directoryWith())).unresolved)
      .toBe('ghost@company.com');
  });

  it('resolves nothing when there is no directory to ask', async () => {
    // Nothing can confirm the value names a real user, so taking it verbatim
    // would rebuild the same unclaimable task in the one configuration that
    // cannot check.
    expect(await resolveStepAssignee('filip', undefined))
      .toEqual({ userId: null, email: null, unresolved: 'filip' });
  });
});
