export type RelationshipType = "static" | "dynamic" | "reexport" | "type";

export const RELATIONSHIP_TYPES: RelationshipType[] = ["static", "dynamic", "reexport", "type"];

export type GraphFile = {
  id: number;
  path: string;
  language: string;
  lines: number;
  incoming: number;
  outgoing: number;
};

/** Source and target are file ids. */
export type GraphEdge = { source: number; target: number; type: RelationshipType };

export type GraphData = { files: GraphFile[]; edges: GraphEdge[] };

export type ViewNode =
  | { id: string; kind: "file"; path: string; name: string; file: GraphFile }
  | { id: string; kind: "folder"; path: string; name: string; fileCount: number };

export type ViewEdge = {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  /** How many file-to-file relationships this edge stands for. */
  count: number;
};

export type GraphView = { nodes: ViewNode[]; edges: ViewEdge[] };
