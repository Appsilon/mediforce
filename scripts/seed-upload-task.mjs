/**
 * One-off script to seed a file-upload task into Firestore.
 * Usage: node scripts/seed-upload-task.mjs
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or gcloud auth application-default login
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('../packages/platform-infra/node_modules/firebase-admin');
const { initializeApp, applicationDefault } = admin.app ? admin : admin;
const { getFirestore } = admin.firestore ? admin : admin;

initializeApp({
  credential: applicationDefault(),
  projectId: 'mediforce-1c761',
});

const db = getFirestore();
const now = new Date().toISOString();
const nextWeek = new Date(Date.now() + 7 * 86400_000).toISOString();

// First, find a user ID from existing tasks
const tasksSnap = await db.collection('humanTasks').limit(5).get();
let userId = null;
for (const doc of tasksSnap.docs) {
  const data = doc.data();
  if (data.assignedUserId) {
    userId = data.assignedUserId;
    break;
  }
}

if (!userId) {
  console.error('Could not find any assigned user in existing tasks. Please provide your user ID.');
  process.exit(1);
}

console.log(`Found user ID: ${userId}`);

// Create process instance
const procId = 'proc-upload-test-1';
await db.collection('processInstances').doc(procId).set({
  id: procId,
  definitionName: 'Protocol to TFL',
  definitionVersion: '0.1.0',
  configName: 'default',
  configVersion: '1',
  status: 'paused',
  currentStepId: 'upload-documents',
  variables: {},
  triggerType: 'manual',
  triggerPayload: {},
  createdAt: now,
  updatedAt: now,
  createdBy: userId,
  pauseReason: 'waiting_for_human',
  error: null,
  assignedRoles: ['operator'],
});
console.log(`Created process instance: ${procId}`);

// Create upload task (claimed by user, with ui config)
const taskId = 'task-upload-test-1';
await db.collection('humanTasks').doc(taskId).set({
  id: taskId,
  processInstanceId: procId,
  stepId: 'upload-documents',
  assignedRole: 'operator',
  assignedUserId: userId,
  status: 'claimed',
  deadline: nextWeek,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  completionData: null,
  ui: {
    component: 'file-upload',
    config: {
      acceptedTypes: ['application/pdf'],
      minFiles: 1,
      maxFiles: 5,
    },
  },
});
console.log(`Created upload task: ${taskId} (claimed by ${userId})`);
console.log('\nDone! Refresh /tasks in your browser to see "Upload Documents" task.');
