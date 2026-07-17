// @vitest-environment node
//
// Route-level integration (true L3) for task attachments (ADR-0003 PR2).
//
// Runs under the `node` environment (not the suite-default jsdom): multipart
// `FormData` upload bodies are parsed by undici, which only accepts Node's
// native `File` — jsdom's `File`/`Blob` shims fail undici's `webidl.is.File`
// check. The other integration tests ride JSON, so they stay on jsdom.
//
// Drives the ACTUAL Next.js route handlers — `makePOST` (multipart upload),
// `makeGET` (binary blob stream + list), `makeDELETE` (soft-delete) — through
// the real `createRouteAdapter` / custom-route auth-scope pipeline, backed by a
// real `FilesystemBlobStore` on disk. The only stub is the caller resolution +
// scope build (the route factories' test seams), so no Firebase / env-gated
// services are pulled in, exactly like `api-integration.test.ts`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  InMemoryTaskAttachmentRepository,
  buildHumanTask,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { createTestScope, userCaller } from '@mediforce/platform-api/testing';
import { FilesystemBlobStore } from '@mediforce/platform-infra';
import { makeGET as makeListGET, makePOST } from '@/app/api/tasks/[taskId]/attachments/route';
import { makeGET as makeBlobGET } from '@/app/api/attachments/[id]/blob/route';
import { makeDELETE } from '@/app/api/attachments/[id]/route';

const WORKSPACE = 'ws-1';
const INSTANCE_ID = 'inst-attach-1';
const TASK_ID = 'task-attach-1';

const memberCaller = userCaller('uid-uploader', [WORKSPACE]);
const foreignCaller: CallerIdentity = userCaller('uid-outsider', ['ws-other']);

