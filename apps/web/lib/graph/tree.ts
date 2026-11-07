import type { GraphFile } from "./types";

export type TreeFolder = {
  name: string;
  path: string;
  folders: TreeFolder[];
  files: GraphFile[];
  fileCount: number;
};

export function buildTree(files: GraphFile[]): TreeFolder {
  const root: TreeFolder = { name: "", path: "", folders: [], files: [], fileCount: 0 };
  const folders = new Map<string, TreeFolder>([["", root]]);

  function folderAt(path: string): TreeFolder {
    const existing = folders.get(path);
    if (existing) return existing;

    const slash = path.lastIndexOf("/");
    const parent = folderAt(slash === -1 ? "" : path.slice(0, slash));
    const folder: TreeFolder = {
      name: path.slice(slash + 1),
      path,
      folders: [],
      files: [],
      fileCount: 0,
    };
    parent.folders.push(folder);
    folders.set(path, folder);
    return folder;
  }

  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    folderAt(slash === -1 ? "" : file.path.slice(0, slash)).files.push(file);
  }

  function finish(folder: TreeFolder): number {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.files.sort((a, b) => a.path.localeCompare(b.path));
    folder.fileCount =
      folder.files.length + folder.folders.reduce((sum, child) => sum + finish(child), 0);
    return folder.fileCount;
  }
  finish(root);

  return root;
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

export function extensionsOf(files: GraphFile[]) {
  const counts = new Map<string, number>();
  for (const { path } of files) {
    const extension = extensionOf(path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts]
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count || a.extension.localeCompare(b.extension));
}

export function searchFiles(files: GraphFile[], query: string, limit = 200): GraphFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const nameMatches = (file: GraphFile) =>
    file.path.slice(file.path.lastIndexOf("/") + 1).toLowerCase().includes(needle);

  return files
    .filter((file) => file.path.toLowerCase().includes(needle))
    .sort((a, b) => Number(nameMatches(b)) - Number(nameMatches(a)) || a.path.localeCompare(b.path))
    .slice(0, limit);
}
