import {
  buildContextFilter,
  dockerignoreCandidates,
  looksLikeDockerfile,
  packBuildContextArchive,
} from '@mediforce/platform-core';

/**
 * A folder picked on the member's machine, as the build context the Images
 * view uploads (#1345). Paths in it are from the folder's root, the way
 * `docker build my-agent` reads them.
 */

export interface PickedFile {
  /** Path from the picked folder's root. */
  path: string;
  file: File;
}

export interface PickedFolder {
  /** The picked folder's own name. */
  name: string;
  files: PickedFile[];
  bytes: number;
}

function pickedFolder(name: string, files: PickedFile[]): PickedFolder | null {
  if (files.length === 0) return null;
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { name, files, bytes: files.reduce((total, picked) => total + picked.file.size, 0) };
}

/**
 * Files from `<input webkitdirectory>`: a flat list, each carrying its path
 * from the picked folder's *parent* — `my-agent/container/Dockerfile` — so the
 * first segment, the folder itself, is stripped.
 */
export function readPickedFolder(fileList: Iterable<File>): PickedFolder | null {
  const files: PickedFile[] = [];
  let name = '';
  for (const file of fileList) {
    const relative = file.webkitRelativePath === '' ? file.name : file.webkitRelativePath;
    const slash = relative.indexOf('/');
    name = slash === -1 ? '' : relative.slice(0, slash);
    files.push({ path: slash === -1 ? relative : relative.slice(slash + 1), file });
  }
  return pickedFolder(name, files);
}

/** The part of `FileSystemDirectoryHandle` a walk needs. */
export interface PickableDirectory {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<PickableDirectory | { readonly kind: 'file'; readonly name: string; getFile(): Promise<File> }>;
}

/**
 * A directory from `showDirectoryPicker`. Walked here rather than handed over
 * by `<input webkitdirectory>`, which makes the browser count every file —
 * `node_modules` and what the `.dockerignore` excludes included — and ask
 * whether to upload that many before the page can leave any out.
 */
export async function readDirectoryHandle(directory: PickableDirectory): Promise<PickedFolder | null> {
  const files: PickedFile[] = [];
  async function walk(current: PickableDirectory, prefix: string): Promise<void> {
    for await (const entry of current.values()) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.kind === 'directory') await walk(entry, path);
      else files.push({ path, file: await entry.getFile() });
    }
  }
  await walk(directory, '');
  return pickedFolder(directory.name, files);
}

function isIgnoreFile(path: string): boolean {
  return path.endsWith('.dockerignore');
}

/** Files that look like a Dockerfile, the root one first — the choices to
 *  offer, since a folder usually holds one and the path is easy to mistype. */
export function dockerfileCandidates(folder: PickedFolder): string[] {
  const candidates = folder.files.map((picked) => picked.path).filter(looksLikeDockerfile);
  return [...candidates.filter((path) => path === 'Dockerfile'), ...candidates.filter((path) => path !== 'Dockerfile')];
}

/** The text of every ignore file in the folder, read once when it is picked so
 *  the selection can follow the Dockerfile field without reading again. */
export async function readDockerignores(folder: PickedFolder): Promise<ReadonlyMap<string, string>> {
  const texts = new Map<string, string>();
  for (const { path, file } of folder.files) {
    if (isIgnoreFile(path)) texts.set(path, await file.text());
  }
  return texts;
}

/** Which of a picked folder's files go up. The member unchecks what the build
 *  does not need; what the ignore file excludes starts out left out. */
export interface ContextSelection {
  /** The ignore file applied, or null when the folder has none. */
  ignoreFile: string | null;
  /** What the ignore file excludes. Never uploaded and never offered: the
   *  build host applies the same file, so the build would drop it anyway. */
  ignored: ReadonlySet<string>;
  /** The Dockerfile and the ignore file — uploaded whatever is unchecked. */
  required: ReadonlySet<string>;
  /** What the member unchecked. */
  unchecked: ReadonlySet<string>;
}

export type ContextFileState = 'selected' | 'unchecked' | 'ignored' | 'required';

/** The selection for `dockerfile` before the member unchecks anything. */
export function contextSelection(
  folder: PickedFolder,
  dockerignores: ReadonlyMap<string, string>,
  dockerfile: string,
): ContextSelection {
  const ignorePath = dockerignoreCandidates(dockerfile).find((candidate) => dockerignores.has(candidate));
  const filter = buildContextFilter(
    dockerfile,
    ignorePath === undefined ? null : { path: ignorePath, text: dockerignores.get(ignorePath) ?? '' },
  );
  return {
    ignoreFile: filter.ignoreFile,
    ignored: new Set(folder.files.map((picked) => picked.path).filter(filter.excludes)),
    required: filter.required,
    unchecked: new Set(),
  };
}

export function contextFileState(selection: ContextSelection, path: string): ContextFileState {
  if (selection.required.has(path)) return 'required';
  if (selection.ignored.has(path)) return 'ignored';
  return selection.unchecked.has(path) ? 'unchecked' : 'selected';
}