describe('attachments routes ↔ FilesystemBlobStore (route-level integration)', () => {
  let tmpRoot: string;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let attachmentRepo: InMemoryTaskAttachmentRepository;
  let blobStore: FilesystemBlobStore;
  let savedMaxBytes: string | undefined;

  function buildScopeFor(caller: CallerIdentity) {
    return createTestScope({
      caller,
      instanceRepo,
      humanTaskRepo,
      taskAttachmentRepo: attachmentRepo,
      blobStore,
    });
  }

  // Route factories wired to the per-test scope. `resolveCaller` / `buildScope`
  // are the exact seams `createRouteAdapter` exposes; production binds the real
  // Firebase + services defaults instead.
  function uploadRoute(caller: CallerIdentity = memberCaller) {
    return makePOST({
      resolveCaller: async () => caller,
      buildScope: () => buildScopeFor(caller),
    });
  }
  function listRoute(caller: CallerIdentity = memberCaller) {
    return makeListGET({
      resolveCaller: async () => caller,
      buildScope: () => buildScopeFor(caller),
    });
  }
  function blobRoute(caller: CallerIdentity = memberCaller) {
    return makeBlobGET({
      resolveCaller: async () => caller,
      buildScope: () => buildScopeFor(caller),
    });
  }
  function deleteRoute(caller: CallerIdentity = memberCaller) {
    return makeDELETE({
      resolveCaller: async () => caller,
      buildScope: () => buildScopeFor(caller),
    });
  }

  async function uploadFile(
    name: string,
    contentType: string,
    bytes: Buffer,
    caller: CallerIdentity = memberCaller,
  ): Promise<NextResponse> {
    const form = new FormData();
    // Node's native `File` (undici-compatible) — not jsdom's shim; see the
    // `@vitest-environment node` pragma at the top of this file.
    form.append('file', new File([bytes], name, { type: contentType }));
    const req = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/attachments`, {
      method: 'POST',
      body: form,
    });
    return uploadRoute(caller)(req, { params: Promise.resolve({ taskId: TASK_ID }) });
  }

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mf-attach-'));
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    attachmentRepo = new InMemoryTaskAttachmentRepository();
    blobStore = new FilesystemBlobStore(tmpRoot);
    savedMaxBytes = process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
    delete process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;

    await instanceRepo.create(
      buildProcessInstance({ id: INSTANCE_ID, namespace: WORKSPACE }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: TASK_ID, processInstanceId: INSTANCE_ID }),
    );
  });

  afterEach(async () => {
    if (savedMaxBytes === undefined) delete process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
    else process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES = savedMaxBytes;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('upload round-trip: 201, entity-echo, and bytes land on disk', async () => {
    const bytes = Buffer.from('id,grade\n1,5\n', 'utf-8');
    const res = await uploadFile('dataset.csv', 'text/csv', bytes);

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attachment: { id: string; name: string; sizeBytes: number; workspace: string; blobKey: string };
    };
    expect(body.attachment.name).toBe('dataset.csv');
    expect(body.attachment.sizeBytes).toBe(bytes.length);
    expect(body.attachment.workspace).toBe(WORKSPACE);

    // The real FilesystemBlobStore wrote the bytes — read them straight back.
    const stored = await blobStore.getStream(body.attachment.blobKey);
    expect(stored).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stored!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
  });

  it('blob download round-trip: 200, headers, byte-identical body', async () => {
    const bytes = Buffer.from('a'.repeat(4096), 'utf-8');
    const upload = await uploadFile('report.txt', 'text/plain', bytes);
    const { attachment } = (await upload.json()) as { attachment: { id: string } };

    const req = new NextRequest(`http://localhost/api/attachments/${attachment.id}/blob`);
    const res = await blobRoute()(req, { params: Promise.resolve({ id: attachment.id }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    expect(res.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(res.headers.get('Content-Disposition')).toContain('report.txt');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const received = Buffer.from(await res.arrayBuffer());
    expect(received.equals(bytes)).toBe(true);
  });

  it('list: includes the uploaded row', async () => {
    const upload = await uploadFile('x.txt', 'text/plain', Buffer.from('hi'));
    const { attachment } = (await upload.json()) as { attachment: { id: string } };

    const req = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/attachments`);
    const res = await listRoute()(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { attachments: Array<{ id: string }> };
    expect(body.attachments.map((a) => a.id)).toContain(attachment.id);
  });

  it('oversize: 4xx validation envelope and nothing persisted', async () => {
    process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES = '8';
    const bytes = Buffer.from('this is more than eight bytes', 'utf-8');

    const res = await uploadFile('big.bin', 'application/octet-stream', bytes);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation');

    // No metadata row written → no blob to read.
    const rows = await attachmentRepo.list(TASK_ID);
    expect(rows).toHaveLength(0);
  });

  it('unparseable body: 413 payload_too_large envelope, nothing persisted', async () => {
    // Next truncates request bodies over `proxyClientMaxBodySize` before the
    // route runs, which makes `req.formData()` throw. A multipart content-type
    // with no boundary reproduces that same parse failure deterministically.
    const req = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data' },
      body: 'truncated-multipart-body',
    });
    const res = await uploadRoute()(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('payload_too_large');

    const rows = await attachmentRepo.list(TASK_ID);
    expect(rows).toHaveLength(0);
  });

  it('foreign workspace: list / blob / delete all return 404 envelope', async () => {
    const upload = await uploadFile('secret.txt', 'text/plain', Buffer.from('classified'));
    const { attachment } = (await upload.json()) as { attachment: { id: string } };

    const listReq = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/attachments`);
    const listRes = await listRoute(foreignCaller)(listReq, {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    expect(listRes.status).toBe(404);

    const blobReq = new NextRequest(`http://localhost/api/attachments/${attachment.id}/blob`);
    const blobRes = await blobRoute(foreignCaller)(blobReq, {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(blobRes.status).toBe(404);

    const delReq = new NextRequest(`http://localhost/api/attachments/${attachment.id}`, {
      method: 'DELETE',
    });
    const delRes = await deleteRoute(foreignCaller)(delReq, {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(delRes.status).toBe(404);
  });

  it('delete soft: 200 entity with deletedAt, blob still on disk, blob GET → 404', async () => {
    const bytes = Buffer.from('to be soft-deleted', 'utf-8');
    const upload = await uploadFile('doomed.txt', 'text/plain', bytes);
    const { attachment } = (await upload.json()) as { attachment: { id: string; blobKey: string } };

    const delReq = new NextRequest(`http://localhost/api/attachments/${attachment.id}`, {
      method: 'DELETE',
    });
    const delRes = await deleteRoute()(delReq, { params: Promise.resolve({ id: attachment.id }) });

    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { attachment: { deletedAt: string | null } };
    expect(delBody.attachment.deletedAt).not.toBeNull();

    // Soft-delete keeps the blob — GC is a later sweep (ADR-0003 §7).
    const stored = await blobStore.getStream(attachment.blobKey);
    expect(stored).not.toBeNull();
    stored!.destroy();

    // But the blob route now 404s the soft-deleted row.
    const blobReq = new NextRequest(`http://localhost/api/attachments/${attachment.id}/blob`);
    const blobRes = await blobRoute()(blobReq, { params: Promise.resolve({ id: attachment.id }) });
    expect(blobRes.status).toBe(404);
  });
});
