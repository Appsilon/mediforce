/** One file of an upload, as picked, dropped or unpacked from a zip. */
export interface UploadedEntry {
  path: string;
  bytes: Uint8Array;
}

/** Read picked files: a folder picker keeps each file's place in the folder
 *  in `webkitRelativePath` (the picked folder's own name first), which is
 *  empty for a single picked file. */
export async function entriesFromFiles(files: ReadonlyArray<File>): Promise<UploadedEntry[]> {
  return Promise.all(files.map(async (file) => ({
    path: file.webkitRelativePath !== '' ? file.webkitRelativePath : file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })));
}

/** A dropped folder arrives as directory entries, not files (`dataTransfer.files`
 *  lists it as one unreadable entry), so it is walked. The entries have to be
 *  taken while the drop event is live, so this reads them synchronously before
 *  its first await. Paths start with the dropped folder's own name, as a
 *  picked folder's do. */
export async function entriesFromDrop(items: DataTransferItemList): Promise<UploadedEntry[]> {
  const roots = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const entries: UploadedEntry[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      entries.push({ path: entry.fullPath.replace(/^\/+/, ''), bytes: new Uint8Array(await file.arrayBuffer()) });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns the children in batches, then an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) return;
      for (const child of batch) await walk(child);
    }
  };
  for (const root of roots) await walk(root);
  return entries;
}

/**
 * The path a file of a folder upload lands at, relative to the folder. Both
 * the picker and a drop prefix the chosen folder's own name; keeping it would
 * bury every file a level deeper than the author picked, so that one leading
 * segment is dropped and the rest of the structure survives (a `scripts/`
 * directory uploaded flat leaves a step's command pointing at nothing).
 * A loose file has no folder to drop.
 */
export function uploadPathFor(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}
