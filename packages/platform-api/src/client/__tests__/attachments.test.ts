import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce, ApiError } from '../index';
import { buildTaskAttachment } from '@mediforce/platform-core/testing';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TEST_BASE_URL = 'http://localhost';

describe('Mediforce attachments client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('tasks.attachments.list', () => {
    it('GETs the task attachments path and parses the envelope', async () => {
      const attachment = buildTaskAttachment({ taskId: 'task-1', name: 'report.pdf' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ attachments: [attachment] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.tasks.attachments.list({ taskId: 'task-1' });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].name).toBe('report.pdf');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/tasks/task-1/attachments`);
      expect(fetchSpy.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET');
    });

    it('URL-encodes the taskId path segment', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ attachments: [] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.tasks.attachments.list({ taskId: 'task 1/2' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/tasks/task%201%2F2/attachments`,
      );
    });

    it('throws ApiError on 404 with parsed body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.tasks.attachments
        .list({ taskId: 'task-1' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  describe('tasks.attachments.upload', () => {
    it('POSTs multipart FormData with a typed `file` part and parses the envelope', async () => {
      const attachment = buildTaskAttachment({
        taskId: 'task-1',
        name: 'report.pdf',
        contentType: 'application/pdf',
      });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ attachment }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.tasks.attachments.upload({
        taskId: 'task-1',
        name: 'report.pdf',
        contentType: 'application/pdf',
        content: new Uint8Array([1, 2, 3, 4]),
      });

      expect(result.attachment.name).toBe('report.pdf');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/tasks/task-1/attachments`);

      const init = fetchSpy.mock.calls[0]?.[1];
      expect(init?.method).toBe('POST');

      // Body is a FormData carrying a `file` Blob with the right name + type.
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      const file = form.get('file');
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe('report.pdf');
      expect((file as File).type).toBe('application/pdf');
      const bytes = new Uint8Array(await (file as File).arrayBuffer());
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);

      // No explicit Content-Type header — fetch fills in the multipart boundary.
      expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    });

    it('URL-encodes the taskId path segment', async () => {
      const attachment = buildTaskAttachment({ taskId: 'task 1/2', name: 'x.txt' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ attachment }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.tasks.attachments.upload({
        taskId: 'task 1/2',
        name: 'x.txt',
        contentType: 'text/plain',
        content: new Uint8Array([9]),
      });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/tasks/task%201%2F2/attachments`,
      );
    });

    it('throws ApiError on a typed 400 validation envelope', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(
          { error: { code: 'validation', message: 'Attachment too big' } },
          400,
        ),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = (await mediforce.tasks.attachments
        .upload({
          taskId: 'task-1',
          name: 'big.bin',
          contentType: 'application/octet-stream',
          content: new Uint8Array([1]),
        })
        .catch((e) => e)) as ApiError;

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(400);
      expect(err.code).toBe('validation');
    });
  });

  describe('tasks.attachments.delete', () => {
    it('DELETEs the attachment path and parses the entity envelope', async () => {
      const attachment = buildTaskAttachment({ deletedAt: '2026-01-01T00:00:00.000Z' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ attachment }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.tasks.attachments.delete({
        attachmentId: attachment.id,
      });

      expect(result.attachment.deletedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/attachments/${attachment.id}`,
      );
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('DELETE');
    });

    it('URL-encodes the attachmentId path segment', async () => {
      const attachment = buildTaskAttachment({ deletedAt: '2026-01-01T00:00:00.000Z' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ attachment }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.tasks.attachments.delete({ attachmentId: 'a b/c' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/attachments/a%20b%2Fc`);
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.tasks.attachments
        .delete({ attachmentId: 'a-1' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  describe('attachments.blobUrl', () => {
    it('builds the blob URL with the baseUrl prefix and URL-encoded id (no fetch)', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({
        apiKey: 'k',
        baseUrl: 'https://mediforce.example.com',
      });
      const url = mediforce.attachments.blobUrl('a b/c');

      expect(url).toBe('https://mediforce.example.com/api/attachments/a%20b%2Fc/blob');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('falls back to a relative URL when no baseUrl is configured', () => {
      // bearerToken auth path does not require a baseUrl — same-origin browser use.
      const mediforce = new Mediforce({ bearerToken: async () => 'tok' });
      const url = mediforce.attachments.blobUrl('a-1');

      expect(url).toBe('/api/attachments/a-1/blob');
    });
  });
});
