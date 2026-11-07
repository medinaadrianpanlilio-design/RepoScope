import type { GraphData, GraphFile, RelationshipType, UnresolvedImport } from "./types";

export type Connection = { file: GraphFile; types: RelationshipType[] };

function collect(
  data: GraphData,
  fileId: number,
  from: "source" | "target",
  to: "source" | "target",
): Connection[] {
  const byId = new Map(data.files.map((file) => [file.id, file]));
  const connections = new Map<number, Connection>();

  for (const edge of data.edges) {
    if (edge[from] !== fileId || edge[to] === fileId) continue;
    const file = byId.get(edge[to]);
    if (!file) continue;

    const connection = connections.get(file.id) ?? { file, types: [] };
    connection.types.push(edge.type);
    connections.set(file.id, connection);
  }

  return [...connections.values()].sort((a, b) => a.file.path.localeCompare(b.file.path));
}

/** Uses the full graph, so the lists stay complete even when folders are closed. */
export function fileConnections(data: GraphData, fileId: number) {
  return {
    imports: collect(data, fileId, "source", "target"),
    importedBy: collect(data, fileId, "target", "source"),
  };
}

export function cycleContaining(cycles: string[][], path: string): string[] | null {
  return cycles.find((cycle) => cycle.includes(path)) ?? null;
}

export function githubFileUrl(repositoryUrl: string, commitSha: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${repositoryUrl}/blob/${commitSha}/${encoded}`;
}

/**
 * Follows imports outward from a file. Count is every other file reached, and depth is
 * how many steps away the farthest one is, taking the shortest route to each.
 */
export function reach(data: GraphData, fileId: number, direction: "imports" | "importedBy") {
  const neighbors = new Map<number, number[]>();
  for (const { source, target } of data.edges) {
    const [from, to] = direction === "imports" ? [source, target] : [target, source];
    const list = neighbors.get(from);
    if (list) list.push(to);
    else neighbors.set(from, [to]);
  }

  const seen = new Set([fileId]);
  let frontier = [fileId];
  let depth = 0;

  while (true) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const neighbor of neighbors.get(id) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    if (next.length === 0) return { count: seen.size - 1, depth };
    frontier = next;
    depth++;
  }
}

export function unresolvedIn(unresolved: UnresolvedImport[], fileId: number) {
  return unresolved.filter((item) => item.fileId === fileId).sort((a, b) => a.line - b.line);
}
