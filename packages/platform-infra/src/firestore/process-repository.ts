import {
  WorkflowDefinitionSchema,
  type ProcessRepository,
  type WorkflowDefinition,
  type WorkflowDefinitionListResult,
} from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Error thrown when attempting to save a workflow definition version
 * that already exists. Workflow definition versions are immutable in Firestore
 * to prevent stale references from running workflow instances.
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
 * Firestore implementation of the ProcessRepository interface.
 * Uses composite keys ({namespace}:{name}:{version}) as document IDs.
 *
 * Enforces workflow definition version immutability: saving a version that already
 * exists throws WorkflowDefinitionVersionAlreadyExistsError rather than overwriting.
 */
export class FirestoreProcessRepository implements ProcessRepository {
  private readonly workflowDefinitionsCollection = 'workflowDefinitions';

  constructor(private readonly db: Firestore) {}

  async getWorkflowDefinition(
    namespace: string,
    name: string,
    version: number,
  ): Promise<WorkflowDefinition | null> {
    let snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .doc(`${namespace}:${name}:${version}`)
      .get();

    // Fallback: pre-migration doc ID format ({name}:{version})
    if (!snapshot.exists) {
      snapshot = await this.db
        .collection(this.workflowDefinitionsCollection)
        .doc(`${name}:${version}`)
        .get();
    }

    if (!snapshot.exists) return null;

    const parsed = WorkflowDefinitionSchema.safeParse(snapshot.data());
    if (parsed.success) return parsed.data;

    console.warn(
      `[process-repository] workflowDefinitions parse failed for ${name}:${version}`,
      parsed.error.format(),
    );

    return null;
  }

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    const docRef = this.db
      .collection(this.workflowDefinitionsCollection)
      .doc(`${definition.namespace}:${definition.name}:${definition.version}`);

    const existing = await docRef.get();
    if (existing.exists) {
      throw new WorkflowDefinitionVersionAlreadyExistsError(
        definition.name,
        definition.version,
      );
    }

    const cleaned = JSON.parse(JSON.stringify(definition));
    await docRef.set(cleaned);
  }

  async listWorkflowDefinitions(
    includeArchived: boolean,
  ): Promise<WorkflowDefinitionListResult> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .get();

    const grouped = new Map<string, WorkflowDefinition[]>();

    for (const docSnap of snapshot.docs) {
      const raw = docSnap.data();
      // Filter archived BEFORE schema validation. Archived WDs are not
      // runnable; running them through safeParse only produces noise from
      // legacy data that no one intends to fix.
      if (!includeArchived && (raw as { archived?: unknown })?.archived === true) {
        continue;
      }
      const parsed = WorkflowDefinitionSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          `[process-repository] Invalid workflow definition document ${docSnap.id}:`,
          parsed.error.format(),
        );
        continue;
      }
      const definition = parsed.data;
      const groupKey = `${definition.namespace}:${definition.name}`;
      const existing = grouped.get(groupKey) ?? [];
      existing.push(definition);
      grouped.set(groupKey, existing);
    }

    const definitions = await Promise.all(
      Array.from(grouped.entries()).map(async ([_groupKey, versions]) => {
        const name = versions[0].name;
        const namespace = versions[0].namespace;
        const latestVersion = Math.max(...versions.map((v) => v.version));
        const defaultVersion = await this.getDefaultWorkflowVersion(name, namespace);
        return { name, versions, latestVersion, defaultVersion };
      }),
    );

    return { definitions };
  }

  async getDefaultWorkflowVersion(name: string, namespace: string): Promise<number | null> {
    try {
      let snapshot = await this.db.collection('workflowMeta').doc(`${namespace}:${name}`).get();
      // Fallback: pre-migration key
      if (!snapshot.exists) {
        snapshot = await this.db.collection('workflowMeta').doc(name).get();
      }
      if (!snapshot.exists) return null;
      const data = snapshot.data();
      return typeof data?.defaultVersion === 'number' ? data.defaultVersion : null;
    } catch {
      return null;
    }
  }

  async setDefaultWorkflowVersion(name: string, namespace: string, version: number): Promise<void> {
    await this.db
      .collection('workflowMeta')
      .doc(`${namespace}:${name}`)
      .set({ defaultVersion: version }, { merge: true });
  }

  async getLatestWorkflowVersion(name: string, namespace: string): Promise<number> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .where('namespace', '==', namespace)
      .get();

    if (snapshot.empty) {
      return 0;
    }

    let latestVersion = 0;
    for (const docSnap of snapshot.docs) {
      const rawVersion = docSnap.data().version;
      if (typeof rawVersion === 'number' && rawVersion > latestVersion) {
        latestVersion = rawVersion;
      }
    }
    return latestVersion;
  }

  async setProcessArchived(name: string, namespace: string, archived: boolean): Promise<void> {
    const workflowSnapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .where('namespace', '==', namespace)
      .get();
    for (const d of workflowSnapshot.docs) {
      await this.db
        .collection(this.workflowDefinitionsCollection)
        .doc(d.id)
        .update({ archived });
    }
  }

  async setVersionArchived(namespace: string, name: string, version: number, archived: boolean): Promise<void> {
    let docId = `${namespace}:${name}:${version}`;
    let docRef = this.db.collection(this.workflowDefinitionsCollection).doc(docId);
    let snap = await docRef.get();
    // Fallback: pre-migration doc ID format
    if (!snap.exists) {
      docId = `${name}:${version}`;
      docRef = this.db.collection(this.workflowDefinitionsCollection).doc(docId);
      snap = await docRef.get();
    }
    if (!snap.exists) {
      throw new WorkflowDefinitionVersionNotFoundError(name, version);
    }
    await docRef.update({ archived });
  }

  async setWorkflowVisibility(name: string, namespace: string, visibility: 'public' | 'private'): Promise<void> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .where('namespace', '==', namespace)
      .get();
    if (snapshot.empty) {
      throw new Error(`Workflow '${name}' not found`);
    }
    const batch = this.db.batch();
    for (const d of snapshot.docs) {
      batch.update(d.ref, { visibility });
    }
    await batch.commit();
  }

  async setWorkflowDeleted(name: string, namespace: string, deleted: boolean): Promise<void> {
    const workflowSnapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .where('namespace', '==', namespace)
      .get();
    for (const d of workflowSnapshot.docs) {
      await this.db
        .collection(this.workflowDefinitionsCollection)
        .doc(d.id)
        .update({ deleted });
    }

    const metaRef = this.db.collection('workflowMeta').doc(`${namespace}:${name}`);
    const metaSnap = await metaRef.get();
    if (metaSnap.exists) {
      await metaRef.update({ deleted });
    }
  }

  async isWorkflowNameDeleted(name: string, namespace: string): Promise<boolean> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .where('namespace', '==', namespace)
      .where('deleted', '==', true)
      .get();
    return !snapshot.empty;
  }

  async countInstancesByDefinitionName(name: string, namespace: string): Promise<number> {
    const snapshot = await this.db
      .collection('processInstances')
      .where('definitionName', '==', name)
      .where('namespace', '==', namespace)
      .get();
    return snapshot.size;
  }
}
