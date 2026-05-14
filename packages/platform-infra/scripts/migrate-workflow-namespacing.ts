import { pathToFileURL } from 'node:url';
import type { Firestore } from 'firebase-admin/firestore';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';
import { getAdminFirestore } from '../src/auth/firebase-admin-init.js';

interface MigrationOptions {
  dryRun: boolean;
}

interface MigrationResult {
  workflowDefinitionsRewritten: number;
  workflowMetaRewritten: number;
  skipped: number;
}

type FirestoreData = Record<string, unknown>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as FirestoreData;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function rewriteDocument(
  db: Firestore,
  collectionName: string,
  oldId: string,
  newId: string,
  data: FirestoreData,
  options: MigrationOptions,
): Promise<boolean> {
  if (oldId === newId) {
    console.log(`[workflow-namespacing] skip ${collectionName}/${oldId} already namespaced`);
    return false;
  }

  console.log(`[workflow-namespacing] rewrite ${collectionName}/${oldId} -> ${collectionName}/${newId}`);
  if (options.dryRun) return true;

  const collectionRef = db.collection(collectionName);
  const newRef = collectionRef.doc(newId);
  const existingSnap = await newRef.get();
  if (existingSnap.exists) {
    if (canonicalJson(existingSnap.data() ?? {}) !== canonicalJson(data)) {
      throw new Error(`Refusing to overwrite divergent ${collectionName}/${newId}`);
    }
    await collectionRef.doc(oldId).delete();
    return true;
  }

  await newRef.set(data);

  const verifySnap = await newRef.get();
  if (!verifySnap.exists || canonicalJson(verifySnap.data() ?? {}) !== canonicalJson(data)) {
    throw new Error(`Verification failed for ${collectionName}/${newId}`);
  }

  await collectionRef.doc(oldId).delete();
  return true;
}

async function migrateWorkflowDefinitions(
  db: Firestore,
  options: MigrationOptions,
): Promise<{ rewritten: number; skipped: number; namespacesByName: Map<string, Set<string>> }> {
  const snapshot = await db.collection('workflowDefinitions').get();
  const namespacesByName = new Map<string, Set<string>>();
  let rewritten = 0;
  let skipped = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as FirestoreData;
    const parsed = WorkflowDefinitionSchema.safeParse(data);
    if (!parsed.success) {
      console.log(`[workflow-namespacing] skip workflowDefinitions/${docSnap.id} invalid workflow definition`);
      skipped++;
      continue;
    }

    const namespaceSet = namespacesByName.get(parsed.data.name) ?? new Set<string>();
    namespaceSet.add(parsed.data.namespace);
    namespacesByName.set(parsed.data.name, namespaceSet);

    const newId = `${parsed.data.namespace}:${parsed.data.name}:${parsed.data.version}`;
    const didRewrite = await rewriteDocument(
      db,
      'workflowDefinitions',
      docSnap.id,
      newId,
      data,
      options,
    );
    if (didRewrite) rewritten++;
  }

  return { rewritten, skipped, namespacesByName };
}

async function migrateWorkflowMeta(
  db: Firestore,
  namespacesByName: Map<string, Set<string>>,
  options: MigrationOptions,
): Promise<{ rewritten: number; skipped: number }> {
  const snapshot = await db.collection('workflowMeta').get();
  let rewritten = 0;
  let skipped = 0;

  for (const docSnap of snapshot.docs) {
    if (docSnap.id.includes(':')) {
      console.log(`[workflow-namespacing] skip workflowMeta/${docSnap.id} already namespaced`);
      skipped++;
      continue;
    }

    const namespaces = namespacesByName.get(docSnap.id);
    if (!namespaces || namespaces.size === 0) {
      console.log(`[workflow-namespacing] skip workflowMeta/${docSnap.id} no workflowDefinitions namespace found`);
      skipped++;
      continue;
    }

    const data = docSnap.data() as FirestoreData;
    for (const namespace of namespaces) {
      const didRewrite = await rewriteDocument(
        db,
        'workflowMeta',
        docSnap.id,
        `${namespace}:${docSnap.id}`,
        data,
        options,
      );
      if (didRewrite) rewritten++;
    }
  }

  return { rewritten, skipped };
}

export async function migrateWorkflowNamespacing(
  db: Firestore,
  options: MigrationOptions = { dryRun: true },
): Promise<MigrationResult> {
  const definitionResult = await migrateWorkflowDefinitions(db, options);
  const metaResult = await migrateWorkflowMeta(db, definitionResult.namespacesByName, options);

  return {
    workflowDefinitionsRewritten: definitionResult.rewritten,
    workflowMetaRewritten: metaResult.rewritten,
    skipped: definitionResult.skipped + metaResult.skipped,
  };
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--write');
  const result = await migrateWorkflowNamespacing(getAdminFirestore(), { dryRun });
  console.log(
    `[workflow-namespacing] done dryRun=${String(dryRun)} ` +
      `workflowDefinitions=${result.workflowDefinitionsRewritten} ` +
      `workflowMeta=${result.workflowMetaRewritten} skipped=${result.skipped}`,
  );
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
