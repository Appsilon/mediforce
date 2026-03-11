/**
 * Seed a file-upload task via Firestore REST API.
 * Usage: node scripts/seed-upload-task.cjs
 *
 * Uses the Firebase API key from platform-ui .env.local (no service account needed).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// Read API key from .env.local
const envPath = path.join(__dirname, '../packages/platform-ui/.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const projectId = envContent.match(/NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.+)/)?.[1]?.trim();

if (!projectId) {
  console.error('Could not read project ID from .env.local');
  process.exit(1);
}

const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = firestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function toFirestoreDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = firestoreValue(v);
  }
  return { fields };
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // First, list existing humanTasks to find a user ID
  console.log('Querying existing tasks to find your user ID...');

  const listUrl = `${baseUrl}/humanTasks?pageSize=10`;
  const listResult = await request('GET', listUrl);

  let userId = null;
  if (listResult.documents) {
    for (const doc of listResult.documents) {
      const assignedUserId = doc.fields?.assignedUserId;
      if (assignedUserId?.stringValue) {
        userId = assignedUserId.stringValue;
        break;
      }
    }
  }

  if (!userId) {
    console.error('No assigned user found in existing tasks.');
    console.error('Please pass your Firebase UID: node scripts/seed-upload-task.cjs YOUR_UID');
    const argUid = process.argv[2];
    if (argUid) {
      userId = argUid;
    } else {
      process.exit(1);
    }
  }

  console.log(`Using user ID: ${userId}`);

  const now = new Date().toISOString();
  const nextWeek = new Date(Date.now() + 7 * 86400_000).toISOString();

  // Create process instance
  const procId = 'proc-upload-test-1';
  const procDoc = toFirestoreDoc({
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

  const procUrl = `${baseUrl}/processInstances?documentId=${procId}`;
  try {
    await request('PATCH', `${baseUrl}/processInstances/${procId}`, procDoc);
    console.log(`Created/updated process instance: ${procId}`);
  } catch {
    await request('POST', procUrl, procDoc);
    console.log(`Created process instance: ${procId}`);
  }

  // Create upload task
  const taskId = 'task-upload-test-1';
  const taskDoc = toFirestoreDoc({
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

  try {
    await request('PATCH', `${baseUrl}/humanTasks/${taskId}`, taskDoc);
    console.log(`Created/updated upload task: ${taskId}`);
  } catch {
    const taskUrl = `${baseUrl}/humanTasks?documentId=${taskId}`;
    await request('POST', taskUrl, taskDoc);
    console.log(`Created upload task: ${taskId}`);
  }

  console.log(`\nDone! Task claimed by ${userId}. Refresh /tasks in your browser.`);
}

main().catch(console.error);
