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

/**
 * Firestore implementation of the ProcessRepository interface.
 * Uses composite keys ({name}:{version}) as document IDs.
 *
 * Enforces workflow definition version immutability: saving a version that already
 * exists throws WorkflowDefinitionVersionAlreadyExistsError rather than overwriting.
 */
export class FirestoreProcessRepository implements ProcessRepository {
  private readonly workflowDefinitionsCollection = 'workflowDefinitions';

  constructor(private readonly db: Firestore) {}

  async getWorkflowDefinition(
    name: string,
    version: number,
  ): Promise<WorkflowDefinition | null> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .doc(`${name}:${version}`)
      .get();

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
      .doc(`${definition.name}:${definition.version}`);

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

  async listWorkflowDefinitions(): Promise<WorkflowDefinitionListResult> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .get();

    const grouped = new Map<string, WorkflowDefinition[]>();

    for (const docSnap of snapshot.docs) {
      const raw = docSnap.data();
      const parsed = WorkflowDefinitionSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          `[process-repository] Invalid workflow definition document ${docSnap.id}:`,
          parsed.error.format(),
        );
        continue;
      }
      const definition = parsed.data;
      const existing = grouped.get(definition.name) ?? [];
      existing.push(definition);
      grouped.set(definition.name, existing);
    }

    const definitions = await Promise.all(
      Array.from(grouped.entries()).map(async ([name, versions]) => {
        const latestVersion = Math.max(...versions.map((v) => v.version));
        const defaultVersion = await this.getDefaultWorkflowVersion(name);
        return { name, versions, latestVersion, defaultVersion };
      }),
    );

    return { definitions };
  }

  async getDefaultWorkflowVersion(name: string): Promise<number | null> {
    try {
      const snapshot = await this.db.collection('workflowMeta').doc(name).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data();
      return typeof data?.defaultVersion === 'number' ? data.defaultVersion : null;
    } catch {
      return null;
    }
  }

  async setDefaultWorkflowVersion(name: string, version: number): Promise<void> {
    await this.db
      .collection('workflowMeta')
      .doc(name)
      .set({ defaultVersion: version }, { merge: true });
  }

  async getLatestWorkflowVersion(name: string): Promise<number> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .get();

    if (snapshot.empty) {
      return 0;
    }

    let latestVersion = 0;
    for (const docSnap of snapshot.docs) {
      const raw = docSnap.data();
      const parsed = WorkflowDefinitionSchema.safeParse(raw);
      if (parsed.success && parsed.data.version > latestVersion) {
        latestVersion = parsed.data.version;
      }
    }
    return latestVersion;
  }

  async getLatestWorkflowVersionInNamespace(
    name: string,
    namespace: string,
  ): Promise<number> {
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
      const raw = docSnap.data();
      const parsed = WorkflowDefinitionSchema.safeParse(raw);
      if (parsed.success && parsed.data.version > latestVersion) {
        latestVersion = parsed.data.version;
      }
    }
    return latestVersion;
  }

  async setProcessArchived(name: string, archived: boolean): Promise<void> {
    const workflowSnapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .get();
    for (const d of workflowSnapshot.docs) {
      await this.db
        .collection(this.workflowDefinitionsCollection)
        .doc(d.id)
        .update({ archived });
    }
  }

  async setWorkflowDeleted(name: string, deleted: boolean): Promise<void> {
    const workflowSnapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .get();
    for (const d of workflowSnapshot.docs) {
      await this.db
        .collection(this.workflowDefinitionsCollection)
        .doc(d.id)
        .update({ deleted });
    }

    const metaRef = this.db.collection('workflowMeta').doc(name);
    const metaSnap = await metaRef.get();
    if (metaSnap.exists) {
      await metaRef.update({ deleted });
    }
  }

  async isWorkflowNameDeleted(name: string): Promise<boolean> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .where('name', '==', name)
      .where('deleted', '==', true)
      .get();
    return !snapshot.empty;
  }

  async countInstancesByDefinitionName(name: string): Promise<number> {
    const snapshot = await this.db
      .collection('processInstances')
      .where('definitionName', '==', name)
      .get();
    return snapshot.size;
  }
}
