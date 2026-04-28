import {
  ProcessDefinitionSchema,
  WorkflowDefinitionSchema,
  type ProcessRepository,
  type ProcessDefinition,
  type ProcessConfig,
  type DefinitionListResult,
  type WorkflowDefinition,
  type WorkflowDefinitionListResult,
} from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Error thrown when attempting to save a process definition version
 * that already exists. Definition versions are immutable in Firestore
 * to prevent stale references from running process instances.
 */
export class DefinitionVersionAlreadyExistsError extends Error {
  constructor(name: string, version: string) {
    super(
      `Process definition "${name}" version "${version}" already exists and cannot be overwritten. ` +
        `Create a new version to change the definition.`,
    );
    this.name = 'DefinitionVersionAlreadyExistsError';
  }
}

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
 * Error thrown when attempting to save a process config version
 * that already exists. Config versions are immutable in Firestore
 * to prevent stale references from running process instances.
 */
export class ConfigVersionAlreadyExistsError extends Error {
  constructor(processName: string, configName: string, configVersion: string) {
    super(
      `Process config "${processName}" config "${configName}" version "${configVersion}" already exists and cannot be overwritten. ` +
        `Create a new version to change the config.`,
    );
    this.name = 'ConfigVersionAlreadyExistsError';
  }
}

/**
 * Firestore implementation of the ProcessRepository interface.
 * Uses composite keys ({name}:{version}) as document IDs.
 *
 * Enforces definition and config version immutability: saving a version that already
 * exists throws DefinitionVersionAlreadyExistsError / ConfigVersionAlreadyExistsError
 * rather than overwriting.
 */
export class FirestoreProcessRepository implements ProcessRepository {
  private readonly definitionsCollection = 'processDefinitions';
  private readonly configsCollection = 'processConfigs';
  private readonly workflowDefinitionsCollection = 'workflowDefinitions';

  constructor(private readonly db: Firestore) {}

  private compositeKey(name: string, version: string): string {
    return `${name}:${version}`;
  }

  async getProcessDefinition(
    name: string,
    version: string,
  ): Promise<ProcessDefinition | null> {
    const snapshot = await this.db
      .collection(this.definitionsCollection)
      .doc(this.compositeKey(name, version))
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return ProcessDefinitionSchema.parse(snapshot.data());
  }

  async saveProcessDefinition(definition: ProcessDefinition): Promise<void> {
    const docRef = this.db
      .collection(this.definitionsCollection)
      .doc(this.compositeKey(definition.name, definition.version));

    const existing = await docRef.get();
    if (existing.exists) {
      throw new DefinitionVersionAlreadyExistsError(
        definition.name,
        definition.version,
      );
    }

    await docRef.set(definition);
  }

  async listProcessDefinitions(): Promise<DefinitionListResult> {
    const snapshot = await this.db.collection(this.definitionsCollection).get();
    const result: DefinitionListResult = { valid: [], invalid: [] };
    for (const docSnap of snapshot.docs) {
      const raw = docSnap.data();
      const parsed = ProcessDefinitionSchema.safeParse(raw);
      if (parsed.success) {
        result.valid.push(parsed.data);
      } else {
        console.debug(
          `[process-repository] Skipping invalid definition document ${docSnap.id}`,
        );
        result.invalid.push({ data: raw, error: parsed.error });
      }
    }
    return result;
  }

  async getProcessConfig(
    processName: string,
    configName: string,
    configVersion: string,
  ): Promise<ProcessConfig | null> {
    const configKey = `${processName}:${configName}:${configVersion}`;
    const snapshot = await this.db
      .collection(this.configsCollection)
      .doc(configKey)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as ProcessConfig;
  }

  async saveProcessConfig(config: ProcessConfig): Promise<void> {
    const configKey = `${config.processName}:${config.configName}:${config.configVersion}`;
    const docRef = this.db.collection(this.configsCollection).doc(configKey);

    const existing = await docRef.get();
    if (existing.exists) {
      throw new ConfigVersionAlreadyExistsError(
        config.processName,
        config.configName,
        config.configVersion,
      );
    }

    await docRef.set(config);
  }

  async listProcessConfigs(processName: string): Promise<ProcessConfig[]> {
    const snapshot = await this.db
      .collection(this.configsCollection)
      .where('processName', '==', processName)
      .get();
    return snapshot.docs.map((d) => d.data() as ProcessConfig);
  }

  async setProcessArchived(name: string, archived: boolean): Promise<void> {
    const legacySnapshot = await this.db
      .collection(this.definitionsCollection)
      .where('name', '==', name)
      .get();
    for (const d of legacySnapshot.docs) {
      await this.db
        .collection(this.definitionsCollection)
        .doc(d.id)
        .update({ archived });
    }

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

  async setConfigArchived(
    processName: string,
    configName: string,
    configVersion: string,
    archived: boolean,
  ): Promise<void> {
    const configKey = `${processName}:${configName}:${configVersion}`;
    await this.db.collection(this.configsCollection).doc(configKey).update({ archived });
  }

  async setDefinitionVersionArchived(
    name: string,
    version: string,
    archived: boolean,
  ): Promise<void> {
    await this.db
      .collection(this.definitionsCollection)
      .doc(this.compositeKey(name, version))
      .update({ archived });
  }

  async getWorkflowDefinition(
    name: string,
    version: number,
  ): Promise<WorkflowDefinition | null> {
    const snapshot = await this.db
      .collection(this.workflowDefinitionsCollection)
      .doc(`${name}:${version}`)
      .get();

    if (snapshot.exists) {
      const parsed = WorkflowDefinitionSchema.safeParse(snapshot.data());
      if (parsed.success) return parsed.data;
      console.warn(
        `[process-repository] workflowDefinitions parse failed for ${name}:${version}`,
        parsed.error.format(),
      );
    }

    const legacySnap = await this.db
      .collection(this.definitionsCollection)
      .where('name', '==', name)
      .get();
    for (const legacyDoc of legacySnap.docs) {
      const raw = legacyDoc.data();
      const rawVersion = raw.version;
      const normalizedVersion =
        typeof rawVersion === 'number'
          ? rawVersion
          : typeof rawVersion === 'string'
            ? parseInt(rawVersion, 10)
            : NaN;
      if (normalizedVersion !== version) continue;

      const wfParsed = WorkflowDefinitionSchema.safeParse({ ...raw, version });
      if (wfParsed.success) return wfParsed.data;
      console.warn(
        `[process-repository] legacy processDefinitions parse failed for ${name}:${version}`,
        wfParsed.error.format(),
      );
    }

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

  async setWorkflowDeleted(name: string, deleted: boolean): Promise<void> {
    const legacySnapshot = await this.db
      .collection(this.definitionsCollection)
      .where('name', '==', name)
      .get();
    for (const d of legacySnapshot.docs) {
      await this.db
        .collection(this.definitionsCollection)
        .doc(d.id)
        .update({ deleted });
    }

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
