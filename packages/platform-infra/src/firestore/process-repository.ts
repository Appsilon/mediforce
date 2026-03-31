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
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

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
 *
 * Receives a Firestore instance via constructor injection.
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
    const docRef = doc(
      this.db,
      this.definitionsCollection,
      this.compositeKey(name, version),
    );
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
      return null;
    }

    // Parse with schema to ensure type safety
    return ProcessDefinitionSchema.parse(snapshot.data());
  }

  async saveProcessDefinition(definition: ProcessDefinition): Promise<void> {
    const docRef = doc(
      this.db,
      this.definitionsCollection,
      this.compositeKey(definition.name, definition.version),
    );

    // Enforce definition version immutability: existing versions cannot be overwritten.
    // Running instances store a version reference; overwriting would corrupt their definition.
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      throw new DefinitionVersionAlreadyExistsError(
        definition.name,
        definition.version,
      );
    }

    await setDoc(docRef, definition);
  }

  async listProcessDefinitions(): Promise<DefinitionListResult> {
    const snapshot = await getDocs(
      collection(this.db, this.definitionsCollection),
    );
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
    const docRef = doc(
      this.db,
      this.configsCollection,
      configKey,
    );
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
      return null;
    }

    return snapshot.data() as ProcessConfig;
  }

  async saveProcessConfig(config: ProcessConfig): Promise<void> {
    const configKey = `${config.processName}:${config.configName}:${config.configVersion}`;
    const docRef = doc(
      this.db,
      this.configsCollection,
      configKey,
    );

    // Enforce config version immutability: existing versions cannot be overwritten.
    // Running instances store a config reference; overwriting would corrupt their config.
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      throw new ConfigVersionAlreadyExistsError(
        config.processName,
        config.configName,
        config.configVersion,
      );
    }

    await setDoc(docRef, config);
  }

  async listProcessConfigs(processName: string): Promise<ProcessConfig[]> {
    const q = query(
      collection(this.db, this.configsCollection),
      where('processName', '==', processName),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as ProcessConfig);
  }

  async setProcessArchived(name: string, archived: boolean): Promise<void> {
    // Update legacy processDefinitions
    const legacyQ = query(
      collection(this.db, this.definitionsCollection),
      where('name', '==', name),
    );
    const legacySnapshot = await getDocs(legacyQ);
    for (const d of legacySnapshot.docs) {
      await updateDoc(doc(this.db, this.definitionsCollection, d.id), { archived });
    }

    // Also update workflowDefinitions (dual-write)
    const workflowQ = query(
      collection(this.db, this.workflowDefinitionsCollection),
      where('name', '==', name),
    );
    const workflowSnapshot = await getDocs(workflowQ);
    for (const d of workflowSnapshot.docs) {
      await updateDoc(doc(this.db, this.workflowDefinitionsCollection, d.id), { archived });
    }
  }

  async setConfigArchived(
    processName: string,
    configName: string,
    configVersion: string,
    archived: boolean,
  ): Promise<void> {
    const configKey = `${processName}:${configName}:${configVersion}`;
    const docRef = doc(this.db, this.configsCollection, configKey);
    await updateDoc(docRef, { archived });
  }

  async setDefinitionVersionArchived(
    name: string,
    version: string,
    archived: boolean,
  ): Promise<void> {
    const docRef = doc(
      this.db,
      this.definitionsCollection,
      this.compositeKey(name, version),
    );
    await updateDoc(docRef, { archived });
  }

  async getWorkflowDefinition(
    name: string,
    version: number,
  ): Promise<WorkflowDefinition | null> {
    const docRef = doc(
      this.db,
      this.workflowDefinitionsCollection,
      `${name}:${version}`,
    );
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
      return null;
    }

    return WorkflowDefinitionSchema.parse(snapshot.data());
  }

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    const docRef = doc(
      this.db,
      this.workflowDefinitionsCollection,
      `${definition.name}:${definition.version}`,
    );

    const existing = await getDoc(docRef);
    if (existing.exists()) {
      throw new WorkflowDefinitionVersionAlreadyExistsError(
        definition.name,
        definition.version,
      );
    }

    // Firestore rejects undefined values — strip them before writing
    const cleaned = JSON.parse(JSON.stringify(definition));
    await setDoc(docRef, cleaned);
  }

  async listWorkflowDefinitions(): Promise<WorkflowDefinitionListResult> {
    const snapshot = await getDocs(
      collection(this.db, this.workflowDefinitionsCollection),
    );

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
        const publishedVersion = await this.getPublishedWorkflowVersion(name);
        return { name, versions, latestVersion, publishedVersion };
      }),
    );

    return { definitions };
  }

  async getPublishedWorkflowVersion(name: string): Promise<number | null> {
    try {
      const metaRef = doc(this.db, 'workflowMeta', name);
      const snapshot = await getDoc(metaRef);
      if (!snapshot?.exists()) return null;
      const data = snapshot.data();
      // Read publishedVersion first, fall back to legacy defaultVersion
      if (typeof data?.publishedVersion === 'number') return data.publishedVersion;
      if (typeof data?.defaultVersion === 'number') return data.defaultVersion;
      return null;
    } catch {
      return null;
    }
  }

  async setPublishedWorkflowVersion(name: string, version: number): Promise<void> {
    const metaRef = doc(this.db, 'workflowMeta', name);
    await setDoc(metaRef, { publishedVersion: version }, { merge: true });
  }

  async getLatestWorkflowVersion(name: string): Promise<number> {
    const q = query(
      collection(this.db, this.workflowDefinitionsCollection),
      where('name', '==', name),
    );
    const snapshot = await getDocs(q);

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
    // Update legacy processDefinitions
    const legacyQ = query(
      collection(this.db, this.definitionsCollection),
      where('name', '==', name),
    );
    const legacySnapshot = await getDocs(legacyQ);
    for (const d of legacySnapshot.docs) {
      await updateDoc(doc(this.db, this.definitionsCollection, d.id), { deleted });
    }

    // Update workflowDefinitions (dual-write)
    const workflowQ = query(
      collection(this.db, this.workflowDefinitionsCollection),
      where('name', '==', name),
    );
    const workflowSnapshot = await getDocs(workflowQ);
    for (const d of workflowSnapshot.docs) {
      await updateDoc(doc(this.db, this.workflowDefinitionsCollection, d.id), { deleted });
    }

    // Update workflowMeta
    const metaRef = doc(this.db, 'workflowMeta', name);
    const metaSnap = await getDoc(metaRef);
    if (metaSnap.exists()) {
      await updateDoc(metaRef, { deleted });
    }
  }

  async isWorkflowNameDeleted(name: string): Promise<boolean> {
    const q = query(
      collection(this.db, this.workflowDefinitionsCollection),
      where('name', '==', name),
      where('deleted', '==', true),
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  }

  async countInstancesByDefinitionName(name: string): Promise<number> {
    const q = query(
      collection(this.db, 'processInstances'),
      where('definitionName', '==', name),
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
  }
}
