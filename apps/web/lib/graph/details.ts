import type { GraphData, GraphFile, RelationshipType } from "./types";

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
