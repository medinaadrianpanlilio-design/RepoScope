import type { GraphData } from "./types";

/**
 * The folder each file is grouped and coloured by in the 3D graph. Usually the top-level folder;
 * when one folder holds most of the files (a lone `src/` or `packages/`), the level below it, so
 * the clusters still say something.
 */
export function clusterKeys(files: GraphData["files"], dominantShare = 0.6): Map<number, string> {
  const top = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : "(root)");
  const counts = new Map<string, number>();
  for (const file of files) counts.set(top(file.path), (counts.get(top(file.path)) ?? 0) + 1);

  const dominant = [...counts].find(([, count]) => count / Math.max(1, files.length) >= dominantShare)?.[0];

  return new Map(
    files.map((file) => {
      const first = top(file.path);
      if (first !== dominant) return [file.id, first];
      const rest = file.path.slice(first.length + 1);
      return [file.id, rest.includes("/") ? `${first}/${rest.slice(0, rest.indexOf("/"))}` : first];
    }),
  );
}

/** Cluster names, biggest first, so the biggest clusters get the first colours. */
export function clusterOrder(keys: Map<number, string>): string[] {
  const counts = new Map<string, number>();
  for (const key of keys.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
}
