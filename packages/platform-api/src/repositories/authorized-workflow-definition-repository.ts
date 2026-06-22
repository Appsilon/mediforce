import type { ProcessRepository, WorkflowDefinition, WorkflowDefinitionGroup } from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

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

  /**
   * Returns the latest version that this caller is allowed to see — mirrors
   * the visibility gate in `get()`. For foreign workspaces we cross-check
   * visibility against the actual latest definition, so a non-member cannot
   * enumerate private-WD names by probing the version number.
   */
  getLatestVersion = async (namespace: string, name: string): Promise<number> => {
    const version = await this.raw.getLatestWorkflowVersion(namespace, name);
    if (version === 0) return 0;
    if (this.caller.isSystemActor) return version;
    if (this.caller.namespaces.has(namespace)) return version;
    const def = await this.raw.getWorkflowDefinition(namespace, name, version);
    return def?.visibility === 'public' ? version : 0;
  };

  /**
   * Return every version of `name` in `namespace` the caller is allowed to
   * see. Mirrors the visibility gate in `get()`: members get every version;
   * non-members get versions only when the workflow is public. System actors
   * bypass. Returns an empty array when the workflow does not exist or the
   * caller cannot see any version — the handler maps empty to 404 so a
   * non-member cannot distinguish "exists privately elsewhere" from
   * "doesn't exist".
   */
  listVersions = async (namespace: string, name: string): Promise<WorkflowDefinition[]> => {
    const versions = await this.raw.listWorkflowVersions(namespace, name);
    if (versions.length === 0) return [];
    if (this.caller.isSystemActor) return versions;
    if (this.caller.namespaces.has(namespace)) return versions;
    // Foreign namespace: only public-latest workflows are listable. Probe
    // the latest version's visibility — matches `getLatestVersion` so the
    // surface is consistent.
    const latest = versions.reduce((acc, v) => (v.version > acc.version ? v : acc));
    return latest.visibility === 'public' ? versions : [];
  };

  listGroups = async (includeArchived: boolean): Promise<WorkflowDefinitionGroup[]> => {
    const { definitions } = this.caller.isSystemActor
      ? await this.raw.listAllWorkflowDefinitions(includeArchived)
      : await this.raw.listWorkflowDefinitionsVisibleTo([...this.caller.namespaces], includeArchived);
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

  setVersionArchived = async (namespace: string, name: string, version: number, archived: boolean): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setVersionArchived(namespace, name, version, archived);
  };

  setVisibility = async (namespace: string, name: string, visibility: 'public' | 'private'): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setWorkflowVisibility(name, namespace, visibility);
  };

  setDefaultVersion = async (namespace: string, name: string, version: number): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setDefaultWorkflowVersion(namespace, name, version);
  };

  getDefaultVersion = async (namespace: string, name: string): Promise<number | null> => {
    if (!this.canSeeNamespace(namespace)) return null;
    return this.raw.getDefaultWorkflowVersion(namespace, name);
  };

  isNameDeleted = async (namespace: string, name: string): Promise<boolean> => {
    if (!this.canSeeNamespace(namespace)) return false;
    return this.raw.isWorkflowNameDeleted(namespace, name);
  };

  countInstancesByName = async (namespace: string, name: string): Promise<number> => {
    if (!this.canSeeNamespace(namespace)) return 0;
    return this.raw.countInstancesByDefinitionName(namespace, name);
  };

  setDeleted = async (namespace: string, name: string, deleted: boolean): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setWorkflowDeleted(namespace, name, deleted);
  };

  /**
   * Transfer all versions of a workflow definition from `sourceNamespace` to
   * `targetNamespace`. Caller must be a member of BOTH workspaces, matching the
   * membership-only stance applied everywhere else.
   */
  transferNamespace = async (name: string, sourceNamespace: string, targetNamespace: string): Promise<void> => {
    this.assertNamespaceWrite(sourceNamespace);
    this.assertNamespaceWrite(targetNamespace);
    await this.raw.transferWorkflowNamespace(sourceNamespace, name, targetNamespace);
  };
}
