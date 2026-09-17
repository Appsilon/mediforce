/**
 * Workspace files cross Redis under their own short-lived keys, never inside a
 * job. BullMQ copies job data into the job hash and a job's return value into
 * both the hash and the `completed` event, and keeps those for as long as its
 * retention and the events stream (trimmed by entry count, not bytes) say — so
 * files carried there stay in Redis long after anyone needs them. The caller
 * deletes both keys as soon as the job settles; the TTL covers a caller that
 * never gets there.
 */
import { z } from 'zod';
import type { DockerJobData, DockerJobResult } from './schemas';
import { QUEUE_NAME } from './schemas';

const FilePayloadSchema = z.record(z.string(), z.string());

export interface FilePayloadRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

function filesKey(jobId: string, direction: 'input' | 'output'): string {
  return `${QUEUE_NAME}:files:${jobId}:${direction}`;
}

async function loadFiles(client: FilePayloadRedisClient, key: string): Promise<Record<string, string>> {
  const serialized = await client.get(key);
  if (serialized === null) {
    throw new Error(`File payload '${key}' is missing from Redis — it expired or was already consumed`);
  }
  return FilePayloadSchema.parse(JSON.parse(serialized));
}

/** Caller side, before enqueueing: move `inputFiles` out of the job data. */
export async function offloadInputFiles(
  client: FilePayloadRedisClient,
  jobId: string,
  data: DockerJobData,
  ttlSeconds: number,
): Promise<DockerJobData> {
  if (data.inputFiles === undefined || Object.keys(data.inputFiles).length === 0) return data;
  const { inputFiles, ...rest } = data;
  const key = filesKey(jobId, 'input');
  await client.set(key, JSON.stringify(inputFiles), { EX: ttlSeconds });
  return { ...rest, inputFilesKey: key };
}

/** Worker side, before processing: put `inputFiles` back into the job data. */
export async function restoreInputFiles(client: FilePayloadRedisClient, data: DockerJobData): Promise<DockerJobData> {
  if (data.inputFilesKey === undefined) return data;
  const { inputFilesKey, ...rest } = data;
  return { ...rest, inputFiles: await loadFiles(client, inputFilesKey) };
}

/** Worker side, before returning: move `outputFiles` out of the return value
 *  when the inputs came by key. A caller that sent files inline predates the
 *  keys and only knows how to read them inline. */
export async function offloadOutputFiles(
  client: FilePayloadRedisClient,
  jobId: string,
  data: DockerJobData,
  result: DockerJobResult,
  ttlSeconds: number,
): Promise<DockerJobResult> {
  if (data.inputFilesKey === undefined || result.outputFiles === undefined) return result;
  const { outputFiles, ...rest } = result;
  const key = filesKey(jobId, 'output');
  await client.set(key, JSON.stringify(outputFiles), { EX: ttlSeconds });
  return { ...rest, outputFilesKey: key };
}

/** Caller side, after the job completes: put `outputFiles` back into the result. */
export async function restoreOutputFiles(client: FilePayloadRedisClient, result: DockerJobResult): Promise<DockerJobResult> {
  if (result.outputFilesKey === undefined) return result;
  const { outputFilesKey, ...rest } = result;
  return { ...rest, outputFiles: await loadFiles(client, outputFilesKey) };
}

/** Caller side, once the job has settled either way. */
export async function deleteJobFiles(client: FilePayloadRedisClient, jobId: string): Promise<void> {
  await client.del(filesKey(jobId, 'input'), filesKey(jobId, 'output'));
}
