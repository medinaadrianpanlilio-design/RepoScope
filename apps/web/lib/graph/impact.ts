import type { GraphData, GraphFile } from "./types";
import { visibleNodeId } from "./view";

export type ImpactedFile = { file: GraphFile; depth: number };

/**
 * Every file that depends on the given files, directly or indirectly. Depth is how many
 * import steps away a file is by the shortest route. Type-only imports count, because a
 * changed type can break the files using it.
 */
export function changeImpact(data: GraphData, fileIds: number[]): ImpactedFile[] {
  const importers = new Map<number, number[]>();
  for (const { source, target } of data.edges) {
    const list = importers.get(target);
    if (list) list.push(source);
    else importers.set(target, [source]);
  }

  const byId = new Map(data.files.map((file) => [file.id, file]));
  const seen = new Set(fileIds);
  const impacted: ImpactedFile[] = [];
  let frontier = fileIds;

  for (let depth = 1; frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const importer of importers.get(id) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        next.push(importer);
        const file = byId.get(importer);
        if (file) impacted.push({ file, depth });
      }
    }
    frontier = next;
  }

  return impacted.sort((a, b) => a.depth - b.depth || a.file.path.localeCompare(b.file.path));
}

/** How many affected files each node on screen stands for, including closed folders. */
export function impactByNode(impacted: ImpactedFile[], expanded: Set<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { file } of impacted) {
    const id = visibleNodeId(file, expanded);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
