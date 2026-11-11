import type { ElkExtendedEdge, ElkNode, LayoutOptions } from "elkjs/lib/elk-api";

/** How the graph can be arranged. Each is computed by ELK in a worker. */
export const LAYOUTS = ["layered", "force", "directory"] as const;
export type LayoutKind = (typeof LAYOUTS)[number];

export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  layered: "Layered",
  force: "Force-directed",
  directory: "By folder",
};

export function isLayoutKind(value: unknown): value is LayoutKind {
  return (LAYOUTS as readonly unknown[]).includes(value);
}

export type LayoutNode = { id: string; width: number; height: number; path: string };
export type LayoutEdge = { id: string; source: string; target: string };

export type Positions = Record<string, { x: number; y: number }>;

/** A folder's frame in the directory layout, drawn behind its contents. */
export type FolderBox = {
  id: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutResult = { positions: Positions; boxes: FolderBox[] };

const BOX_PREFIX = "box:";

/** Room above a frame's contents for its folder name. */
export const BOX_LABEL_HEIGHT = 26;

const LAYERED: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "18",
  "elk.spacing.componentComponent": "60",
};

const FORCE: LayoutOptions = {
  "elk.algorithm": "force",
  "elk.force.iterations": "300",
  "elk.spacing.nodeNode": "40",
  "elk.spacing.componentComponent": "80",
};

const DIRECTORY: LayoutOptions = {
  ...LAYERED,
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
};

const BOX_OPTIONS: LayoutOptions = {
  "elk.padding": `[top=${BOX_LABEL_HEIGHT + 8},left=12,bottom=12,right=12]`,
};

/** The folder a node sits in. A collapsed folder node sits in its parent, like a file. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function toEdges(edges: LayoutEdge[]): ElkExtendedEdge[] {
  return edges
    .filter((edge) => edge.source !== edge.target)
    .map(({ id, source, target }) => ({ id, sources: [source], targets: [target] }));
}

/** Nests every node inside a frame for each folder above it. */
function nestByFolder(nodes: LayoutNode[]): ElkNode[] {
  const root: ElkNode[] = [];
  const boxes = new Map<string, ElkNode>();

  const boxFor = (folder: string): ElkNode[] => {
    if (folder === "") return root;
    const existing = boxes.get(folder);
    if (existing) return existing.children!;

    const box: ElkNode = { id: `${BOX_PREFIX}${folder}`, layoutOptions: BOX_OPTIONS, children: [] };
    boxes.set(folder, box);
    boxFor(parentOf(folder)).push(box);
    return box.children!;
  };

  for (const { id, width, height, path } of nodes) {
    boxFor(parentOf(path)).push({ id, width, height });
  }
  return root;
}

export function elkGraph(kind: LayoutKind, nodes: LayoutNode[], edges: LayoutEdge[]): ElkNode {
  const plain = nodes.map(({ id, width, height }) => ({ id, width, height }));
  return {
    id: "root",
    layoutOptions: kind === "force" ? FORCE : kind === "directory" ? DIRECTORY : LAYERED,
    children: kind === "directory" ? nestByFolder(nodes) : plain,
    edges: toEdges(edges),
  };
}

/** ELK places children relative to their parent. The canvas needs every position absolute. */
export function readLayout(graph: ElkNode): LayoutResult {
  const positions: Positions = {};
  const boxes: FolderBox[] = [];

  const visit = (children: ElkNode[] | undefined, offsetX: number, offsetY: number) => {
    for (const child of children ?? []) {
      const x = offsetX + (child.x ?? 0);
      const y = offsetY + (child.y ?? 0);
      if (child.id.startsWith(BOX_PREFIX)) {
        boxes.push({
          id: child.id,
          path: child.id.slice(BOX_PREFIX.length),
          x,
          y,
          width: child.width ?? 0,
          height: child.height ?? 0,
        });
        visit(child.children, x, y);
      } else {
        positions[child.id] = { x, y };
      }
    }
  };

  visit(graph.children, 0, 0);
  return { positions, boxes };
}
