import {
  ProcessDefinitionSchema,
  type ProcessRepository,
  type ProcessDefinition,
  type ProcessConfig,
  type DefinitionListResult,
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
        console.warn(
          `[process-repository] Invalid definition document ${docSnap.id}:`,
          parsed.error.format(),
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
    const q = query(
      collection(this.db, this.definitionsCollection),
      where('name', '==', name),
    );
    const snapshot = await getDocs(q);
    for (const d of snapshot.docs) {
      await updateDoc(doc(this.db, this.definitionsCollection, d.id), { archived });
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
}
