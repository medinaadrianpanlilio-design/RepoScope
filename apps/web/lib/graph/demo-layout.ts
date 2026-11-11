import type { GraphData, RelationshipType } from "./types";

export type DemoNode = { id: number; path: string; language: string; lines: number; x: number; y: number };
export type DemoEdge = { source: number; target: number; type: RelationshipType };
export type DemoGraph = {
  nodes: DemoNode[];
  edges: DemoEdge[];
  width: number;
  height: number;
  /** Files with no imports either way, left out of the drawing. */
  standalone: number;
};

export const DEMO_NODE = { width: 200, height: 30, column: 232, row: 40 };

/** Prefer the edge that says the most about how a file is used when two files share several. */
const STRENGTH: Record<RelationshipType, number> = { static: 0, reexport: 1, type: 2, dynamic: 3 };

/**
 * A small layered drawing for the home page, worked out on the server so the page needs no layout
 * engine. Importers sit to the left of what they import; each column is ordered to keep lines short.
 * Meant for small repositories: every connected file gets its own box.
 */
export function demoLayout(data: GraphData): DemoGraph {
  const strongest = new Map<string, DemoEdge>();
  for (const edge of data.edges) {
    if (edge.source === edge.target) continue;
    const key = `${edge.source}>${edge.target}`;
    const current = strongest.get(key);
    if (!current || STRENGTH[edge.type] < STRENGTH[current.type]) strongest.set(key, { ...edge });
  }
  const edges = [...strongest.values()];

  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  for (const edge of edges) {
    (outgoing.get(edge.source) ?? outgoing.set(edge.source, []).get(edge.source)!).push(edge.target);
    (incoming.get(edge.target) ?? incoming.set(edge.target, []).get(edge.target)!).push(edge.source);
  }

  const connected = data.files.filter((file) => outgoing.has(file.id) || incoming.has(file.id));

  // Longest path to a file that imports nothing. A cycle is cut where it closes.
  const depth = new Map<number, number>();
  const visiting = new Set<number>();
  function depthOf(id: number): number {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const next = outgoing.get(id) ?? [];
    const value = next.length === 0 ? 0 : 1 + Math.max(...next.map(depthOf));
    visiting.delete(id);
    depth.set(id, value);
    return value;
  }
  for (const file of connected) depthOf(file.id);

  const deepest = Math.max(0, ...connected.map((file) => depth.get(file.id)!));
  const columns: number[][] = Array.from({ length: deepest + 1 }, () => []);
  const byId = new Map(data.files.map((file) => [file.id, file]));
  for (const file of [...connected].sort((a, b) => a.path.localeCompare(b.path))) {
    columns[deepest - depth.get(file.id)!]!.push(file.id);
  }

  // A few sweeps placing each file at the average height of its neighbours in the column before.
  const columnOf = new Map<number, number>();
  columns.forEach((column, index) => column.forEach((id) => columnOf.set(id, index)));
  const share = (id: number) => {
    const column = columns[columnOf.get(id)!]!;
    return (column.indexOf(id) + 0.5) / column.length;
  };
  for (let sweep = 0; sweep < 8; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? columns.keys() : [...columns.keys()].reverse();
    for (const index of order) {
      const column = columns[index]!;
      const weight = new Map(
        column.map((id) => {
          const neighbours = (forward ? incoming.get(id) : outgoing.get(id)) ?? [];
          const placed = neighbours.filter((other) => columnOf.get(other) !== index);
          const value = placed.length
            ? placed.reduce((sum, other) => sum + share(other), 0) / placed.length
            : share(id);
          return [id, value];
        }),
      );
      column.sort((a, b) => weight.get(a)! - weight.get(b)!);
    }
  }

  const rows = Math.max(1, ...columns.map((column) => column.length));
  const nodes: DemoNode[] = columns.flatMap((column, index) => {
    const offset = ((rows - column.length) * DEMO_NODE.row) / 2;
    return column.map((id, row) => {
      const file = byId.get(id)!;
      return {
        id,
        path: file.path,
        language: file.language,
        lines: file.lines,
        x: index * DEMO_NODE.column,
        y: Math.round(offset + row * DEMO_NODE.row),
      };
    });
  });

  return {
    nodes,
    edges,
    width: deepest * DEMO_NODE.column + DEMO_NODE.width,
    height: rows * DEMO_NODE.row - (DEMO_NODE.row - DEMO_NODE.height),
    standalone: data.files.length - connected.length,
  };
}
