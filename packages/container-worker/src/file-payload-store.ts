/**
 * Bulk payloads cross Redis under their own short-lived keys, never inside a
 * job. BullMQ copies job data into the job hash and a job's return value into
 * both the hash and the `completed` event, and keeps those for as long as its
 * retention and the events stream (trimmed by entry count, not bytes) say — so
 * anything carried there stays in Redis long after anyone needs it. That is
 * workspace files, and it is equally an agent's prompt or its stdout, which
 * routinely run to megabytes. The caller deletes every key as soon as the job
 * settles; the TTL covers a caller that never gets there.
 */
import { z } from 'zod';
import type { DockerJobData, DockerJobResult } from './schemas';
import { QUEUE_NAME } from './schemas';

const FilePayloadSchema = z.record(z.string(), z.string());

/**
 * Text under this size stays in the job. Job hashes and `completed` events are
 * retained, so the bound is what one retained job may hold, not what Redis can
 * take: 10 completed jobs and 100 events against a 64 KiB ceiling is single-digit
 * megabytes however loud the container.
 */
export const TEXT_INLINE_MAX_BYTES = 64 * 1024;

export interface FilePayloadRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

type PayloadSlot = 'input' | 'output' | 'stdin' | 'stdout' | 'stderr';

const PAYLOAD_SLOTS: readonly PayloadSlot[] = ['input', 'output', 'stdin', 'stdout', 'stderr'];

function payloadKey(jobId: string, slot: PayloadSlot): string {
  return `${QUEUE_NAME}:files:${jobId}:${slot}`;
}

async function readPayload(client: FilePayloadRedisClient, key: string): Promise<string> {
  const serialized = await client.get(key);
  if (serialized === null) {
    throw new Error(`Payload '${key}' is missing from Redis — it expired or was already consumed`);
  }
  return serialized;
}

async function loadFiles(client: FilePayloadRedisClient, key: string): Promise<Record<string, string>> {
  return FilePayloadSchema.parse(JSON.parse(await readPayload(client, key)));
}

function isOversized(text: string): boolean {
  return Buffer.byteLength(text, 'utf-8') > TEXT_INLINE_MAX_BYTES;
}

/** Caller side, before enqueueing: move `inputFiles` and an oversized prompt
 *  out of the job data. */
export async function offloadJobPayload(
  client: FilePayloadRedisClient,
  jobId: string,
  data: DockerJobData,
  ttlSeconds: number,
): Promise<DockerJobData> {
  let offloaded = data;

  if (offloaded.inputFiles !== undefined && Object.keys(offloaded.inputFiles).length > 0) {
    const { inputFiles, ...rest } = offloaded;
    const key = payloadKey(jobId, 'input');
    await client.set(key, JSON.stringify(inputFiles), { EX: ttlSeconds });
    offloaded = { ...rest, inputFilesKey: key };
  }

  if (offloaded.stdinPayload !== null && isOversized(offloaded.stdinPayload)) {
    const key = payloadKey(jobId, 'stdin');
    await client.set(key, offloaded.stdinPayload, { EX: ttlSeconds });
    offloaded = { ...offloaded, stdinPayload: null, stdinPayloadKey: key };
  }

  return offloaded;
}

/** Worker side, before processing: put the offloaded parts back. */
export async function restoreJobPayload(client: FilePayloadRedisClient, data: DockerJobData): Promise<DockerJobData> {
  let restored = data;

  if (restored.inputFilesKey !== undefined) {
    const { inputFilesKey, ...rest } = restored;
    restored = { ...rest, inputFiles: await loadFiles(client, inputFilesKey) };
  }

  if (restored.stdinPayloadKey !== undefined) {
    const { stdinPayloadKey, ...rest } = restored;
    restored = { ...rest, stdinPayload: await readPayload(client, stdinPayloadKey) };
  }

  return restored;
}

/** Worker side, before returning: move `outputFiles` and oversized stdout /
 *  stderr out of the return value. A caller that predates a key only knows how
 *  to read that part inline, so each is gated on what the job says it sent. */
export async function offloadResultPayload(
  client: FilePayloadRedisClient,
  jobId: string,
  data: DockerJobData,
  result: DockerJobResult,
  ttlSeconds: number,
): Promise<DockerJobResult> {
  let offloaded = result;

  if (data.inputFilesKey !== undefined && offloaded.outputFiles !== undefined) {
    const { outputFiles, ...rest } = offloaded;
    const key = payloadKey(jobId, 'output');
    await client.set(key, JSON.stringify(outputFiles), { EX: ttlSeconds });
    offloaded = { ...rest, outputFilesKey: key };
  }

  if (data.payloadKeysSupported === true) {
    if (isOversized(offloaded.stdout)) {
      const key = payloadKey(jobId, 'stdout');
      await client.set(key, offloaded.stdout, { EX: ttlSeconds });
      offloaded = { ...offloaded, stdout: '', stdoutKey: key };
    }
    if (isOversized(offloaded.stderr)) {
      const key = payloadKey(jobId, 'stderr');
      await client.set(key, offloaded.stderr, { EX: ttlSeconds });
      offloaded = { ...offloaded, stderr: '', stderrKey: key };
    }
  }

  return offloaded;
}

/** Caller side, after the job completes: put the offloaded parts back. */
export async function restoreResultPayload(client: FilePayloadRedisClient, result: DockerJobResult): Promise<DockerJobResult> {
  let restored = result;

  if (restored.outputFilesKey !== undefined) {
    const { outputFilesKey, ...rest } = restored;
    restored = { ...rest, outputFiles: await loadFiles(client, outputFilesKey) };
  }

  if (restored.stdoutKey !== undefined) {
    const { stdoutKey, ...rest } = restored;
    restored = { ...rest, stdout: await readPayload(client, stdoutKey) };
  }

  if (restored.stderrKey !== undefined) {
    const { stderrKey, ...rest } = restored;
    restored = { ...rest, stderr: await readPayload(client, stderrKey) };
  }

  return restored;
}

/** Caller side, once the job has settled either way. */
export async function deleteJobPayloads(client: FilePayloadRedisClient, jobId: string): Promise<void> {
  await client.del(...PAYLOAD_SLOTS.map((slot) => payloadKey(jobId, slot)));
}
