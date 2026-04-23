import {
  ProcessInstanceSchema,
  StepExecutionSchema,
  type ProcessInstanceRepository,
  type ProcessInstance,
  type InstanceStatus,
  type StepExecution,
} from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Firestore implementation of the ProcessInstanceRepository interface.
 * Stores process instances in a `processInstances` collection and step executions
 * in a `stepExecutions` subcollection per instance document.
 */
export class FirestoreProcessInstanceRepository
  implements ProcessInstanceRepository
{
  private readonly collectionName = 'processInstances';
  private readonly stepExecutionsSubcollection = 'stepExecutions';

  constructor(private readonly db: Firestore) {}

  async create(instance: ProcessInstance): Promise<ProcessInstance> {
    await this.db.collection(this.collectionName).doc(instance.id).set(instance);
    return instance;
  }

  async getById(instanceId: string): Promise<ProcessInstance | null> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .doc(instanceId)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return ProcessInstanceSchema.parse(snapshot.data());
  }

  async update(
    instanceId: string,
    updates: Partial<ProcessInstance>,
  ): Promise<void> {
    await this.db.collection(this.collectionName).doc(instanceId).update({
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  async getByStatus(status: InstanceStatus): Promise<ProcessInstance[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('status', '==', status)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map((d) => ProcessInstanceSchema.parse(d.data()));
  }

  async getByDefinition(
    name: string,
    version: string,
  ): Promise<ProcessInstance[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('definitionName', '==', name)
      .where('definitionVersion', '==', version)
      .get();
    return snapshot.docs.map((d) => ProcessInstanceSchema.parse(d.data()));
  }

  async addStepExecution(
    instanceId: string,
    execution: StepExecution,
  ): Promise<StepExecution> {
    await this.db
      .collection(this.collectionName)
      .doc(instanceId)
      .collection(this.stepExecutionsSubcollection)
      .doc(execution.id)
      .set(execution);
    return execution;
  }

  async getStepExecutions(instanceId: string): Promise<StepExecution[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .doc(instanceId)
      .collection(this.stepExecutionsSubcollection)
      .orderBy('startedAt', 'asc')
      .get();
    return snapshot.docs.map((d) => StepExecutionSchema.parse(d.data()));
  }

  async updateStepExecution(
    instanceId: string,
    executionId: string,
    updates: Partial<StepExecution>,
  ): Promise<void> {
    await this.db
      .collection(this.collectionName)
      .doc(instanceId)
      .collection(this.stepExecutionsSubcollection)
      .doc(executionId)
      .update({ ...updates });
  }

  async getLatestStepExecution(
    instanceId: string,
    stepId: string,
  ): Promise<StepExecution | null> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .doc(instanceId)
      .collection(this.stepExecutionsSubcollection)
      .where('stepId', '==', stepId)
      .orderBy('startedAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return StepExecutionSchema.parse(snapshot.docs[0].data());
  }

  async getIdsByDefinitionName(name: string): Promise<string[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('definitionName', '==', name)
      .get();
    return snapshot.docs.map((d) => d.id);
  }

  async setDeletedByDefinitionName(name: string, deleted: boolean): Promise<void> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('definitionName', '==', name)
      .get();
    for (const d of snapshot.docs) {
      await this.db.collection(this.collectionName).doc(d.id).update({ deleted });
    }
  }
}
