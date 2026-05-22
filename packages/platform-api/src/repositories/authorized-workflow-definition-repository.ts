import type {
  ProcessRepository,
  WorkflowDefinition,
  WorkflowDefinitionGroup,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace + visibility-scoped view of `ProcessRepository`'s workflow-
 * definition surface. A user caller sees:
 *
 *   - any version of a definition owned by a workspace they're a member of,
 *   - the latest version of any `visibility: 'public'` definition.
 *
 * apiKey callers see everything.
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
    return def !== null && this.canSeeDefinition(def) ? def : null;
  };

  getLatestVersion = async (namespace: string, name: string): Promise<number> =>
    this.raw.getLatestWorkflowVersion(namespace, name);

  /** Group-level filter: returns groups whose latest visible version the
   *  caller may see. Drops groups where the latest version is invisible
   *  (private, foreign workspace) — same shape as the pre-migration listing. */
  listGroups = async (includeArchived: boolean): Promise<WorkflowDefinitionGroup[]> => {
    const { definitions } = await this.raw.listWorkflowDefinitions(includeArchived);
    if (this.caller.kind === 'apiKey') return definitions;
    return definitions.filter((group) => {
      const latest = group.versions.find((v) => v.version === group.latestVersion);
      return latest !== undefined && this.canSeeDefinition(latest);
    });
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

  private canSeeDefinition(def: WorkflowDefinition): boolean {
    if (this.caller.kind === 'apiKey') return true;
    if (def.visibility === 'public') return true;
    return this.caller.namespaces.has(def.namespace);
  }
}