function isUploaded(state: ContextFileState): boolean {
  return state === 'selected' || state === 'required';
}

function isToggleable(state: ContextFileState): boolean {
  return state === 'selected' || state === 'unchecked';
}

export function selectedFiles(folder: PickedFolder, selection: ContextSelection): PickedFile[] {
  return folder.files.filter((picked) => isUploaded(contextFileState(selection, picked.path)));
}

function isUnder(directory: string, path: string): boolean {
  return directory === '' || path === directory || path.startsWith(`${directory}/`);
}

/**
 * The unchecked set after the member clicks `path` — a file, or a directory
 * (`''` is the whole folder). A directory with anything unchecked is checked
 * whole; one with everything checked is unchecked whole.
 */
export function toggleContextPath(
  folder: PickedFolder,
  selection: ContextSelection,
  path: string,
): ReadonlySet<string> {
  const toggleable = folder.files
    .map((picked) => picked.path)
    .filter((candidate) => isUnder(path, candidate) && isToggleable(contextFileState(selection, candidate)));
  const allChecked = toggleable.every((candidate) => selection.unchecked.has(candidate) === false);
  const next = new Set(selection.unchecked);
  for (const candidate of toggleable) {
    if (allChecked) next.add(candidate);
    else next.delete(candidate);
  }
  return next;
}

export interface ContextSummary {
  files: number;
  selectedFiles: number;
  selectedBytes: number;
  ignoredFiles: number;
  uncheckedFiles: number;
  /** Files the member can check or uncheck, and how many of those are checked. */
  toggleable: number;
  toggleableSelected: number;
}

/** A summary per directory, `''` being the whole folder. */
export function summarizeContext(folder: PickedFolder, selection: ContextSelection): Map<string, ContextSummary> {
  const summaries = new Map<string, ContextSummary>();
  for (const { path, file } of folder.files) {
    const state = contextFileState(selection, path);
    const segments = path.split('/');
    for (let depth = 0; depth < segments.length; depth += 1) {
      const directory = segments.slice(0, depth).join('/');
      const summary = summaries.get(directory) ?? {
        files: 0,
        selectedFiles: 0,
        selectedBytes: 0,
        ignoredFiles: 0,
        uncheckedFiles: 0,
        toggleable: 0,
        toggleableSelected: 0,
      };
      summary.files += 1;
      if (isUploaded(state)) {
        summary.selectedFiles += 1;
        summary.selectedBytes += file.size;
      }
      if (state === 'ignored') summary.ignoredFiles += 1;
      if (state === 'unchecked') summary.uncheckedFiles += 1;
      if (isToggleable(state)) summary.toggleable += 1;
      if (state === 'selected') summary.toggleableSelected += 1;
      summaries.set(directory, summary);
    }
  }
  return summaries;
}

export interface ContextTreeNode {
  name: string;
  /** Path from the folder root. */
  path: string;
  /** Null for a file. */
  children: ContextTreeNode[] | null;
  /** Bytes — a directory's are everything under it. */
  size: number;
}

/** The folder's files nested by directory, directories first at every level. */
export function contextTree(folder: PickedFolder): ContextTreeNode[] {
  const root: ContextTreeNode[] = [];
  const directories = new Map<string, ContextTreeNode>();
  for (const { path, file } of folder.files) {
    const segments = path.split('/');
    let siblings = root;
    segments.forEach((name, index) => {
      const nodePath = segments.slice(0, index + 1).join('/');
      if (index === segments.length - 1) {
        siblings.push({ name, path: nodePath, children: null, size: file.size });
        return;
      }
      let directory = directories.get(nodePath);
      if (directory === undefined) {
        directory = { name, path: nodePath, children: [], size: 0 };
        directories.set(nodePath, directory);
        siblings.push(directory);
      }
      directory.size += file.size;
      siblings = directory.children ?? [];
    });
  }
  const sortLevel = (nodes: ContextTreeNode[]): ContextTreeNode[] => {
    nodes.sort((left, right) =>
      (left.children === null) === (right.children === null)
        ? left.name.localeCompare(right.name)
        : left.children === null ? 1 : -1,
    );
    for (const node of nodes) if (node.children !== null) sortLevel(node.children);
    return nodes;
  };
  return sortLevel(root);
}

/**
 * Picked files as a tar archive. Every file goes in as not executable:
 * browsers do not expose file permissions, so there is no bit to carry.
 */
export async function packPickedFiles(files: readonly PickedFile[]): Promise<Uint8Array<ArrayBuffer>> {
  const entries = await Promise.all(
    files.map(async ({ path, file }) => ({
      kind: 'file' as const,
      path,
      content: new Uint8Array(await file.arrayBuffer()),
      modifiedMs: file.lastModified,
    })),
  );
  return packBuildContextArchive(entries);
}
