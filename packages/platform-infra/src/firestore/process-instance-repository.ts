import {
  ProcessInstanceSchema,
  StepExecutionSchema,
  type ProcessInstanceRepository,
  type ProcessInstance,
  type InstanceStatus,
  type StepExecution,
} from '@mediforce/platform-core';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  type Firestore,
} from 'firebase/firestore';

/**
 * Firestore implementation of the ProcessInstanceRepository interface.
 * Stores process instances in a `processInstances` collection and step executions
 * in a `stepExecutions` subcollection per instance document.
 *
 * Receives a Firestore instance via constructor injection.
 */
export class FirestoreProcessInstanceRepository
  implements ProcessInstanceRepository
{
  private readonly collectionName = 'processInstances';
  private readonly stepExecutionsSubcollection = 'stepExecutions';

  constructor(private readonly db: Firestore) {}

  async create(instance: ProcessInstance): Promise<ProcessInstance> {
    const docRef = doc(this.db, this.collectionName, instance.id);
    await setDoc(docRef, instance);
    return instance;
  }

  async getById(instanceId: string): Promise<ProcessInstance | null> {
    const docRef = doc(this.db, this.collectionName, instanceId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
      return null;
    }

    return ProcessInstanceSchema.parse(snapshot.data());
  }

  async update(
    instanceId: string,
    updates: Partial<ProcessInstance>,
  ): Promise<void> {
    const docRef = doc(this.db, this.collectionName, instanceId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  async getByStatus(status: InstanceStatus): Promise<ProcessInstance[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('status', '==', status),
      orderBy('createdAt', 'desc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ProcessInstanceSchema.parse(d.data()));
  }

  async getByDefinition(
    name: string,
    version: string,
  ): Promise<ProcessInstance[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('definitionName', '==', name),
      where('definitionVersion', '==', version),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ProcessInstanceSchema.parse(d.data()));
  }

  async addStepExecution(
    instanceId: string,
    execution: StepExecution,
  ): Promise<StepExecution> {
    const subcollectionRef = collection(
      doc(this.db, this.collectionName, instanceId),
      this.stepExecutionsSubcollection,
    );
    await setDoc(doc(subcollectionRef, execution.id), execution);
    return execution;
  }

  async getStepExecutions(instanceId: string): Promise<StepExecution[]> {
    const subcollectionRef = collection(
      doc(this.db, this.collectionName, instanceId),
      this.stepExecutionsSubcollection,
    );
    const q = query(subcollectionRef, orderBy('startedAt', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => StepExecutionSchema.parse(d.data()));
  }

  async updateStepExecution(
    instanceId: string,
    executionId: string,
    updates: Partial<StepExecution>,
  ): Promise<void> {
    const docRef = doc(
      this.db,
      this.collectionName,
      instanceId,
      this.stepExecutionsSubcollection,
      executionId,
    );
    await updateDoc(docRef, { ...updates });
  }

  async getLatestStepExecution(
    instanceId: string,
    stepId: string,
  ): Promise<StepExecution | null> {
    const subcollectionRef = collection(
      doc(this.db, this.collectionName, instanceId),
      this.stepExecutionsSubcollection,
    );
    const q = query(
      subcollectionRef,
      where('stepId', '==', stepId),
      orderBy('startedAt', 'desc'),
      firestoreLimit(1),
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    return StepExecutionSchema.parse(snapshot.docs[0].data());
  }
}
