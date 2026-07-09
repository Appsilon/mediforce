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
