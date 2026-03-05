// @vitest-environment node
// Requires Firebase Emulator: pnpm exec firebase emulators:start --only firestore

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { beforeAll, afterAll, afterEach, describe, it } from 'vitest';

function isEmulatorRunning(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

let testEnv: RulesTestEnvironment;

const INSTANCE_ID = 'instance-001';
const INSTANCE_DATA = {
  id: INSTANCE_ID,
  definitionName: 'test-process',
  definitionVersion: '1.0',
  status: 'running',
  currentStepId: 'step-1',
  assignedRoles: ['reviewer'],
  createdBy: 'system',
  triggerType: 'manual',
  triggerPayload: {},
  variables: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  pauseReason: null,
  error: null,
};

const STEP_EXECUTION_DATA = {
  stepId: 'step-1',
  status: 'completed',
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:01:00Z',
};

const emulatorAvailable = await isEmulatorRunning('127.0.0.1', 8080);

describe.skipIf(!emulatorAvailable)('processInstances security rules', () => {

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mediforce-test',
    firestore: {
      rules: fs.readFileSync(
        new URL('../../../../firestore.rules', import.meta.url),
        'utf8',
      ),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}, 30_000);

afterAll(async () => {
  await testEnv?.cleanup();
});

afterEach(async () => {
  await testEnv?.clearFirestore();
});
  it('admin (custom claim role: admin) can read processInstance', async () => {
    // Seed the document without security rules
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('processInstances').doc(INSTANCE_ID).set(INSTANCE_DATA);
    });

    const adminCtx = testEnv.authenticatedContext('admin-user', { role: 'admin' });
    const db = adminCtx.firestore();
    await assertSucceeds(db.collection('processInstances').doc(INSTANCE_ID).get());
  });

  it('user with matching role in assignedRoles can read processInstance', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('processInstances').doc(INSTANCE_ID).set(INSTANCE_DATA);
    });

    // User with roles: ['reviewer'] — matches assignedRoles: ['reviewer']
    const reviewerCtx = testEnv.authenticatedContext('reviewer-user', {
      roles: ['reviewer'],
    });
    const db = reviewerCtx.firestore();
    await assertSucceeds(db.collection('processInstances').doc(INSTANCE_ID).get());
  });

  it('any authenticated user can read processInstance (role-scoped deferred to Phase 6)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('processInstances').doc(INSTANCE_ID).set(INSTANCE_DATA);
    });

    // User with roles: ['auditor'] — does NOT match assignedRoles, but rules
    // currently allow any authenticated read (role-scoped read deferred to Phase 6)
    const auditorCtx = testEnv.authenticatedContext('auditor-user', {
      roles: ['auditor'],
    });
    const db = auditorCtx.firestore();
    await assertSucceeds(db.collection('processInstances').doc(INSTANCE_ID).get());
  });

  it('unauthenticated user cannot read processInstance (PERMISSION_DENIED)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('processInstances').doc(INSTANCE_ID).set(INSTANCE_DATA);
    });

    const unauthedCtx = testEnv.unauthenticatedContext();
    const db = unauthedCtx.firestore();
    await assertFails(db.collection('processInstances').doc(INSTANCE_ID).get());
  });

  it('admin can read stepExecution subcollection', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('processInstances').doc(INSTANCE_ID).set(INSTANCE_DATA);
      await db
        .collection('processInstances')
        .doc(INSTANCE_ID)
        .collection('stepExecutions')
        .doc('exec-1')
        .set(STEP_EXECUTION_DATA);
    });

    const adminCtx = testEnv.authenticatedContext('admin-user', { role: 'admin' });
    const db = adminCtx.firestore();
    await assertSucceeds(
      db
        .collection('processInstances')
        .doc(INSTANCE_ID)
        .collection('stepExecutions')
        .doc('exec-1')
        .get(),
    );
  });

  it('user with matching role can read stepExecution subcollection', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('processInstances').doc(INSTANCE_ID).set(INSTANCE_DATA);
      await db
        .collection('processInstances')
        .doc(INSTANCE_ID)
        .collection('stepExecutions')
        .doc('exec-1')
        .set(STEP_EXECUTION_DATA);
    });

    // User with role: 'reviewer' — matches parent's assignedRoles: ['reviewer']
    const reviewerCtx = testEnv.authenticatedContext('reviewer-user', {
      role: 'reviewer',
    });
    const db = reviewerCtx.firestore();
    await assertSucceeds(
      db
        .collection('processInstances')
        .doc(INSTANCE_ID)
        .collection('stepExecutions')
        .doc('exec-1')
        .get(),
    );
  });

  it('any authenticated user can read stepExecution subcollection (role-scoped deferred to Phase 6)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('processInstances').doc(INSTANCE_ID).set(INSTANCE_DATA);
      await db
        .collection('processInstances')
        .doc(INSTANCE_ID)
        .collection('stepExecutions')
        .doc('exec-1')
        .set(STEP_EXECUTION_DATA);
    });

    // User with role: 'auditor' — does NOT match assignedRoles, but rules
    // currently allow any authenticated read (role-scoped read deferred to Phase 6)
    const auditorCtx = testEnv.authenticatedContext('auditor-user', {
      role: 'auditor',
    });
    const db = auditorCtx.firestore();
    await assertSucceeds(
      db
        .collection('processInstances')
        .doc(INSTANCE_ID)
        .collection('stepExecutions')
        .doc('exec-1')
        .get(),
    );
  });

  it('authenticated user can write to processInstances (platform-ui API routes use client SDK)', async () => {
    const authedCtx = testEnv.authenticatedContext('any-user', {
      role: 'admin',
      roles: ['admin', 'reviewer'],
    });
    const db = authedCtx.firestore();
    await assertSucceeds(
      db.collection('processInstances').doc('new-instance').set({
        ...INSTANCE_DATA,
        id: 'new-instance',
      }),
    );
  });
});
