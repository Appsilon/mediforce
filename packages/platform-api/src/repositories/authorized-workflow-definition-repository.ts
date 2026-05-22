import type {
  ProcessRepository,
  WorkflowDefinition,
  WorkflowDefinitionGroup,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace + visibility-scoped view of `ProcessRepository`'s workflow-
 * definition surface. Routes to `listAllWorkflowDefinitions` for system
 * actors and `listWorkflowDefinitionsVisibleTo` for user callers — the
 * storage layer enforces the public-OR-allowed predicate.
 *
 * Out-of-scope reads return null (single) or are filtered out (list). The
 * handler turns null into 404 — so a non-member cannot distinguish "exists in
 * another workspace" from "doesn't exist".
 */
export class AuthorizedWorkflowDefinitionRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: ProcessRepository,
  ) {
    super(caller);
  }

  get = async (namespace: string, name: string, version: number): Promise<WorkflowDefinition | null> => {
    const def = await this.raw.getWorkflowDefinition(namespace, name, version);
    if (def === null) return null;
    if (this.caller.isSystemActor) return def;
    if (def.visibility === 'public') return def;
    return this.caller.namespaces.has(def.namespace) ? def : null;
  };

  getLatestVersion = async (namespace: string, name: string): Promise<number> =>
    this.raw.getLatestWorkflowVersion(namespace, name);

  listGroups = async (includeArchived: boolean): Promise<WorkflowDefinitionGroup[]> => {
    const { definitions } = this.caller.isSystemActor
      ? await this.raw.listAllWorkflowDefinitions(includeArchived)
      : await this.raw.listWorkflowDefinitionsVisibleTo(
          [...this.caller.namespaces],
          includeArchived,
        );
    return definitions;
  };

  save = async (definition: WorkflowDefinition): Promise<void> => {
    this.assertNamespaceWrite(definition.namespace);
    await this.raw.saveWorkflowDefinition(definition);
  };

  setArchived = async (namespace: string, name: string, archived: boolean): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setProcessArchived(name, namespace, archived);
  };

  setVersionArchived = async (
    namespace: string,
    name: string,
    version: number,
    archived: boolean,
  ): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setVersionArchived(namespace, name, version, archived);
  };
}
