import type { GraphData, GraphFile, GraphView, ViewEdge, ViewNode } from "./types";

/** Above this many files, a graph opens grouped by folder. */
export const GROUP_THRESHOLD = 200;

export function foldersOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The node a file appears as: itself, or the highest closed folder holding it. */
export function visibleNodeId(file: GraphFile, expanded: Set<string>): string {
  for (const folder of foldersOf(file.path)) {
    if (!expanded.has(folder)) return `folder:${folder}`;
  }
  return `file:${file.id}`;
}

/** Builds what's on screen from the full graph and the set of open folders. */
export function toGraphView({ files, edges }: GraphData, expanded: Set<string>): GraphView {
  const nodes = new Map<string, ViewNode>();
  const nodeOfFile = new Map<number, string>();

  for (const file of files) {
    const id = visibleNodeId(file, expanded);
    nodeOfFile.set(file.id, id);

    if (id.startsWith("file:")) {
      nodes.set(id, { id, kind: "file", path: file.path, name: nameOf(file.path), file });
    } else {
      const path = id.slice("folder:".length);
      const existing = nodes.get(id);
      nodes.set(id, {
        id,
        kind: "folder",
        path,
        name: nameOf(path),
        fileCount: (existing?.kind === "folder" ? existing.fileCount : 0) + 1,
      });
    }
  }

  const merged = new Map<string, ViewEdge>();
  for (const { source, target, type } of edges) {
    const from = nodeOfFile.get(source);
    const to = nodeOfFile.get(target);
    if (!from || !to) continue;
    if (from === to && from.startsWith("folder:")) continue;

    const id = `${from}>${to}>${type}`;
    const edge = merged.get(id);
    if (edge) edge.count++;
    else merged.set(id, { id, source: from, target: to, type, count: 1 });
  }

  return { nodes: [...nodes.values()], edges: [...merged.values()] };
}

/** A small repository opens fully. A big one opens at the first level with a real choice. */
export function defaultExpanded(files: GraphFile[]): Set<string> {
  const allFolders = new Set(files.flatMap((file) => foldersOf(file.path)));
  if (files.length <= GROUP_THRESHOLD) return allFolders;

  const expanded = new Set<string>();
  while (true) {
    const { nodes } = toGraphView({ files, edges: [] }, expanded);
    const only = nodes[0];
    if (nodes.length !== 1 || only?.kind !== "folder") return expanded;
    expanded.add(only.path);
  }
}

export function connectedTo(id: string, edges: ViewEdge[]) {
  const incoming = new Set<string>();
  const outgoing = new Set<string>();

  for (const edge of edges) {
    if (edge.target === id) incoming.add(edge.source);
    if (edge.source === id) outgoing.add(edge.target);
  }
  return { incoming, outgoing };
}
