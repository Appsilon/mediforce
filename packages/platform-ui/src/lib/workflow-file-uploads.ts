import {
  WorkflowArtifactSchema,
  WORKFLOW_ARTIFACT_MAX_BYTES,
  WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES,
  type WorkflowArtifact,
} from '@mediforce/platform-core';

/** What an upload was refused for, in words a person can act on. */
export interface RejectedUpload {
  path: string;
  reason: string;
}

const encoder = new TextEncoder();

function byteLength(artifact: WorkflowArtifact): number {
  return encoder.encode(artifact.path).length + encoder.encode(artifact.contents).length;
}

/**
 * Decode an uploaded file as text, or `null` when it is not text.
 *
 * A workflow carries text. A PNG, a wheel or a parquet file uploaded here would
 * be stored mangled and fail at run time, so it is refused at the door and the
 * person is pointed at an image or a repository instead. A stray NUL byte is
 * treated the same way: it decodes, but it is not a file anyone typed.
 */
export function decodeTextFile(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

/**
 * The artifact path an uploaded file lands at. A folder upload carries its
 * structure in `webkitRelativePath`, which has to survive — a `skills/`
 * directory uploaded flat leaves an agent's `skillsDir` pointing at nothing.
 * The picker prefixes the chosen folder's own name, so that one leading segment
 * is dropped: keeping it would bury every file a level deeper than intended.
 */
export function uploadPathFor(
  file: { name: string; webkitRelativePath?: string },
  droppedFolderName?: string,
): string {
  const relative = file.webkitRelativePath;
  if (relative === undefined || relative === '') return file.name;
  const segments = relative.split('/');
  if (droppedFolderName !== undefined && segments[0] === droppedFolderName) {
    return segments.slice(1).join('/');
  }
  return relative;
}

/**
 * Fold uploaded files into the set a workflow carries. Upserts by path, so
 * re-uploading a file replaces it where it already sits rather than appending a
 * second copy.
 *
 * Every rule the definition would enforce is applied here instead, per file, so
 * one oversized upload does not cost the author the rest of the batch: the ones
 * that fit are kept and the others come back with a reason.
 */
export function mergeUploadedFiles(
  existing: WorkflowArtifact[],
  uploads: WorkflowArtifact[],
): { artifacts: WorkflowArtifact[]; rejected: RejectedUpload[] } {
  const artifacts = [...existing];
  const rejected: RejectedUpload[] = [];
  let used = artifacts.reduce((sum, artifact) => sum + byteLength(artifact), 0);

  for (const upload of uploads) {
    const parsed = WorkflowArtifactSchema.safeParse(upload);
    if (parsed.success === false) {
      const message = parsed.error.issues[0]?.message ?? 'cannot be saved';
      rejected.push({
        path: upload.path,
        reason: encoder.encode(upload.contents).length > WORKFLOW_ARTIFACT_MAX_BYTES
          ? `larger than ${String(WORKFLOW_ARTIFACT_MAX_BYTES / 1024)} KB`
          : message,
      });
      continue;
    }

    const at = artifacts.findIndex((artifact) => artifact.path === upload.path);
    const replacing = at === -1 ? 0 : byteLength(artifacts[at]);
    const next = used - replacing + byteLength(upload);
    if (next > WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES) {
      rejected.push({ path: upload.path, reason: 'no room left in this workflow' });
      continue;
    }

    used = next;
    if (at === -1) artifacts.push(upload);
    else artifacts[at] = upload;
  }

  return { artifacts, rejected };
}
