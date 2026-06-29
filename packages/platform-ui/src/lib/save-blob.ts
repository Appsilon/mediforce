import { apiFetch } from './api-fetch';

/**
 * Trigger the browser's "save file" flow for an in-memory blob via a
 * transient object URL. Shared by every authenticated download that fetches
 * bytes with a Bearer token first (run-report deliverable, run Output Files)
 * — a bare `<a href>` would not carry the Authorization header.
 */
export function saveBlobToDevice(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Fetch bytes from a same-origin API URL with the Bearer token attached, then
 * hand the browser a save-file dialog. Used for attachment blob downloads
 * (ADR-0003) — the `/api/attachments/:id/blob` route authenticates the Firebase
 * token, so a bare `<a href download>` would 401.
 */
export async function downloadViaApiFetch(url: string, fileName: string): Promise<void> {
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  saveBlobToDevice(await res.blob(), fileName);
}
