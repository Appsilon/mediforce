/**
 * Cross-backend domain errors that handlers and route adapters need to
 * branch on (status-code mapping, retry hints, etc.). Defined in
 * platform-core so every ProcessRepository implementation (Postgres,
 * in-memory test double) can throw the same nominal types.
 */

export class WorkflowDefinitionVersionAlreadyExistsError extends Error {
  constructor(name: string, version: number) {
    super(
      `Workflow definition "${name}" version "${version}" already exists and cannot be overwritten. ` +
        `Create a new version to change the definition.`,
    );
    this.name = 'WorkflowDefinitionVersionAlreadyExistsError';
  }
}

export class WorkflowDefinitionVersionNotFoundError extends Error {
  constructor(name: string, version: number) {
    super(`Workflow definition "${name}" version ${version} not found`);
    this.name = 'WorkflowDefinitionVersionNotFoundError';
  }
}

/**
 * A process-domain role grant was written for someone who is not a member of
 * the workspace (ADR-0019). Roles compose with Membership by AND, so such a
 * grant authorises nothing today — but it survives invisibly and silently
 * takes effect the day that person is added, which is the same failure the
 * membership cascade exists to prevent.
 *
 * Thrown by `setRolesForUser` itself rather than left to the caller's
 * pre-check: the check and the write have to be one atomic step, or a
 * concurrent removal lands between them.
 */
export class MemberNotInNamespaceError extends Error {
  constructor(uid: string, namespace: string) {
    super(`Member '${uid}' not in namespace '${namespace}'`);
    this.name = 'MemberNotInNamespaceError';
  }
}
